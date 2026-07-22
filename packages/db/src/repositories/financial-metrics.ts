import { and, asc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

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

export type FinancialMetricQualityRecord = {
	missingAttributionCount: number;
	missingNameSnapshotCount: number;
	missingFinancialFactCount: number;
};

export async function getFinancialMetricQuality(input: {
	scope: FinancialMetricScope;
	from: Date;
	to: Date;
}): Promise<FinancialMetricQualityRecord> {
	const [facts, missingFacts] = await Promise.all([
		db
			.select({
				campusAttributionKind: invoiceMetricFact.campusAttributionKind,
				campusNameSnapshot: invoiceMetricFact.campusNameSnapshot,
				courseAttributionKind: invoiceMetricFact.courseAttributionKind,
				courseNameSnapshot: invoiceMetricFact.courseNameSnapshot,
			})
			.from(invoiceMetricFact)
			.innerJoin(invoice, eq(invoiceMetricFact.invoiceId, invoice.id))
			.where(
				and(
					eq(invoiceMetricFact.organizationId, input.scope.organizationId),
					gte(invoice.issuedAt, input.from),
					lt(invoice.issuedAt, input.to),
				),
			),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(invoice)
			.leftJoin(
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
					sql`${invoiceMetricFact.invoiceId} is null`,
				),
			),
	]);
	return {
		missingAttributionCount: facts.filter(
			(row) => row.campusAttributionKind === "unknown",
		).length,
		missingNameSnapshotCount: facts.filter(
			(row) =>
				(row.campusAttributionKind === "linked" &&
					row.campusNameSnapshot === null) ||
				(row.courseAttributionKind === "linked" &&
					row.courseNameSnapshot === null),
		).length,
		missingFinancialFactCount: missingFacts[0]?.count ?? 0,
	};
}
export type FinancialReceiptEvent = {
	id: string;
	kind: "payment" | "reversal" | "refund";
	amountInCents: number;
	occurredAt: Date;
};

export async function getFinancialReceiptEvents(input: {
	scope: FinancialMetricScope;
	from: Date;
	to: Date;
	limit: number;
}): Promise<FinancialReceiptEvent[]> {
	const filter = (column: typeof payment.receivedAt) => [
		gte(column, input.from),
		lt(column, input.to),
	];
	const [payments, reversals, refunds] = await Promise.all([
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
					eq(payment.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
					...filter(payment.receivedAt),
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
					eq(paymentReversal.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
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
					eq(refund.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
					gte(refund.refundedAt, input.from),
					lt(refund.refundedAt, input.to),
				),
			),
	]);
	return [
		...payments.map((row) => ({ ...row, kind: "payment" as const })),
		...reversals.map((row) => ({ ...row, kind: "reversal" as const })),
		...refunds.map((row) => ({ ...row, kind: "refund" as const })),
	]
		.sort(
			(a, b) =>
				a.occurredAt.getTime() - b.occurredAt.getTime() ||
				a.id.localeCompare(b.id),
		)
		.slice(0, input.limit);
}

export type FinancialReceiptEventRecord = FinancialReceiptEvent & {
	invoiceId: string;
};

export type FinancialReceiptEventCursor = {
	occurredAt: Date;
	id: string;
};

export type FinancialReceiptEventPage = {
	events: FinancialReceiptEventRecord[];
	nextCursor: FinancialReceiptEventCursor | null;
};

function afterFinancialEventCursor(
	occurredAt: AnyPgColumn,
	id: AnyPgColumn,
	cursor?: FinancialReceiptEventCursor,
) {
	if (!cursor) return undefined;
	return or(
		gt(occurredAt, cursor.occurredAt),
		and(eq(occurredAt, cursor.occurredAt), gt(id, cursor.id)),
	);
}

/** 按 (occurredAt,id) 返回稳定的财务事实页；每次查询重新套用机构和校区范围。 */
export async function getFinancialReceiptEventPage(input: {
	scope: FinancialMetricScope;
	from: Date;
	to: Date;
	limit: number;
	cursor?: FinancialReceiptEventCursor;
}): Promise<FinancialReceiptEventPage> {
	const limit = Math.min(Math.max(input.limit, 1), 50);
	const take = limit + 1;
	const [payments, reversals, refunds] = await Promise.all([
		db
			.select({
				id: payment.id,
				invoiceId: payment.invoiceId,
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
					eq(payment.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
					gte(payment.receivedAt, input.from),
					lt(payment.receivedAt, input.to),
					afterFinancialEventCursor(
						payment.receivedAt,
						payment.id,
						input.cursor,
					),
				),
			)
			.orderBy(asc(payment.receivedAt), asc(payment.id))
			.limit(take),
		db
			.select({
				id: paymentReversal.id,
				invoiceId: paymentReversal.invoiceId,
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
					eq(paymentReversal.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
					gte(paymentReversal.reversedAt, input.from),
					lt(paymentReversal.reversedAt, input.to),
					afterFinancialEventCursor(
						paymentReversal.reversedAt,
						paymentReversal.id,
						input.cursor,
					),
				),
			)
			.orderBy(asc(paymentReversal.reversedAt), asc(paymentReversal.id))
			.limit(take),
		db
			.select({
				id: refund.id,
				invoiceId: refund.invoiceId,
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
					eq(refund.organizationId, input.scope.organizationId),
					campusCondition(input.scope.campusAccess),
					gte(refund.refundedAt, input.from),
					lt(refund.refundedAt, input.to),
					afterFinancialEventCursor(refund.refundedAt, refund.id, input.cursor),
				),
			)
			.orderBy(asc(refund.refundedAt), asc(refund.id))
			.limit(take),
	]);
	const events = [
		...payments.map((row) => ({ ...row, kind: "payment" as const })),
		...reversals.map((row) => ({ ...row, kind: "reversal" as const })),
		...refunds.map((row) => ({ ...row, kind: "refund" as const })),
	].sort(
		(a, b) =>
			a.occurredAt.getTime() - b.occurredAt.getTime() ||
			a.id.localeCompare(b.id),
	);
	const page = events.slice(0, limit);
	const last = page.at(-1);
	return {
		events: page,
		nextCursor:
			events.length > limit && last
				? { occurredAt: last.occurredAt, id: last.id }
				: null,
	};
}

export type FinancialCohortInvoice = {
	issuedAt: Date;
	amountInCents: number;
	settledInWindowInCents: number;
	financialFactsComplete: boolean;
	chronologyAnomaly?: boolean;
	adjustmentChainAnomaly?: boolean;
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
	adjustmentChainAnomalyCount: number;
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
		adjustmentChainAnomalyCount: 0,
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
		if (invoice.chronologyAnomaly) {
			result.chronologyAnomalyCount += 1;
			continue;
		}
		if (!invoice.financialFactsComplete) {
			result.factCoverageMissingCount += 1;
			continue;
		}
		if (invoice.adjustmentChainAnomaly) {
			result.adjustmentChainAnomalyCount += 1;
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
			dueDate: invoice.dueDate,
			version: invoice.version,
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
	const [adjustments, payments, reversals, refunds] = await Promise.all([
		db
			.select({
				invoiceId: invoiceAdjustment.invoiceId,
				id: invoiceAdjustment.id,
				beforeVersion: invoiceAdjustment.beforeVersion,
				afterVersion: invoiceAdjustment.afterVersion,
				beforeAmountInCents: invoiceAdjustment.beforeAmountInCents,
				beforeDueDate: invoiceAdjustment.beforeDueDate,
				amountInCents: invoiceAdjustment.afterAmountInCents,
				dueDate: invoiceAdjustment.afterDueDate,
				createdAt: invoiceAdjustment.createdAt,
			})
			.from(invoiceAdjustment)
			.where(
				and(
					eq(invoiceAdjustment.organizationId, input.scope.organizationId),
					inArray(invoiceAdjustment.invoiceId, invoiceIds),
				),
			),
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
	const invoiceVersionById = new Map(
		invoices.map((row) => [row.id, row.version]),
	);
	const adjustmentsByInvoice = new Map<string, typeof adjustments>();
	for (const adjustment of adjustments) {
		const list = adjustmentsByInvoice.get(adjustment.invoiceId) ?? [];
		list.push(adjustment);
		adjustmentsByInvoice.set(adjustment.invoiceId, list);
	}
	const adjustmentChainAnomaly = new Set<string>();
	const adjustedAmountById = new Map(
		invoices.map((row) => [row.id, row.amountInCents]),
	);
	for (const [invoiceId, invoiceAdjustments] of adjustmentsByInvoice) {
		const chain = invoiceAdjustments.sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.afterVersion - b.afterVersion ||
				a.id.localeCompare(b.id),
		);
		let valid = chain[0]?.beforeVersion === 1;
		for (let index = 1; index < chain.length; index += 1) {
			const previous = chain[index - 1];
			const current = chain[index];
			if (
				!previous ||
				!current ||
				current.beforeVersion !== previous.afterVersion ||
				current.beforeAmountInCents !== previous.amountInCents
			) {
				valid = false;
				break;
			}
		}
		if (chain.at(-1)?.afterVersion !== invoiceVersionById.get(invoiceId)) {
			valid = false;
		}
		if (!valid) {
			adjustmentChainAnomaly.add(invoiceId);
			continue;
		}
		const issuedAt = issuedAtById.get(invoiceId);
		if (!issuedAt) continue;
		const windowEnd = new Date(issuedAt.getTime() + 30 * 86_400_000);
		let amount = chain[0]?.beforeAmountInCents;
		for (const adjustment of chain) {
			if (adjustment.createdAt < windowEnd) amount = adjustment.amountInCents;
		}
		if (amount !== undefined) adjustedAmountById.set(invoiceId, amount);
	}
	for (const row of invoices) {
		if (row.version > 1 && !adjustmentsByInvoice.has(row.id)) {
			adjustmentChainAnomaly.add(row.id);
		}
	}
	const settled = new Map<string, number>();
	const chronologyAnomaly = new Set<string>();
	const add = (invoiceId: string, amount: number, occurredAt: Date) => {
		const issuedAt = issuedAtById.get(invoiceId);
		if (occurredAt > input.asOf) return;
		if (issuedAt && occurredAt < issuedAt) {
			chronologyAnomaly.add(invoiceId);
			return;
		}
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
			amountInCents: adjustedAmountById.get(row.id) ?? row.amountInCents,
			settledInWindowInCents: settled.get(row.id) ?? 0,
			financialFactsComplete: true,
			chronologyAnomaly: chronologyAnomaly.has(row.id),
			adjustmentChainAnomaly: adjustmentChainAnomaly.has(row.id),
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
	adjustmentChainAnomalyCount: number;
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
			version: invoice.version,
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
						id: invoiceAdjustment.id,
						beforeVersion: invoiceAdjustment.beforeVersion,
						afterVersion: invoiceAdjustment.afterVersion,
						beforeAmountInCents: invoiceAdjustment.beforeAmountInCents,
						amountInCents: invoiceAdjustment.afterAmountInCents,
						beforeDueDate: invoiceAdjustment.beforeDueDate,
						dueDate: invoiceAdjustment.afterDueDate,
						createdAt: invoiceAdjustment.createdAt,
					})
					.from(invoiceAdjustment)
					.where(
						and(
							eq(invoiceAdjustment.organizationId, input.scope.organizationId),
							inArray(invoiceAdjustment.invoiceId, ids),
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
	const adjustmentsByInvoice = new Map<string, typeof adjustments>();
	for (const adjustment of adjustments) {
		const list = adjustmentsByInvoice.get(adjustment.invoiceId) ?? [];
		list.push(adjustment);
		adjustmentsByInvoice.set(adjustment.invoiceId, list);
	}
	let adjustmentChainAnomalyCount = 0;
	const invalidAdjustmentInvoices = new Set<string>();
	const invoiceVersionById = new Map(rows.map((row) => [row.id, row.version]));
	for (const row of rows) {
		if (row.version > 1 && !adjustmentsByInvoice.has(row.id)) {
			adjustmentChainAnomalyCount += 1;
			invalidAdjustmentInvoices.add(row.id);
		}
	}
	for (const [invoiceId, invoiceAdjustments] of adjustmentsByInvoice) {
		const chain = invoiceAdjustments.sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.afterVersion - b.afterVersion ||
				a.id.localeCompare(b.id),
		);
		let valid = chain[0]?.beforeVersion === 1;
		for (let index = 1; index < chain.length; index += 1) {
			const previous = chain[index - 1];
			const current = chain[index];
			if (
				!previous ||
				!current ||
				current.beforeVersion !== previous.afterVersion ||
				current.beforeAmountInCents !== previous.amountInCents ||
				current.beforeDueDate !== previous.dueDate
			) {
				valid = false;
				break;
			}
		}
		if (chain.at(-1)?.afterVersion !== invoiceVersionById.get(invoiceId)) {
			valid = false;
		}
		if (!valid) {
			adjustmentChainAnomalyCount += 1;
			invalidAdjustmentInvoices.add(invoiceId);
			continue;
		}
		const first = chain[0];
		if (!first) continue;
		terms.set(invoiceId, {
			amountInCents: first.beforeAmountInCents,
			dueDate: first.beforeDueDate,
		});
		for (const adjustment of chain) {
			if (adjustment.createdAt < input.snapshotAt) {
				terms.set(invoiceId, {
					amountInCents: adjustment.amountInCents,
					dueDate: adjustment.dueDate,
				});
			}
		}
	}
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
		if (invalidAdjustmentInvoices.has(row.id)) continue;
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
		adjustmentChainAnomalyCount,
		missingFactCount: 0,
	};
}

export type FinancialAgingInvoiceRecord = {
	invoiceId: string;
	occurredAt: Date;
	amountInCents: number;
	outstandingInCents: number;
	agingBucket: FinancialAgingBucket;
};

export type FinancialAgingInvoicePage = {
	items: FinancialAgingInvoiceRecord[];
	nextCursor: FinancialReceiptEventCursor | null;
};

/** 返回历史账龄中可核对的正余额账单，游标按账单开具时间和 ID 稳定排序。 */
export async function getFinancialAgingInvoicePage(input: {
	scope: FinancialMetricScope;
	snapshotAt: Date;
	limit: number;
	cursor?: FinancialReceiptEventCursor;
}): Promise<FinancialAgingInvoicePage> {
	const limit = Math.min(Math.max(input.limit, 1), 50);
	const rows = await db
		.select({
			id: invoice.id,
			issuedAt: invoice.issuedAt,
			amountInCents: invoice.amountInCents,
			dueDate: invoice.dueDate,
			version: invoice.version,
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
				afterFinancialEventCursor(invoice.issuedAt, invoice.id, input.cursor),
			),
		)
		.orderBy(asc(invoice.issuedAt), asc(invoice.id))
		.limit(limit + 1);
	const ids = rows.map((row) => row.id);
	if (ids.length === 0) return { items: [], nextCursor: null };
	const [adjustments, payments, reversals] = await Promise.all([
		db
			.select({
				invoiceId: invoiceAdjustment.invoiceId,
				id: invoiceAdjustment.id,
				beforeVersion: invoiceAdjustment.beforeVersion,
				afterVersion: invoiceAdjustment.afterVersion,
				beforeAmountInCents: invoiceAdjustment.beforeAmountInCents,
				beforeDueDate: invoiceAdjustment.beforeDueDate,
				amountInCents: invoiceAdjustment.afterAmountInCents,
				dueDate: invoiceAdjustment.afterDueDate,
				createdAt: invoiceAdjustment.createdAt,
			})
			.from(invoiceAdjustment)
			.where(
				and(
					eq(invoiceAdjustment.organizationId, input.scope.organizationId),
					inArray(invoiceAdjustment.invoiceId, ids),
				),
			),
		db
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
		db
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
	const versions = new Map(rows.map((row) => [row.id, row.version]));
	const grouped = new Map<string, typeof adjustments>();
	for (const adjustment of adjustments) {
		const list = grouped.get(adjustment.invoiceId) ?? [];
		list.push(adjustment);
		grouped.set(adjustment.invoiceId, list);
	}
	const invalid = new Set<string>();
	for (const [invoiceId, values] of grouped) {
		const chain = values.sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.afterVersion - b.afterVersion ||
				a.id.localeCompare(b.id),
		);
		let valid = chain[0]?.beforeVersion === 1;
		for (let index = 1; index < chain.length; index += 1) {
			const previous = chain[index - 1];
			const current = chain[index];
			if (
				!previous ||
				!current ||
				current.beforeVersion !== previous.afterVersion ||
				current.beforeAmountInCents !== previous.amountInCents
			) {
				valid = false;
				break;
			}
		}
		if (chain.at(-1)?.afterVersion !== versions.get(invoiceId)) valid = false;
		if (!valid) {
			invalid.add(invoiceId);
			continue;
		}
		const first = chain[0];
		if (first)
			terms.set(invoiceId, {
				amountInCents: first.beforeAmountInCents,
				dueDate: first.beforeDueDate,
			});
		for (const adjustment of chain) {
			if (adjustment.createdAt < input.snapshotAt) {
				terms.set(invoiceId, {
					amountInCents: adjustment.amountInCents,
					dueDate: adjustment.dueDate,
				});
			}
		}
	}
	for (const row of rows) {
		if (row.version > 1 && !grouped.has(row.id)) invalid.add(row.id);
	}
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
	const items = rows
		.filter((row) => !invalid.has(row.id))
		.map((row) => {
			const term = terms.get(row.id);
			const amount = term?.amountInCents ?? row.amountInCents;
			const outstanding = amount - (settled.get(row.id) ?? 0);
			return {
				invoiceId: row.id,
				occurredAt: row.issuedAt,
				amountInCents: amount,
				outstandingInCents: outstanding,
				agingBucket: getFinancialAgingBucket(
					term?.dueDate ?? row.dueDate,
					input.snapshotAt,
				),
			};
		})
		.filter((item) => item.outstandingInCents > 0);
	const page = items.slice(0, limit);
	const last = page.at(-1);
	return {
		items: page,
		nextCursor:
			rows.length > limit && last
				? { occurredAt: last.occurredAt, id: last.invoiceId }
				: null,
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
