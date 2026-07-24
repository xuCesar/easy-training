import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql, sum } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	invoice,
	organization,
	payment,
	paymentReversal,
	receiptDocument,
	receiptDocumentPayment,
	receiptNumberCounter,
	refund,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { isCampusAccessible } from "./campus-access";
import {
	type FinanceTransaction,
	getCurrentFinanceWriteCampusAccess,
} from "./finance-access";
import type { CampusAccess } from "./organization";

export type ReceiptDocumentErrorCode =
	| "INVALID_INPUT"
	| "PAYMENT_NOT_FOUND"
	| "RECEIPT_NOT_FOUND"
	| "RECEIPT_ALREADY_EXISTS"
	| "RECEIPT_NOT_ACTIVE"
	| "RECEIPT_NOT_VOIDED"
	| "IDEMPOTENCY_CONFLICT"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "RESOURCE_UNAVAILABLE";

export class ReceiptDocumentError extends Error {
	constructor(
		public readonly code: ReceiptDocumentErrorCode,
		public readonly existingReceiptId?: string,
	) {
		super(code);
		this.name = "ReceiptDocumentError";
	}
}

export type ReceiptSummaryRecord = {
	id: string;
	number: string;
	status: "active" | "voided";
	generatedAt: Date;
};

export type ReceiptDocumentViewRecord = {
	document: {
		id: string;
		number: string;
		status: "active" | "voided";
		snapshotVersion: number;
		organizationName: string;
		campusName: string;
		studentId: string;
		studentName: string;
		invoiceId: string;
		invoiceSummary: string;
		invoiceAmountInCents: number;
		title: string;
		note: string | null;
		replacesReceiptId: string | null;
		generatedByName: string;
		generatedAt: Date;
		voidReason: string | null;
		voidedByName: string | null;
		voidedAt: Date | null;
	};
	payments: Array<{
		paymentId: string;
		amountInCents: number;
		receivedAt: Date;
		method: (typeof payment.$inferSelect)["method"];
		referenceNo: string | null;
	}>;
	currentFinancialStatus: {
		payments: Array<{
			paymentId: string;
			reversedAmountInCents: number;
			effectiveAmountInCents: number;
		}>;
		invoiceRefundedAmountInCents: number;
		queriedAt: Date;
	};
};

type ReceiptPaymentSnapshot = {
	id: string;
	invoiceId: string;
	amountInCents: number;
	receivedAt: Date;
	method: (typeof payment.$inferSelect)["method"];
	referenceNo: string | null;
	organizationName: string;
	campusId: string;
	campusName: string;
	studentId: string;
	studentName: string;
	invoiceSummary: string;
	invoiceAmountInCents: number;
};

type ReceiptDocumentIdentitySnapshot = Pick<
	ReceiptPaymentSnapshot,
	| "organizationName"
	| "campusId"
	| "campusName"
	| "studentId"
	| "studentName"
	| "invoiceId"
	| "invoiceSummary"
	| "invoiceAmountInCents"
>;

const documentSelection = {
	id: receiptDocument.id,
	organizationId: receiptDocument.organizationId,
	campusId: receiptDocument.campusId,
	number: receiptDocument.number,
	yearMonth: receiptDocument.yearMonth,
	sequence: receiptDocument.sequence,
	status: receiptDocument.status,
	generationRequestId: receiptDocument.generationRequestId,
	inputHash: receiptDocument.inputHash,
	snapshotVersion: receiptDocument.snapshotVersion,
	organizationName: receiptDocument.organizationName,
	campusName: receiptDocument.campusName,
	studentId: receiptDocument.studentId,
	studentName: receiptDocument.studentName,
	invoiceId: receiptDocument.invoiceId,
	invoiceSummary: receiptDocument.invoiceSummary,
	invoiceAmountInCents: receiptDocument.invoiceAmountInCents,
	title: receiptDocument.title,
	note: receiptDocument.note,
	replacesReceiptId: receiptDocument.replacesReceiptId,
	generatedByUserId: receiptDocument.generatedByUserId,
	generatedByName: receiptDocument.generatedByName,
	generatedAt: receiptDocument.generatedAt,
	voidReason: receiptDocument.voidReason,
	voidedByUserId: receiptDocument.voidedByUserId,
	voidedByName: receiptDocument.voidedByName,
	voidedAt: receiptDocument.voidedAt,
	voidRequestId: receiptDocument.voidRequestId,
};

function normalizeText(value: string | null | undefined): string | null {
	const result = value?.trim() ?? "";
	return result || null;
}

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function assertActiveAccessibleCampus(
	tx: FinanceTransaction,
	input: { campusId: string; campusAccess: CampusAccess },
) {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new ReceiptDocumentError("CAMPUS_OUT_OF_SCOPE");
	}
	const [record] = await tx
		.select({ isActive: campus.isActive })
		.from(campus)
		.where(eq(campus.id, input.campusId))
		.limit(1)
		.for("update");
	if (!record?.isActive) throw new ReceiptDocumentError("CAMPUS_INACTIVE");
}

function getShanghaiYearMonth(value: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
	})
		.formatToParts(value)
		.reduce<Record<string, string>>((result, part) => {
			if (part.type !== "literal") result[part.type] = part.value;
			return result;
		}, {});
	return `${parts.year}${parts.month}`;
}

async function allocateReceiptNumber(
	tx: FinanceTransaction,
	organizationId: string,
	generatedAt: Date,
) {
	const yearMonth = getShanghaiYearMonth(generatedAt);
	const [counter] = await tx
		.insert(receiptNumberCounter)
		.values({ organizationId, yearMonth, lastSequence: 1 })
		.onConflictDoUpdate({
			target: [
				receiptNumberCounter.organizationId,
				receiptNumberCounter.yearMonth,
			],
			set: { lastSequence: sql`${receiptNumberCounter.lastSequence} + 1` },
		})
		.returning({ sequence: receiptNumberCounter.lastSequence });
	if (!counter || counter.sequence > 999_999) {
		throw new ReceiptDocumentError("RESOURCE_UNAVAILABLE");
	}
	return {
		yearMonth,
		sequence: counter.sequence,
		number: `RCP-${yearMonth}-${String(counter.sequence).padStart(6, "0")}`,
	};
}

async function getOperatorName(tx: FinanceTransaction, userId: string) {
	const [operator] = await tx
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!operator) throw new ReceiptDocumentError("RESOURCE_UNAVAILABLE");
	return operator.name;
}

async function insertReceipt(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		operatorUserId: string;
		requestId: string;
		inputHash: string;
		title: string;
		note: string | null;
		replacesReceiptId: string | null;
		paymentRecord: ReceiptPaymentSnapshot;
	},
) {
	const generatedAt = new Date();
	const operatorName = await getOperatorName(tx, input.operatorUserId);
	const allocated = await allocateReceiptNumber(
		tx,
		input.organizationId,
		generatedAt,
	);
	const [created] = await tx
		.insert(receiptDocument)
		.values({
			organizationId: input.organizationId,
			campusId: input.paymentRecord.campusId,
			...allocated,
			generationRequestId: input.requestId,
			inputHash: input.inputHash,
			organizationName: input.paymentRecord.organizationName,
			campusName: input.paymentRecord.campusName,
			studentId: input.paymentRecord.studentId,
			studentName: input.paymentRecord.studentName,
			invoiceId: input.paymentRecord.invoiceId,
			invoiceSummary: input.paymentRecord.invoiceSummary,
			invoiceAmountInCents: input.paymentRecord.invoiceAmountInCents,
			title: input.title,
			note: input.note,
			replacesReceiptId: input.replacesReceiptId,
			generatedByUserId: input.operatorUserId,
			generatedByName: operatorName,
			generatedAt,
		})
		.returning(documentSelection);
	if (!created) throw new ReceiptDocumentError("RESOURCE_UNAVAILABLE");
	await tx.insert(receiptDocumentPayment).values({
		organizationId: input.organizationId,
		receiptId: created.id,
		paymentId: input.paymentRecord.id,
		amountInCents: input.paymentRecord.amountInCents,
		receivedAt: input.paymentRecord.receivedAt,
		method: input.paymentRecord.method,
		referenceNo: input.paymentRecord.referenceNo,
	});
	await writeOrganizationAuditEvent(tx, {
		organizationId: input.organizationId,
		action: input.replacesReceiptId ? "receipt_reissued" : "receipt_generated",
		entityType: "receipt_document",
		entityId: created.id,
		actorUserId: input.operatorUserId,
		campusId: input.paymentRecord.campusId,
		after: {
			receiptId: created.id,
			receiptNumber: created.number,
			invoiceId: created.invoiceId,
			paymentIds: [input.paymentRecord.id],
			replacesReceiptId: input.replacesReceiptId,
			requestId: input.requestId,
		},
	});
	return created;
}

async function lockPaymentSnapshot(
	tx: FinanceTransaction,
	input: { organizationId: string; paymentId: string },
): Promise<ReceiptPaymentSnapshot> {
	const [record] = await tx
		.select({
			id: payment.id,
			invoiceId: payment.invoiceId,
			amountInCents: payment.amountInCents,
			receivedAt: payment.receivedAt,
			method: payment.method,
			referenceNo: payment.referenceNo,
			organizationName: organization.name,
			campusId: student.campusId,
			campusName: campus.name,
			studentId: student.id,
			studentName: student.name,
			invoiceSummary: invoice.summary,
			invoiceAmountInCents: invoice.amountInCents,
		})
		.from(payment)
		.innerJoin(
			invoice,
			and(
				eq(invoice.id, payment.invoiceId),
				eq(invoice.organizationId, payment.organizationId),
			),
		)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.innerJoin(campus, eq(campus.id, student.campusId))
		.innerJoin(organization, eq(organization.id, payment.organizationId))
		.where(
			and(
				eq(payment.organizationId, input.organizationId),
				eq(payment.id, input.paymentId),
			),
		)
		.limit(1)
		.for("update");
	if (!record) throw new ReceiptDocumentError("PAYMENT_NOT_FOUND");
	return record;
}

async function lockReissuePaymentSnapshot(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		document: ReceiptDocumentIdentitySnapshot;
		link: Pick<
			ReceiptPaymentSnapshot,
			"id" | "amountInCents" | "receivedAt" | "method" | "referenceNo"
		>;
	},
): Promise<ReceiptPaymentSnapshot> {
	const [current] = await tx
		.select({
			id: payment.id,
			invoiceId: payment.invoiceId,
			amountInCents: payment.amountInCents,
			receivedAt: payment.receivedAt,
			method: payment.method,
			referenceNo: payment.referenceNo,
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, input.organizationId),
				eq(payment.id, input.link.id),
			),
		)
		.limit(1)
		.for("update");
	if (
		!current ||
		current.invoiceId !== input.document.invoiceId ||
		current.amountInCents !== input.link.amountInCents ||
		current.receivedAt.getTime() !== input.link.receivedAt.getTime() ||
		current.method !== input.link.method ||
		current.referenceNo !== input.link.referenceNo
	) {
		throw new ReceiptDocumentError("RESOURCE_UNAVAILABLE");
	}
	return {
		...current,
		organizationName: input.document.organizationName,
		campusId: input.document.campusId,
		campusName: input.document.campusName,
		studentId: input.document.studentId,
		studentName: input.document.studentName,
		invoiceSummary: input.document.invoiceSummary,
		invoiceAmountInCents: input.document.invoiceAmountInCents,
	};
}

export async function generateReceiptDocumentRecord(input: {
	organizationId: string;
	operatorUserId: string;
	paymentIds: string[];
	title: string;
	note?: string | null;
	requestId: string;
}): Promise<{ receiptId: string; replayed: boolean }> {
	const paymentIds = [...new Set(input.paymentIds)].sort();
	const title = input.title.trim();
	const note = normalizeText(input.note);
	if (
		paymentIds.length !== 1 ||
		!title ||
		title.length > 100 ||
		(note?.length ?? 0) > 500
	) {
		throw new ReceiptDocumentError("INVALID_INPUT");
	}
	const inputHash = fingerprint({ paymentIds, title, note });
	return db.transaction(async (tx) => {
		const campusAccess = await getCurrentFinanceWriteCampusAccess(
			tx,
			{ organizationId: input.organizationId, userId: input.operatorUserId },
			() => new ReceiptDocumentError("MEMBER_FORBIDDEN"),
		);
		const paymentRecord = await lockPaymentSnapshot(tx, {
			organizationId: input.organizationId,
			paymentId: paymentIds[0] ?? "",
		});
		await assertActiveAccessibleCampus(tx, {
			campusId: paymentRecord.campusId,
			campusAccess,
		});
		const [replay] = await tx
			.select(documentSelection)
			.from(receiptDocument)
			.where(
				and(
					eq(receiptDocument.organizationId, input.organizationId),
					eq(receiptDocument.generationRequestId, input.requestId),
				),
			)
			.limit(1);
		if (replay) {
			if (replay.inputHash !== inputHash)
				throw new ReceiptDocumentError("IDEMPOTENCY_CONFLICT");
			return { receiptId: replay.id, replayed: true };
		}
		const [active] = await tx
			.select({ receiptId: receiptDocumentPayment.receiptId })
			.from(receiptDocumentPayment)
			.where(
				and(
					eq(receiptDocumentPayment.organizationId, input.organizationId),
					eq(receiptDocumentPayment.paymentId, paymentRecord.id),
					eq(receiptDocumentPayment.isActive, true),
				),
			)
			.limit(1)
			.for("update");
		if (active)
			throw new ReceiptDocumentError(
				"RECEIPT_ALREADY_EXISTS",
				active.receiptId,
			);
		const created = await insertReceipt(tx, {
			organizationId: input.organizationId,
			operatorUserId: input.operatorUserId,
			requestId: input.requestId,
			inputHash,
			title,
			note,
			replacesReceiptId: null,
			paymentRecord,
		});
		return { receiptId: created.id, replayed: false };
	});
}

export async function voidReceiptDocumentRecord(input: {
	organizationId: string;
	operatorUserId: string;
	receiptId: string;
	reason: string;
	requestId: string;
}): Promise<{ receiptId: string; replayed: boolean }> {
	const reason = input.reason.trim();
	if (!reason || reason.length > 500)
		throw new ReceiptDocumentError("INVALID_INPUT");
	return db.transaction(async (tx) => {
		const campusAccess = await getCurrentFinanceWriteCampusAccess(
			tx,
			{ organizationId: input.organizationId, userId: input.operatorUserId },
			() => new ReceiptDocumentError("MEMBER_FORBIDDEN"),
		);
		const [record] = await tx
			.select(documentSelection)
			.from(receiptDocument)
			.where(
				and(
					eq(receiptDocument.organizationId, input.organizationId),
					eq(receiptDocument.id, input.receiptId),
				),
			)
			.limit(1)
			.for("update");
		if (!record) throw new ReceiptDocumentError("RECEIPT_NOT_FOUND");
		await assertActiveAccessibleCampus(tx, {
			campusId: record.campusId,
			campusAccess,
		});
		if (record.voidRequestId === input.requestId) {
			if (record.voidReason !== reason)
				throw new ReceiptDocumentError("IDEMPOTENCY_CONFLICT");
			return { receiptId: record.id, replayed: true };
		}
		const [requestOwner] = await tx
			.select({ id: receiptDocument.id })
			.from(receiptDocument)
			.where(
				and(
					eq(receiptDocument.organizationId, input.organizationId),
					eq(receiptDocument.voidRequestId, input.requestId),
				),
			)
			.limit(1);
		if (requestOwner && requestOwner.id !== record.id)
			throw new ReceiptDocumentError("IDEMPOTENCY_CONFLICT");
		if (record.status !== "active")
			throw new ReceiptDocumentError("RECEIPT_NOT_ACTIVE");
		const operatorName = await getOperatorName(tx, input.operatorUserId);
		const voidedAt = new Date();
		await tx
			.update(receiptDocument)
			.set({
				status: "voided",
				voidReason: reason,
				voidedByUserId: input.operatorUserId,
				voidedByName: operatorName,
				voidedAt,
				voidRequestId: input.requestId,
			})
			.where(eq(receiptDocument.id, record.id));
		await tx
			.update(receiptDocumentPayment)
			.set({ isActive: false })
			.where(
				and(
					eq(receiptDocumentPayment.organizationId, input.organizationId),
					eq(receiptDocumentPayment.receiptId, record.id),
				),
			);
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "receipt_voided",
			entityType: "receipt_document",
			entityId: record.id,
			actorUserId: input.operatorUserId,
			campusId: record.campusId,
			before: { status: "active" },
			after: {
				receiptId: record.id,
				receiptNumber: record.number,
				status: "voided",
				requestId: input.requestId,
			},
		});
		return { receiptId: record.id, replayed: false };
	});
}

export async function reissueReceiptDocumentRecord(input: {
	organizationId: string;
	operatorUserId: string;
	replacesReceiptId: string;
	title: string;
	note?: string | null;
	requestId: string;
}): Promise<{ receiptId: string; replayed: boolean }> {
	const title = input.title.trim();
	const note = normalizeText(input.note);
	if (!title || title.length > 100 || (note?.length ?? 0) > 500)
		throw new ReceiptDocumentError("INVALID_INPUT");
	const inputHash = fingerprint({
		replacesReceiptId: input.replacesReceiptId,
		title,
		note,
	});
	return db.transaction(async (tx) => {
		const campusAccess = await getCurrentFinanceWriteCampusAccess(
			tx,
			{ organizationId: input.organizationId, userId: input.operatorUserId },
			() => new ReceiptDocumentError("MEMBER_FORBIDDEN"),
		);
		const [old] = await tx
			.select(documentSelection)
			.from(receiptDocument)
			.where(
				and(
					eq(receiptDocument.organizationId, input.organizationId),
					eq(receiptDocument.id, input.replacesReceiptId),
				),
			)
			.limit(1)
			.for("update");
		if (!old) throw new ReceiptDocumentError("RECEIPT_NOT_FOUND");
		await assertActiveAccessibleCampus(tx, {
			campusId: old.campusId,
			campusAccess,
		});
		const [replay] = await tx
			.select(documentSelection)
			.from(receiptDocument)
			.where(
				and(
					eq(receiptDocument.organizationId, input.organizationId),
					eq(receiptDocument.generationRequestId, input.requestId),
				),
			)
			.limit(1);
		if (replay) {
			if (replay.inputHash !== inputHash)
				throw new ReceiptDocumentError("IDEMPOTENCY_CONFLICT");
			return { receiptId: replay.id, replayed: true };
		}
		if (old.status !== "voided")
			throw new ReceiptDocumentError("RECEIPT_NOT_VOIDED");
		const [link] = await tx
			.select({
				id: receiptDocumentPayment.paymentId,
				amountInCents: receiptDocumentPayment.amountInCents,
				receivedAt: receiptDocumentPayment.receivedAt,
				method: receiptDocumentPayment.method,
				referenceNo: receiptDocumentPayment.referenceNo,
			})
			.from(receiptDocumentPayment)
			.where(
				and(
					eq(receiptDocumentPayment.organizationId, input.organizationId),
					eq(receiptDocumentPayment.receiptId, old.id),
				),
			)
			.limit(1)
			.for("update");
		if (!link) throw new ReceiptDocumentError("RESOURCE_UNAVAILABLE");
		const paymentRecord = await lockReissuePaymentSnapshot(tx, {
			organizationId: input.organizationId,
			document: old,
			link,
		});
		const [active] = await tx
			.select({ receiptId: receiptDocumentPayment.receiptId })
			.from(receiptDocumentPayment)
			.where(
				and(
					eq(receiptDocumentPayment.organizationId, input.organizationId),
					eq(receiptDocumentPayment.paymentId, link.id),
					eq(receiptDocumentPayment.isActive, true),
				),
			)
			.limit(1);
		if (active)
			throw new ReceiptDocumentError(
				"RECEIPT_ALREADY_EXISTS",
				active.receiptId,
			);
		const created = await insertReceipt(tx, {
			organizationId: input.organizationId,
			operatorUserId: input.operatorUserId,
			requestId: input.requestId,
			inputHash,
			title,
			note,
			replacesReceiptId: old.id,
			paymentRecord,
		});
		return { receiptId: created.id, replayed: false };
	});
}

export async function getReceiptDocumentRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	receiptId: string;
}): Promise<ReceiptDocumentViewRecord | null> {
	const [record] = await db
		.select(documentSelection)
		.from(receiptDocument)
		.where(
			and(
				eq(receiptDocument.organizationId, input.organizationId),
				eq(receiptDocument.id, input.receiptId),
			),
		)
		.limit(1);
	if (!record || !isCampusAccessible(input.campusAccess, record.campusId))
		return null;
	const links = await db
		.select({
			paymentId: receiptDocumentPayment.paymentId,
			amountInCents: receiptDocumentPayment.amountInCents,
			receivedAt: receiptDocumentPayment.receivedAt,
			method: receiptDocumentPayment.method,
			referenceNo: receiptDocumentPayment.referenceNo,
		})
		.from(receiptDocumentPayment)
		.where(
			and(
				eq(receiptDocumentPayment.organizationId, input.organizationId),
				eq(receiptDocumentPayment.receiptId, record.id),
			),
		)
		.orderBy(
			asc(receiptDocumentPayment.receivedAt),
			asc(receiptDocumentPayment.paymentId),
		);
	const paymentIds = links.map((item) => item.paymentId);
	const reversalRows =
		paymentIds.length === 0
			? []
			: await db
					.select({
						paymentId: paymentReversal.paymentId,
						amount: sum(paymentReversal.amountInCents).mapWith(Number),
					})
					.from(paymentReversal)
					.where(
						and(
							eq(paymentReversal.organizationId, input.organizationId),
							inArray(paymentReversal.paymentId, paymentIds),
						),
					)
					.groupBy(paymentReversal.paymentId);
	const reversedByPayment = new Map(
		reversalRows.map((item) => [item.paymentId, item.amount ?? 0]),
	);
	const [refundRow] = await db
		.select({ amount: sum(refund.amountInCents).mapWith(Number) })
		.from(refund)
		.where(
			and(
				eq(refund.organizationId, input.organizationId),
				eq(refund.invoiceId, record.invoiceId),
			),
		);
	return {
		document: {
			id: record.id,
			number: record.number,
			status: record.status,
			snapshotVersion: record.snapshotVersion,
			organizationName: record.organizationName,
			campusName: record.campusName,
			studentId: record.studentId,
			studentName: record.studentName,
			invoiceId: record.invoiceId,
			invoiceSummary: record.invoiceSummary,
			invoiceAmountInCents: record.invoiceAmountInCents,
			title: record.title,
			note: record.note,
			replacesReceiptId: record.replacesReceiptId,
			generatedByName: record.generatedByName,
			generatedAt: record.generatedAt,
			voidReason: record.voidReason,
			voidedByName: record.voidedByName,
			voidedAt: record.voidedAt,
		},
		payments: links,
		currentFinancialStatus: {
			payments: links.map((item) => {
				const reversedAmountInCents =
					reversedByPayment.get(item.paymentId) ?? 0;
				return {
					paymentId: item.paymentId,
					reversedAmountInCents,
					effectiveAmountInCents: Math.max(
						0,
						item.amountInCents - reversedAmountInCents,
					),
				};
			}),
			invoiceRefundedAmountInCents: refundRow?.amount ?? 0,
			queriedAt: new Date(),
		},
	};
}

export async function listReceiptSummariesByPaymentIds(input: {
	organizationId: string;
	paymentIds: string[];
}): Promise<Map<string, ReceiptSummaryRecord>> {
	if (input.paymentIds.length === 0) return new Map();
	const rows = await db
		.select({
			paymentId: receiptDocumentPayment.paymentId,
			id: receiptDocument.id,
			number: receiptDocument.number,
			status: receiptDocument.status,
			generatedAt: receiptDocument.generatedAt,
		})
		.from(receiptDocumentPayment)
		.innerJoin(
			receiptDocument,
			and(
				eq(receiptDocument.id, receiptDocumentPayment.receiptId),
				eq(
					receiptDocument.organizationId,
					receiptDocumentPayment.organizationId,
				),
			),
		)
		.where(
			and(
				eq(receiptDocumentPayment.organizationId, input.organizationId),
				inArray(receiptDocumentPayment.paymentId, input.paymentIds),
			),
		)
		.orderBy(
			desc(receiptDocumentPayment.isActive),
			desc(receiptDocument.generatedAt),
			desc(receiptDocument.id),
		);
	const result = new Map<string, ReceiptSummaryRecord>();
	for (const row of rows)
		if (!result.has(row.paymentId))
			result.set(row.paymentId, {
				id: row.id,
				number: row.number,
				status: row.status,
				generatedAt: row.generatedAt,
			});
	return result;
}

export async function getReceiptSummaryByPaymentId(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	paymentId: string;
}): Promise<ReceiptSummaryRecord | null | undefined> {
	const [resource] = await db
		.select({ campusId: student.campusId })
		.from(payment)
		.innerJoin(
			invoice,
			and(
				eq(invoice.id, payment.invoiceId),
				eq(invoice.organizationId, payment.organizationId),
			),
		)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(payment.organizationId, input.organizationId),
				eq(payment.id, input.paymentId),
			),
		)
		.limit(1);
	if (!resource || !isCampusAccessible(input.campusAccess, resource.campusId))
		return undefined;
	const summaries = await listReceiptSummariesByPaymentIds({
		organizationId: input.organizationId,
		paymentIds: [input.paymentId],
	});
	return summaries.get(input.paymentId) ?? null;
}
