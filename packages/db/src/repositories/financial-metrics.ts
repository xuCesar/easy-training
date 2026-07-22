import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "../index";
import {
	invoice,
	invoiceAdjustment,
	invoiceMetricFact,
	payment,
	paymentReversal,
	refund,
} from "../schema";
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

export type FinancialCohortInvoice = {
	issuedAt: Date;
	amountInCents: number;
	settledInWindowInCents: number;
	financialFactsComplete: boolean;
};

export type FinancialCohortRecord = {
	matureInvoiceCount: number;
	immatureInvoiceCount: number;
	zeroAmountInvoiceCount: number;
	numeratorInCents: number;
	denominatorInCents: number;
	minimumRemainingObservationDays: number | null;
	chronologyAnomalyCount: number;
	settlementAnomalyCount: number;
	factCoverageMissingCount: number;
};

export function calculateFinancialCohort(input: {
	invoices: FinancialCohortInvoice[];
	asOf: Date;
}): FinancialCohortRecord {
	const result: FinancialCohortRecord = {
		matureInvoiceCount: 0,
		immatureInvoiceCount: 0,
		zeroAmountInvoiceCount: 0,
		numeratorInCents: 0,
		denominatorInCents: 0,
		minimumRemainingObservationDays: null,
		chronologyAnomalyCount: 0,
		settlementAnomalyCount: 0,
		factCoverageMissingCount: 0,
	};
	for (const invoice of input.invoices) {
		const windowEnd = new Date(invoice.issuedAt.getTime() + 30 * 86_400_000);
		if (windowEnd > input.asOf) {
			result.immatureInvoiceCount += 1;
			const remaining = Math.ceil(
				(windowEnd.getTime() - input.asOf.getTime()) / 86_400_000,
			);
			result.minimumRemainingObservationDays =
				result.minimumRemainingObservationDays === null
					? remaining
					: Math.min(result.minimumRemainingObservationDays, remaining);
			continue;
		}
		result.matureInvoiceCount += 1;
		if (invoice.amountInCents === 0) {
			result.zeroAmountInvoiceCount += 1;
			continue;
		}
		if (!invoice.financialFactsComplete) {
			result.factCoverageMissingCount += 1;
			continue;
		}
		if (
			invoice.settledInWindowInCents < 0 ||
			invoice.settledInWindowInCents > invoice.amountInCents
		) {
			result.settlementAnomalyCount += 1;
			continue;
		}
		result.numeratorInCents += invoice.settledInWindowInCents;
		result.denominatorInCents += invoice.amountInCents;
	}
	return result;
}

export async function getFinancialCohortRecord(input: {
	scope: FinancialMetricScope;
	from: Date;
	to: Date;
	asOf: Date;
}): Promise<FinancialCohortRecord> {
	const invoices = await db
		.select({
			id: invoice.id,
			issuedAt: invoice.issuedAt,
			amountInCents: invoice.amountInCents,
		})
		.from(invoice)
		.innerJoin(
			invoiceMetricFact,
			and(
				eq(invoiceMetricFact.invoiceId, invoice.id),
				eq(invoiceMetricFact.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.scope.organizationId),
				gte(invoice.issuedAt, input.from),
				lt(invoice.issuedAt, input.to),
				campusCondition(input.scope.campusAccess),
			),
		);
	const invoiceIds = invoices.map((row) => row.id);
	if (invoiceIds.length === 0)
		return calculateFinancialCohort({ invoices: [], asOf: input.asOf });
	const [payments, reversals, refunds] = await Promise.all([
		db
			.select({
				invoiceId: payment.invoiceId,
				amountInCents: payment.amountInCents,
				occurredAt: payment.receivedAt,
			})
			.from(payment)
			.where(
				and(
					eq(payment.organizationId, input.scope.organizationId),
					inArray(payment.invoiceId, invoiceIds),
				),
			),
		db
			.select({
				invoiceId: paymentReversal.invoiceId,
				amountInCents: paymentReversal.amountInCents,
				occurredAt: paymentReversal.reversedAt,
			})
			.from(paymentReversal)
			.where(
				and(
					eq(paymentReversal.organizationId, input.scope.organizationId),
					inArray(paymentReversal.invoiceId, invoiceIds),
				),
			),
		db
			.select({
				invoiceId: refund.invoiceId,
				amountInCents: refund.amountInCents,
				occurredAt: refund.refundedAt,
			})
			.from(refund)
			.where(
				and(
					eq(refund.organizationId, input.scope.organizationId),
					inArray(refund.invoiceId, invoiceIds),
				),
			),
	]);
	const issuedAtById = new Map(invoices.map((row) => [row.id, row.issuedAt]));
	const settled = new Map<string, number>();
	const add = (invoiceId: string, amount: number, occurredAt: Date) => {
		const issuedAt = issuedAtById.get(invoiceId);
		if (
			issuedAt &&
			occurredAt >= issuedAt &&
			occurredAt < new Date(issuedAt.getTime() + 30 * 86_400_000)
		)
			settled.set(invoiceId, (settled.get(invoiceId) ?? 0) + amount);
	};
	for (const row of payments)
		add(row.invoiceId, row.amountInCents, row.occurredAt);
	for (const row of reversals)
		add(row.invoiceId, -row.amountInCents, row.occurredAt);
	for (const row of refunds)
		add(row.invoiceId, -row.amountInCents, row.occurredAt);
	return calculateFinancialCohort({
		asOf: input.asOf,
		invoices: invoices.map((row) => ({
			issuedAt: row.issuedAt,
			amountInCents: row.amountInCents,
			settledInWindowInCents: settled.get(row.id) ?? 0,
			financialFactsComplete: true,
		})),
	});
}

export type FinancialAgingRecord = {
	snapshotAt: Date;
	buckets: Array<{
		kind: FinancialAgingBucket;
		amountInCents: number;
		invoiceCount: number;
	}>;
	totalInCents: number;
	negativeBalanceAnomalyCount: number;
	missingFactCount: number;
};

export async function getFinancialAgingRecord(input: {
	scope: FinancialMetricScope;
	snapshotAt: Date;
}): Promise<FinancialAgingRecord> {
	const rows = await db
		.select({
			id: invoice.id,
			amountInCents: invoice.amountInCents,
			dueDate: invoice.dueDate,
		})
		.from(invoice)
		.innerJoin(
			invoiceMetricFact,
			and(
				eq(invoiceMetricFact.invoiceId, invoice.id),
				eq(invoiceMetricFact.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.scope.organizationId),
				lt(invoice.issuedAt, input.snapshotAt),
				campusCondition(input.scope.campusAccess),
			),
		);
	const ids = rows.map((row) => row.id);
	const [adjustments, payments, reversals] = await Promise.all([
		ids.length === 0
			? Promise.resolve([])
			: db
					.select({
						invoiceId: invoiceAdjustment.invoiceId,
						amountInCents: invoiceAdjustment.afterAmountInCents,
						dueDate: invoiceAdjustment.afterDueDate,
						createdAt: invoiceAdjustment.createdAt,
					})
					.from(invoiceAdjustment)
					.where(
						and(
							eq(invoiceAdjustment.organizationId, input.scope.organizationId),
							inArray(invoiceAdjustment.invoiceId, ids),
							lt(invoiceAdjustment.createdAt, input.snapshotAt),
						),
					),
		ids.length === 0
			? Promise.resolve([])
			: db
					.select({
						invoiceId: payment.invoiceId,
						amountInCents: payment.amountInCents,
					})
					.from(payment)
					.where(
						and(
							eq(payment.organizationId, input.scope.organizationId),
							inArray(payment.invoiceId, ids),
							lt(payment.receivedAt, input.snapshotAt),
						),
					),
		ids.length === 0
			? Promise.resolve([])
			: db
					.select({
						invoiceId: paymentReversal.invoiceId,
						amountInCents: paymentReversal.amountInCents,
					})
					.from(paymentReversal)
					.where(
						and(
							eq(paymentReversal.organizationId, input.scope.organizationId),
							inArray(paymentReversal.invoiceId, ids),
							lt(paymentReversal.reversedAt, input.snapshotAt),
						),
					),
	]);
	const terms = new Map(
		rows.map((row) => [
			row.id,
			{ amountInCents: row.amountInCents, dueDate: row.dueDate },
		]),
	);
	for (const adjustment of adjustments.sort(
		(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
	))
		terms.set(adjustment.invoiceId, {
			amountInCents: adjustment.amountInCents,
			dueDate: adjustment.dueDate,
		});
	const settled = new Map<string, number>();
	for (const row of payments)
		settled.set(
			row.invoiceId,
			(settled.get(row.invoiceId) ?? 0) + row.amountInCents,
		);
	for (const row of reversals)
		settled.set(
			row.invoiceId,
			(settled.get(row.invoiceId) ?? 0) - row.amountInCents,
		);
	const kinds: FinancialAgingBucket[] = [
		"notDue",
		"overdue1To30",
		"overdue31To60",
		"overdue61To90",
		"overdueOver90",
	];
	const buckets = new Map(
		kinds.map((kind) => [kind, { kind, amountInCents: 0, invoiceCount: 0 }]),
	);
	let negativeBalanceAnomalyCount = 0;
	for (const row of rows) {
		const term = terms.get(row.id);
		if (!term) continue;
		const outstanding = term.amountInCents - (settled.get(row.id) ?? 0);
		if (outstanding < 0) {
			negativeBalanceAnomalyCount += 1;
			continue;
		}
		const bucket = buckets.get(
			getFinancialAgingBucket(term.dueDate, input.snapshotAt),
		);
		if (bucket && outstanding > 0) {
			bucket.amountInCents += outstanding;
			bucket.invoiceCount += 1;
		}
	}
	const values = [...buckets.values()];
	return {
		snapshotAt: input.snapshotAt,
		buckets: values,
		totalInCents: values.reduce((sum, bucket) => sum + bucket.amountInCents, 0),
		negativeBalanceAnomalyCount,
		missingFactCount: 0,
	};
}

export type FinancialAgingBucket =
	| "notDue"
	| "overdue1To30"
	| "overdue31To60"
	| "overdue61To90"
	| "overdueOver90";

export function getFinancialAgingBucket(
	dueDate: string,
	snapshotAt: Date,
): FinancialAgingBucket {
	const due = new Date(`${dueDate}T00:00:00+08:00`);
	const daysOverdue = Math.floor(
		(snapshotAt.getTime() - due.getTime()) / 86_400_000,
	);
	if (daysOverdue <= 0) return "notDue";
	if (daysOverdue <= 30) return "overdue1To30";
	if (daysOverdue <= 60) return "overdue31To60";
	if (daysOverdue <= 90) return "overdue61To90";
	return "overdueOver90";
}

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
