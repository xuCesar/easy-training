import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "../index";
import { invoiceMetricFact, payment, paymentReversal, refund } from "../schema";
import type { CampusAccess } from "./organization";

export type FinancialMetricScope = {
	organizationId: string;
	campusAccess: CampusAccess;
};

export type FinancialReceiptTrendPoint = {
	bucketStart: Date;
	paymentsInCents: number;
	reversalsInCents: number;
	refundsInCents: number;
	netReceiptsInCents: number;
};

export type FinancialReceiptRecord = {
	paymentsInCents: number;
	reversalsInCents: number;
	refundsInCents: number;
	netReceiptsInCents: number;
	trend: FinancialReceiptTrendPoint[];
	missingAttributionCount: number;
};

function campusCondition(access: CampusAccess) {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "selected") {
		return inArray(invoiceMetricFact.campusId, access.campusIds);
	}
	return sql`true`;
}

function bucketStart(value: Date, granularity: "day" | "week" | "month"): Date {
	const shanghai = new Date(value.getTime() + 8 * 60 * 60 * 1000);
	const year = shanghai.getUTCFullYear();
	const month = shanghai.getUTCMonth();
	const day = shanghai.getUTCDate();
	if (granularity === "month")
		return new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000);
	if (granularity === "week") {
		const mondayOffset = (shanghai.getUTCDay() + 6) % 7;
		return new Date(
			Date.UTC(year, month, day - mondayOffset) - 8 * 60 * 60 * 1000,
		);
	}
	return new Date(Date.UTC(year, month, day) - 8 * 60 * 60 * 1000);
}

/** 基于不可变资金事实计算净回款；退款申请未产生 refund 记录前不会进入。 */
export async function getFinancialReceiptRecord(input: {
	scope: FinancialMetricScope;
	from: Date;
	to: Date;
	granularity: "day" | "week" | "month";
}): Promise<FinancialReceiptRecord> {
	const scopeFilters = [
		eq(invoiceMetricFact.organizationId, input.scope.organizationId),
		campusCondition(input.scope.campusAccess),
	];
	const [payments, reversals, refunds, missing] = await Promise.all([
		db
			.select({
				id: payment.id,
				occurredAt: payment.receivedAt,
				amountInCents: payment.amountInCents,
			})
			.from(payment)
			.innerJoin(
				invoiceMetricFact,
				and(
					eq(invoiceMetricFact.invoiceId, payment.invoiceId),
					eq(invoiceMetricFact.organizationId, payment.organizationId),
				),
			)
			.where(
				and(
					...scopeFilters,
					gte(payment.receivedAt, input.from),
					lt(payment.receivedAt, input.to),
				),
			),
		db
			.select({
				id: paymentReversal.id,
				occurredAt: paymentReversal.reversedAt,
				amountInCents: paymentReversal.amountInCents,
			})
			.from(paymentReversal)
			.innerJoin(
				invoiceMetricFact,
				and(
					eq(invoiceMetricFact.invoiceId, paymentReversal.invoiceId),
					eq(invoiceMetricFact.organizationId, paymentReversal.organizationId),
				),
			)
			.where(
				and(
					...scopeFilters,
					gte(paymentReversal.reversedAt, input.from),
					lt(paymentReversal.reversedAt, input.to),
				),
			),
		db
			.select({
				id: refund.id,
				occurredAt: refund.refundedAt,
				amountInCents: refund.amountInCents,
			})
			.from(refund)
			.innerJoin(
				invoiceMetricFact,
				and(
					eq(invoiceMetricFact.invoiceId, refund.invoiceId),
					eq(invoiceMetricFact.organizationId, refund.organizationId),
				),
			)
			.where(
				and(
					...scopeFilters,
					gte(refund.refundedAt, input.from),
					lt(refund.refundedAt, input.to),
				),
			),
		input.scope.campusAccess.kind === "all"
			? db
					.select({ count: sql<number>`count(*)::int` })
					.from(payment)
					.leftJoin(
						invoiceMetricFact,
						and(
							eq(invoiceMetricFact.invoiceId, payment.invoiceId),
							eq(invoiceMetricFact.organizationId, payment.organizationId),
						),
					)
					.where(
						and(
							eq(payment.organizationId, input.scope.organizationId),
							sql`${invoiceMetricFact.invoiceId} is null`,
						),
					)
			: Promise.resolve([{ count: 0 }]),
	]);
	const trend = new Map<string, FinancialReceiptTrendPoint>();
	const add = (
		occurredAt: Date,
		kind: "payment" | "reversal" | "refund",
		amountInCents: number,
	) => {
		const start = bucketStart(occurredAt, input.granularity);
		const key = start.toISOString();
		const point = trend.get(key) ?? {
			bucketStart: start,
			paymentsInCents: 0,
			reversalsInCents: 0,
			refundsInCents: 0,
			netReceiptsInCents: 0,
		};
		if (kind === "payment") point.paymentsInCents += amountInCents;
		if (kind === "reversal") point.reversalsInCents += amountInCents;
		if (kind === "refund") point.refundsInCents += amountInCents;
		point.netReceiptsInCents =
			point.paymentsInCents - point.reversalsInCents - point.refundsInCents;
		trend.set(key, point);
	};
	for (const row of payments) add(row.occurredAt, "payment", row.amountInCents);
	for (const row of reversals)
		add(row.occurredAt, "reversal", row.amountInCents);
	for (const row of refunds) add(row.occurredAt, "refund", row.amountInCents);
	const paymentsInCents = payments.reduce(
		(sum, row) => sum + row.amountInCents,
		0,
	);
	const reversalsInCents = reversals.reduce(
		(sum, row) => sum + row.amountInCents,
		0,
	);
	const refundsInCents = refunds.reduce(
		(sum, row) => sum + row.amountInCents,
		0,
	);
	return {
		paymentsInCents,
		reversalsInCents,
		refundsInCents,
		netReceiptsInCents: paymentsInCents - reversalsInCents - refundsInCents,
		trend: [...trend.values()].sort(
			(a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
		),
		missingAttributionCount: missing[0]?.count ?? 0,
	};
}
