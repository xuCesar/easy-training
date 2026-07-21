import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	enrollment,
	invoice,
	payment,
	paymentReversal,
	refund,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { updateEnrollmentPaidAmount } from "./enrollment-finance-adjustments";
import {
	type FinanceTransaction,
	getCurrentFinanceWriteCampusAccess,
} from "./finance-access";
import type { CampusAccess } from "./organization";

export type PaymentReversalErrorCode =
	| "PAYMENT_NOT_FOUND"
	| "INVALID_REVERSAL_AMOUNT"
	| "INVALID_REVERSAL_TIME"
	| "INVALID_REVERSAL_REASON"
	| "REVERSAL_EXCEEDS_AVAILABLE"
	| "PAYMENT_ALREADY_REVERSED"
	| "INVOICE_HAS_REFUND"
	| "REVERSAL_STALE_STATE"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE"
	| "CAMPUS_INACTIVE"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE";

export class PaymentReversalError extends Error {
	constructor(public readonly code: PaymentReversalErrorCode) {
		super(code);
		this.name = "PaymentReversalError";
	}
}

export type PaymentReversalRecord = {
	id: string;
	invoiceId: string;
	paymentId: string;
	amountInCents: number;
	reason: string;
	reversedAt: Date;
	operatorUserId: string;
	operatorName: string;
	requestId: string;
	createdAt: Date;
};

export type CreatePaymentReversalRecordInput = {
	organizationId: string;
	operatorUserId: string;
	paymentId: string;
	amountInCents: number;
	reason: string;
	reversedAt: Date;
	requestId: string;
};

export type PaymentReversalResult = {
	reversal: PaymentReversalRecord;
	payment: {
		id: string;
		originalAmountInCents: number;
		reversedAmountInCents: number;
		effectiveAmountInCents: number;
	};
	invoice: {
		id: string;
		paidAmountInCents: number;
		status: (typeof invoice.$inferSelect)["status"];
		paidAt: Date | null;
	};
	replayed: boolean;
};

const reversalSelection = {
	id: paymentReversal.id,
	invoiceId: paymentReversal.invoiceId,
	paymentId: paymentReversal.paymentId,
	amountInCents: paymentReversal.amountInCents,
	reason: paymentReversal.reason,
	reversedAt: paymentReversal.reversedAt,
	operatorUserId: paymentReversal.operatorUserId,
	operatorName: paymentReversal.operatorName,
	requestId: paymentReversal.requestId,
	createdAt: paymentReversal.createdAt,
};

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

async function assertActiveCampus(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		campusId: string;
		campusAccess: CampusAccess;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new PaymentReversalError("CAMPUS_OUT_OF_SCOPE");
	}
	const [record] = await tx
		.select({ isActive: campus.isActive })
		.from(campus)
		.where(
			and(
				eq(campus.id, input.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!record?.isActive) {
		throw new PaymentReversalError("CAMPUS_INACTIVE");
	}
}

function payloadMatches(
	record: Pick<
		PaymentReversalRecord,
		"paymentId" | "amountInCents" | "reason" | "reversedAt"
	>,
	input: CreatePaymentReversalRecordInput,
	reason: string,
): boolean {
	return (
		record.paymentId === input.paymentId &&
		record.amountInCents === input.amountInCents &&
		record.reason === reason &&
		record.reversedAt.getTime() === input.reversedAt.getTime()
	);
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error;
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

async function findByRequest(input: {
	organizationId: string;
	requestId: string;
}): Promise<PaymentReversalRecord | null> {
	const [record] = await db
		.select(reversalSelection)
		.from(paymentReversal)
		.where(
			and(
				eq(paymentReversal.organizationId, input.organizationId),
				eq(paymentReversal.requestId, input.requestId),
			),
		)
		.limit(1);
	return record ?? null;
}

export async function listPaymentReversalRecords(input: {
	organizationId: string;
	invoiceId: string;
}): Promise<PaymentReversalRecord[]> {
	return db
		.select(reversalSelection)
		.from(paymentReversal)
		.where(
			and(
				eq(paymentReversal.organizationId, input.organizationId),
				eq(paymentReversal.invoiceId, input.invoiceId),
			),
		)
		.orderBy(
			desc(paymentReversal.reversedAt),
			desc(paymentReversal.createdAt),
			desc(paymentReversal.id),
		);
}

async function loadResult(
	organizationId: string,
	reversalId: string,
	replayed: boolean,
): Promise<PaymentReversalResult> {
	const [reversal] = await db
		.select(reversalSelection)
		.from(paymentReversal)
		.where(
			and(
				eq(paymentReversal.organizationId, organizationId),
				eq(paymentReversal.id, reversalId),
			),
		)
		.limit(1);
	if (!reversal)
		throw new Error("Payment reversal result could not be loaded.");

	const [[paymentRecord], [reversed], [invoiceRecord]] = await Promise.all([
		db
			.select({ id: payment.id, amountInCents: payment.amountInCents })
			.from(payment)
			.where(
				and(
					eq(payment.organizationId, organizationId),
					eq(payment.id, reversal.paymentId),
				),
			)
			.limit(1),
		db
			.select({
				value:
					sql<number>`coalesce(sum(${paymentReversal.amountInCents}), 0)`.mapWith(
						Number,
					),
			})
			.from(paymentReversal)
			.where(
				and(
					eq(paymentReversal.organizationId, organizationId),
					eq(paymentReversal.paymentId, reversal.paymentId),
				),
			),
		db
			.select({
				id: invoice.id,
				paidAmountInCents: invoice.paidAmountInCents,
				status: invoice.status,
				paidAt: invoice.paidAt,
			})
			.from(invoice)
			.where(
				and(
					eq(invoice.organizationId, organizationId),
					eq(invoice.id, reversal.invoiceId),
				),
			)
			.limit(1),
	]);
	if (!paymentRecord || !invoiceRecord) {
		throw new Error("Payment reversal projection could not be loaded.");
	}
	const reversedAmountInCents = reversed?.value ?? 0;
	return {
		reversal,
		payment: {
			id: paymentRecord.id,
			originalAmountInCents: paymentRecord.amountInCents,
			reversedAmountInCents,
			effectiveAmountInCents: Math.max(
				paymentRecord.amountInCents - reversedAmountInCents,
				0,
			),
		},
		invoice: invoiceRecord,
		replayed,
	};
}

export async function createPaymentReversalRecord(
	input: CreatePaymentReversalRecordInput,
): Promise<PaymentReversalResult> {
	if (!Number.isSafeInteger(input.amountInCents) || input.amountInCents <= 0) {
		throw new PaymentReversalError("INVALID_REVERSAL_AMOUNT");
	}
	if (
		Number.isNaN(input.reversedAt.getTime()) ||
		input.reversedAt.getTime() > Date.now() + 5 * 60 * 1000
	) {
		throw new PaymentReversalError("INVALID_REVERSAL_TIME");
	}
	const reason = input.reason.trim();
	if (!reason) throw new PaymentReversalError("INVALID_REVERSAL_REASON");

	try {
		const result = await db.transaction(async (tx) => {
			const campusAccess = await getCurrentFinanceWriteCampusAccess(
				tx,
				{
					organizationId: input.organizationId,
					userId: input.operatorUserId,
				},
				() => new PaymentReversalError("MEMBER_FORBIDDEN"),
			);
			const [paymentLocator] = await tx
				.select({ invoiceId: payment.invoiceId })
				.from(payment)
				.where(
					and(
						eq(payment.organizationId, input.organizationId),
						eq(payment.id, input.paymentId),
					),
				)
				.limit(1);
			if (!paymentLocator) {
				throw new PaymentReversalError("PAYMENT_NOT_FOUND");
			}

			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					studentId: invoice.studentId,
					enrollmentId: invoice.enrollmentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
					paidAt: invoice.paidAt,
				})
				.from(invoice)
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.id, paymentLocator.invoiceId),
					),
				)
				.limit(1)
				.for("update");
			if (!invoiceRecord) {
				throw new PaymentReversalError("PAYMENT_NOT_FOUND");
			}

			const [paymentRecord] = await tx
				.select({
					id: payment.id,
					invoiceId: payment.invoiceId,
					amountInCents: payment.amountInCents,
				})
				.from(payment)
				.where(
					and(
						eq(payment.organizationId, input.organizationId),
						eq(payment.id, input.paymentId),
					),
				)
				.limit(1)
				.for("update");
			if (!paymentRecord || paymentRecord.invoiceId !== invoiceRecord.id) {
				throw new PaymentReversalError("PAYMENT_NOT_FOUND");
			}

			const [studentRecord] = await tx
				.select({ campusId: student.campusId })
				.from(student)
				.where(
					and(
						eq(student.organizationId, input.organizationId),
						eq(student.id, invoiceRecord.studentId),
					),
				)
				.limit(1)
				.for("key share");
			if (!studentRecord) {
				throw new PaymentReversalError("RESOURCE_UNAVAILABLE");
			}
			await assertActiveCampus(tx, {
				organizationId: input.organizationId,
				campusId: studentRecord.campusId,
				campusAccess,
			});

			const [existing] = await tx
				.select(reversalSelection)
				.from(paymentReversal)
				.where(
					and(
						eq(paymentReversal.organizationId, input.organizationId),
						eq(paymentReversal.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (!payloadMatches(existing, input, reason)) {
					throw new PaymentReversalError("IDEMPOTENCY_CONFLICT");
				}
				return { id: existing.id, replayed: true };
			}

			const [existingRefund] = await tx
				.select({ id: refund.id })
				.from(refund)
				.where(
					and(
						eq(refund.organizationId, input.organizationId),
						eq(refund.invoiceId, invoiceRecord.id),
					),
				)
				.limit(1);
			if (existingRefund) {
				throw new PaymentReversalError("INVOICE_HAS_REFUND");
			}

			const [reversed] = await tx
				.select({
					value:
						sql<number>`coalesce(sum(${paymentReversal.amountInCents}), 0)`.mapWith(
							Number,
						),
				})
				.from(paymentReversal)
				.where(
					and(
						eq(paymentReversal.organizationId, input.organizationId),
						eq(paymentReversal.paymentId, paymentRecord.id),
					),
				);
			const reversedAmountInCents = reversed?.value ?? 0;
			const effectiveAmountInCents =
				paymentRecord.amountInCents - reversedAmountInCents;
			if (effectiveAmountInCents <= 0) {
				throw new PaymentReversalError("PAYMENT_ALREADY_REVERSED");
			}
			if (input.amountInCents > effectiveAmountInCents) {
				throw new PaymentReversalError("REVERSAL_EXCEEDS_AVAILABLE");
			}
			if (
				invoiceRecord.status === "refunded" ||
				invoiceRecord.paidAmountInCents < input.amountInCents
			) {
				throw new PaymentReversalError("REVERSAL_STALE_STATE");
			}

			if (invoiceRecord.enrollmentId) {
				await tx
					.select({ id: enrollment.id })
					.from(enrollment)
					.where(
						and(
							eq(enrollment.organizationId, input.organizationId),
							eq(enrollment.id, invoiceRecord.enrollmentId),
						),
					)
					.limit(1)
					.for("update");
			}
			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.operatorUserId))
				.limit(1);
			if (!operator) {
				throw new PaymentReversalError("RESOURCE_UNAVAILABLE");
			}

			const [created] = await tx
				.insert(paymentReversal)
				.values({
					organizationId: input.organizationId,
					campusId: studentRecord.campusId,
					invoiceId: invoiceRecord.id,
					paymentId: paymentRecord.id,
					amountInCents: input.amountInCents,
					reason,
					reversedAt: input.reversedAt,
					operatorUserId: input.operatorUserId,
					operatorName: operator.name,
					requestId: input.requestId,
				})
				.returning({ id: paymentReversal.id });
			if (!created) {
				throw new PaymentReversalError("RESOURCE_UNAVAILABLE");
			}

			const paidAmountInCents =
				invoiceRecord.paidAmountInCents - input.amountInCents;
			const status =
				paidAmountInCents <= 0
					? "pending"
					: paidAmountInCents >= invoiceRecord.amountInCents
						? "paid"
						: "partial";
			await tx
				.update(invoice)
				.set({
					paidAmountInCents,
					status,
					paidAt: status === "paid" ? invoiceRecord.paidAt : null,
				})
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.id, invoiceRecord.id),
					),
				);
			if (invoiceRecord.enrollmentId) {
				await updateEnrollmentPaidAmount(
					tx,
					input.organizationId,
					invoiceRecord.enrollmentId,
				);
			}

			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "payment_reversed",
				entityType: "payment_reversal",
				entityId: created.id,
				actorUserId: input.operatorUserId,
				campusId: studentRecord.campusId,
				after: {
					invoiceId: invoiceRecord.id,
					paymentId: paymentRecord.id,
					amountInCents: input.amountInCents,
					reversedAt: input.reversedAt.toISOString(),
					requestId: input.requestId,
				},
			});

			return { id: created.id, replayed: false };
		});

		return loadResult(input.organizationId, result.id, result.replayed);
	} catch (error) {
		if (error instanceof PaymentReversalError) throw error;
		const databaseError = getDatabaseError(error);
		if (
			databaseError?.code === "23505" &&
			databaseError.constraint === "payment_reversal_org_request_uidx"
		) {
			const existing = await findByRequest(input);
			if (!existing || !payloadMatches(existing, input, reason)) {
				throw new PaymentReversalError("IDEMPOTENCY_CONFLICT");
			}
			return loadResult(input.organizationId, existing.id, true);
		}
		if (databaseError?.code === "23503") {
			throw new PaymentReversalError("RESOURCE_UNAVAILABLE");
		}
		throw error;
	}
}
