import { createHash } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	invoice,
	refund,
	refundRequest,
	refundRequestEvent,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	campusAccessCondition,
	isCampusAccessible,
	type Transaction,
} from "./campus-access";
import { updateEnrollmentPaidAmount } from "./enrollment-finance-adjustments";
import { getCurrentFinanceWriteAccess } from "./finance-access";
import type { CampusAccess } from "./organization";

export type RefundApprovalErrorCode =
	| "INVOICE_NOT_FOUND"
	| "REFUND_REQUEST_NOT_FOUND"
	| "INVOICE_NOT_REFUNDABLE"
	| "REFUND_EXCEEDS_PAID"
	| "PENDING_REQUEST_EXISTS"
	| "REQUEST_NOT_PENDING"
	| "REQUEST_VERSION_CONFLICT"
	| "SELF_APPROVAL_FORBIDDEN"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "CANCELLATION_FORBIDDEN"
	| "INVALID_INPUT"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE";

export class RefundApprovalError extends Error {
	constructor(public readonly code: RefundApprovalErrorCode) {
		super(code);
		this.name = "RefundApprovalError";
	}
}

type RefundRequestStatus = (typeof refundRequest.$inferSelect)["status"];
type RefundRequestAction = (typeof refundRequestEvent.$inferSelect)["action"];
type PaymentMethod = (typeof refundRequest.$inferSelect)["method"];

export type RefundRequestEventRecord = {
	id: string;
	action: RefundRequestAction;
	fromStatus: RefundRequestStatus | null;
	toStatus: RefundRequestStatus;
	comment: string | null;
	operatorUserId: string;
	operatorName: string;
	requestId: string;
	createdAt: Date;
};

export type RefundRequestRecord = {
	id: string;
	invoiceId: string;
	campusId: string;
	amountInCents: number;
	refundedAt: Date;
	method: PaymentMethod;
	reason: string;
	applicantUserId: string;
	applicantName: string;
	status: RefundRequestStatus;
	version: number;
	refundId: string | null;
	createdAt: Date;
	updatedAt: Date;
	events: RefundRequestEventRecord[];
};

export type CreateRefundRequestRecordInput = {
	organizationId: string;
	operatorUserId: string;
	invoiceId: string;
	amountInCents: number;
	refundedAt: Date;
	method: PaymentMethod;
	reason: string;
	requestId: string;
};

export type DecideRefundRequestRecordInput = {
	organizationId: string;
	operatorUserId: string;
	refundRequestId: string;
	action: "approved" | "rejected";
	comment: string | null;
	expectedVersion: number;
	requestId: string;
};

export type CancelRefundRequestRecordInput = {
	organizationId: string;
	operatorUserId: string;
	refundRequestId: string;
	reason: string | null;
	expectedVersion: number;
	requestId: string;
};

const requestSelection = {
	id: refundRequest.id,
	invoiceId: refundRequest.invoiceId,
	campusId: refundRequest.campusId,
	amountInCents: refundRequest.amountInCents,
	refundedAt: refundRequest.refundedAt,
	method: refundRequest.method,
	reason: refundRequest.reason,
	applicantUserId: refundRequest.applicantUserId,
	applicantName: refundRequest.applicantName,
	status: refundRequest.status,
	version: refundRequest.version,
	refundId: refundRequest.refundId,
	createdAt: refundRequest.createdAt,
	updatedAt: refundRequest.updatedAt,
};

const eventSelection = {
	id: refundRequestEvent.id,
	action: refundRequestEvent.action,
	fromStatus: refundRequestEvent.fromStatus,
	toStatus: refundRequestEvent.toStatus,
	comment: refundRequestEvent.comment,
	operatorUserId: refundRequestEvent.operatorUserId,
	operatorName: refundRequestEvent.operatorName,
	requestId: refundRequestEvent.requestId,
	createdAt: refundRequestEvent.createdAt,
};

function normalizeOptionalText(value: string | null): string | null {
	const normalized = value?.trim() ?? "";
	return normalized || null;
}

function createInputHash(value: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertPositiveAmount(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RefundApprovalError("INVALID_INPUT");
	}
}

function assertValidRefundTime(value: Date): void {
	if (Number.isNaN(value.getTime()) || value.getTime() > Date.now() + 300_000) {
		throw new RefundApprovalError("INVALID_INPUT");
	}
}

async function assertActiveCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusId: string;
		campusAccess: CampusAccess;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new RefundApprovalError("CAMPUS_OUT_OF_SCOPE");
	}
	const [record] = await tx
		.select({ id: campus.id, isActive: campus.isActive })
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
		throw new RefundApprovalError("CAMPUS_INACTIVE");
	}
}

async function getOperatorName(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	userId: string,
): Promise<string> {
	const [operator] = await tx
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!operator) throw new RefundApprovalError("RESOURCE_UNAVAILABLE");
	return operator.name;
}

async function getRefundRequestAggregate(input: {
	organizationId: string;
	refundRequestId: string;
}): Promise<RefundRequestRecord> {
	const [request] = await db
		.select(requestSelection)
		.from(refundRequest)
		.where(
			and(
				eq(refundRequest.organizationId, input.organizationId),
				eq(refundRequest.id, input.refundRequestId),
			),
		)
		.limit(1);
	if (!request) throw new RefundApprovalError("REFUND_REQUEST_NOT_FOUND");
	const events = await db
		.select(eventSelection)
		.from(refundRequestEvent)
		.where(
			and(
				eq(refundRequestEvent.organizationId, input.organizationId),
				eq(refundRequestEvent.refundRequestId, request.id),
			),
		)
		.orderBy(refundRequestEvent.createdAt, refundRequestEvent.id);
	return { ...request, events };
}

export async function listInvoiceRefundRequestRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	invoiceId: string;
}): Promise<RefundRequestRecord[] | null> {
	const [visibleInvoice] = await db
		.select({ id: invoice.id })
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				eq(invoice.id, input.invoiceId),
				campusAccessCondition(student.campusId, input.campusAccess),
			),
		)
		.limit(1);
	if (!visibleInvoice) return null;

	const requests = await db
		.select(requestSelection)
		.from(refundRequest)
		.where(
			and(
				eq(refundRequest.organizationId, input.organizationId),
				eq(refundRequest.invoiceId, input.invoiceId),
			),
		)
		.orderBy(desc(refundRequest.createdAt), desc(refundRequest.id));
	if (requests.length === 0) return [];

	const events = await db
		.select({
			refundRequestId: refundRequestEvent.refundRequestId,
			...eventSelection,
		})
		.from(refundRequestEvent)
		.where(
			and(
				eq(refundRequestEvent.organizationId, input.organizationId),
				inArray(
					refundRequestEvent.refundRequestId,
					requests.map((request) => request.id),
				),
			),
		)
		.orderBy(refundRequestEvent.createdAt, refundRequestEvent.id);
	const eventsByRequest = new Map<string, RefundRequestEventRecord[]>();
	for (const event of events) {
		const { refundRequestId, ...record } = event;
		const current = eventsByRequest.get(refundRequestId) ?? [];
		current.push(record);
		eventsByRequest.set(refundRequestId, current);
	}
	return requests.map((request) => ({
		...request,
		events: eventsByRequest.get(request.id) ?? [],
	}));
}

export async function createRefundRequestRecord(
	input: CreateRefundRequestRecordInput,
): Promise<{ request: RefundRequestRecord; replayed: boolean }> {
	assertPositiveAmount(input.amountInCents);
	assertValidRefundTime(input.refundedAt);
	const reason = input.reason.trim();
	if (!reason) throw new RefundApprovalError("INVALID_INPUT");
	const inputHash = createInputHash({
		invoiceId: input.invoiceId,
		amountInCents: input.amountInCents,
		refundedAt: input.refundedAt.toISOString(),
		method: input.method,
		reason,
	});

	try {
		const result = await db.transaction(async (tx) => {
			const access = await getCurrentFinanceWriteAccess(
				tx,
				{ organizationId: input.organizationId, userId: input.operatorUserId },
				() => new RefundApprovalError("MEMBER_FORBIDDEN"),
			);
			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					enrollmentId: invoice.enrollmentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
					campusId: student.campusId,
				})
				.from(invoice)
				.innerJoin(
					student,
					and(
						eq(student.id, invoice.studentId),
						eq(student.organizationId, invoice.organizationId),
					),
				)
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.id, input.invoiceId),
					),
				)
				.limit(1)
				.for("update");
			if (!invoiceRecord) throw new RefundApprovalError("INVOICE_NOT_FOUND");
			await assertActiveCampus(tx, {
				organizationId: input.organizationId,
				campusId: invoiceRecord.campusId,
				campusAccess: access.campusAccess,
			});

			const [existing] = await tx
				.select({ id: refundRequest.id, inputHash: refundRequest.inputHash })
				.from(refundRequest)
				.where(
					and(
						eq(refundRequest.organizationId, input.organizationId),
						eq(refundRequest.submissionRequestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (existing.inputHash !== inputHash) {
					throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
				}
				return { id: existing.id, replayed: true };
			}

			if (invoiceRecord.status !== "paid") {
				throw new RefundApprovalError("INVOICE_NOT_REFUNDABLE");
			}
			const [refundTotal] = await tx
				.select({
					value: sql<number>`coalesce(sum(${refund.amountInCents}), 0)`.mapWith(
						Number,
					),
				})
				.from(refund)
				.where(
					and(
						eq(refund.organizationId, input.organizationId),
						eq(refund.invoiceId, invoiceRecord.id),
					),
				);
			const paidAmountInCents = Math.max(
				invoiceRecord.paidAmountInCents,
				invoiceRecord.amountInCents,
			);
			if ((refundTotal?.value ?? 0) + input.amountInCents > paidAmountInCents) {
				throw new RefundApprovalError("REFUND_EXCEEDS_PAID");
			}
			const [pending] = await tx
				.select({ id: refundRequest.id })
				.from(refundRequest)
				.where(
					and(
						eq(refundRequest.organizationId, input.organizationId),
						eq(refundRequest.invoiceId, input.invoiceId),
						eq(refundRequest.status, "pending"),
					),
				)
				.limit(1);
			if (pending) throw new RefundApprovalError("PENDING_REQUEST_EXISTS");

			const applicantName = await getOperatorName(tx, input.operatorUserId);
			const [created] = await tx
				.insert(refundRequest)
				.values({
					organizationId: input.organizationId,
					campusId: invoiceRecord.campusId,
					invoiceId: invoiceRecord.id,
					amountInCents: input.amountInCents,
					refundedAt: input.refundedAt,
					method: input.method,
					reason,
					applicantUserId: input.operatorUserId,
					applicantName,
					submissionRequestId: input.requestId,
					inputHash,
				})
				.returning({ id: refundRequest.id });
			if (!created) throw new RefundApprovalError("RESOURCE_UNAVAILABLE");
			await tx.insert(refundRequestEvent).values({
				organizationId: input.organizationId,
				refundRequestId: created.id,
				action: "submitted",
				fromStatus: null,
				toStatus: "pending",
				comment: null,
				operatorUserId: input.operatorUserId,
				operatorName: applicantName,
				requestId: input.requestId,
				inputHash,
			});
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "refund_request_submitted",
				entityType: "refund_request",
				entityId: created.id,
				actorUserId: input.operatorUserId,
				campusId: invoiceRecord.campusId,
				after: {
					invoiceId: invoiceRecord.id,
					amountInCents: input.amountInCents,
					status: "pending",
					requestId: input.requestId,
				},
			});
			return { id: created.id, replayed: false };
		});

		return {
			request: await getRefundRequestAggregate({
				organizationId: input.organizationId,
				refundRequestId: result.id,
			}),
			replayed: result.replayed,
		};
	} catch (error) {
		if (error instanceof RefundApprovalError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			if (
				databaseError.constraint === "refund_request_org_invoice_pending_uidx"
			) {
				throw new RefundApprovalError("PENDING_REQUEST_EXISTS");
			}
			throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
		}
		throw error;
	}
}

export async function decideRefundRequestRecord(
	input: DecideRefundRequestRecordInput,
): Promise<{ request: RefundRequestRecord; replayed: boolean }> {
	if (
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion <= 0
	) {
		throw new RefundApprovalError("INVALID_INPUT");
	}
	const comment = normalizeOptionalText(input.comment);
	if (input.action === "rejected" && !comment) {
		throw new RefundApprovalError("INVALID_INPUT");
	}
	const inputHash = createInputHash({
		refundRequestId: input.refundRequestId,
		action: input.action,
		comment,
		expectedVersion: input.expectedVersion,
	});

	try {
		const result = await db.transaction(async (tx) => {
			const access = await getCurrentFinanceWriteAccess(
				tx,
				{ organizationId: input.organizationId, userId: input.operatorUserId },
				() => new RefundApprovalError("MEMBER_FORBIDDEN"),
			);
			if (access.role !== "owner" && access.role !== "admin") {
				throw new RefundApprovalError("MEMBER_FORBIDDEN");
			}
			const [request] = await tx
				.select()
				.from(refundRequest)
				.where(
					and(
						eq(refundRequest.organizationId, input.organizationId),
						eq(refundRequest.id, input.refundRequestId),
					),
				)
				.limit(1)
				.for("update");
			if (!request) {
				throw new RefundApprovalError("REFUND_REQUEST_NOT_FOUND");
			}
			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					enrollmentId: invoice.enrollmentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
					campusId: student.campusId,
				})
				.from(invoice)
				.innerJoin(
					student,
					and(
						eq(student.id, invoice.studentId),
						eq(student.organizationId, invoice.organizationId),
					),
				)
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.id, request.invoiceId),
					),
				)
				.limit(1)
				.for("update");
			if (!invoiceRecord || invoiceRecord.campusId !== request.campusId) {
				throw new RefundApprovalError("RESOURCE_UNAVAILABLE");
			}
			await assertActiveCampus(tx, {
				organizationId: input.organizationId,
				campusId: request.campusId,
				campusAccess: access.campusAccess,
			});

			const [existingEvent] = await tx
				.select({
					refundRequestId: refundRequestEvent.refundRequestId,
					inputHash: refundRequestEvent.inputHash,
				})
				.from(refundRequestEvent)
				.where(
					and(
						eq(refundRequestEvent.organizationId, input.organizationId),
						eq(refundRequestEvent.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existingEvent) {
				if (
					existingEvent.refundRequestId !== request.id ||
					existingEvent.inputHash !== inputHash
				) {
					throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
				}
				return { id: request.id, replayed: true };
			}

			if (request.status !== "pending") {
				throw new RefundApprovalError("REQUEST_NOT_PENDING");
			}
			if (request.version !== input.expectedVersion) {
				throw new RefundApprovalError("REQUEST_VERSION_CONFLICT");
			}
			if (request.applicantUserId === input.operatorUserId) {
				throw new RefundApprovalError("SELF_APPROVAL_FORBIDDEN");
			}
			const operatorName = await getOperatorName(tx, input.operatorUserId);
			let refundId: string | null = null;

			if (input.action === "approved") {
				if (invoiceRecord.status !== "paid") {
					throw new RefundApprovalError("INVOICE_NOT_REFUNDABLE");
				}
				const [refundTotal] = await tx
					.select({
						value:
							sql<number>`coalesce(sum(${refund.amountInCents}), 0)`.mapWith(
								Number,
							),
					})
					.from(refund)
					.where(
						and(
							eq(refund.organizationId, input.organizationId),
							eq(refund.invoiceId, invoiceRecord.id),
						),
					);
				const paidAmountInCents = Math.max(
					invoiceRecord.paidAmountInCents,
					invoiceRecord.amountInCents,
				);
				const nextRefundTotal =
					(refundTotal?.value ?? 0) + request.amountInCents;
				if (nextRefundTotal > paidAmountInCents) {
					throw new RefundApprovalError("REFUND_EXCEEDS_PAID");
				}
				const [createdRefund] = await tx
					.insert(refund)
					.values({
						organizationId: input.organizationId,
						invoiceId: invoiceRecord.id,
						amountInCents: request.amountInCents,
						refundedAt: request.refundedAt,
						method: request.method,
						reason: request.reason,
						operatorUserId: input.operatorUserId,
						operatorName,
						requestId: input.requestId,
					})
					.returning({ id: refund.id });
				if (!createdRefund) {
					throw new RefundApprovalError("RESOURCE_UNAVAILABLE");
				}
				refundId = createdRefund.id;
				if (nextRefundTotal === paidAmountInCents) {
					await tx
						.update(invoice)
						.set({ status: "refunded" })
						.where(
							and(
								eq(invoice.id, invoiceRecord.id),
								eq(invoice.organizationId, input.organizationId),
							),
						);
				}
				if (invoiceRecord.enrollmentId) {
					await updateEnrollmentPaidAmount(
						tx,
						input.organizationId,
						invoiceRecord.enrollmentId,
					);
				}
				await writeOrganizationAuditEvent(tx, {
					organizationId: input.organizationId,
					action: "refund_created",
					entityType: "refund",
					entityId: createdRefund.id,
					actorUserId: input.operatorUserId,
					campusId: request.campusId,
					after: {
						invoiceId: invoiceRecord.id,
						enrollmentId: invoiceRecord.enrollmentId,
						amountInCents: request.amountInCents,
						method: request.method,
						refundedAt: request.refundedAt.toISOString(),
						requestId: input.requestId,
					},
				});
			}

			await tx.insert(refundRequestEvent).values({
				organizationId: input.organizationId,
				refundRequestId: request.id,
				action: input.action,
				fromStatus: "pending",
				toStatus: input.action,
				comment,
				operatorUserId: input.operatorUserId,
				operatorName,
				requestId: input.requestId,
				inputHash,
			});
			await tx
				.update(refundRequest)
				.set({
					status: input.action,
					version: request.version + 1,
					refundId,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(refundRequest.id, request.id),
						eq(refundRequest.organizationId, input.organizationId),
					),
				);
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action:
					input.action === "approved"
						? "refund_request_approved"
						: "refund_request_rejected",
				entityType: "refund_request",
				entityId: request.id,
				actorUserId: input.operatorUserId,
				campusId: request.campusId,
				before: { status: "pending", version: request.version },
				after: {
					invoiceId: request.invoiceId,
					refundId,
					amountInCents: request.amountInCents,
					status: input.action,
					version: request.version + 1,
					requestId: input.requestId,
				},
			});
			return { id: request.id, replayed: false };
		});

		return {
			request: await getRefundRequestAggregate({
				organizationId: input.organizationId,
				refundRequestId: result.id,
			}),
			replayed: result.replayed,
		};
	} catch (error) {
		if (error instanceof RefundApprovalError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
		}
		throw error;
	}
}

export async function cancelRefundRequestRecord(
	input: CancelRefundRequestRecordInput,
): Promise<{ request: RefundRequestRecord; replayed: boolean }> {
	if (
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion <= 0
	) {
		throw new RefundApprovalError("INVALID_INPUT");
	}
	const reason = normalizeOptionalText(input.reason);
	const inputHash = createInputHash({
		refundRequestId: input.refundRequestId,
		reason,
		expectedVersion: input.expectedVersion,
	});

	try {
		const result = await db.transaction(async (tx) => {
			const access = await getCurrentFinanceWriteAccess(
				tx,
				{ organizationId: input.organizationId, userId: input.operatorUserId },
				() => new RefundApprovalError("MEMBER_FORBIDDEN"),
			);
			const [request] = await tx
				.select()
				.from(refundRequest)
				.where(
					and(
						eq(refundRequest.organizationId, input.organizationId),
						eq(refundRequest.id, input.refundRequestId),
					),
				)
				.limit(1)
				.for("update");
			if (!request) {
				throw new RefundApprovalError("REFUND_REQUEST_NOT_FOUND");
			}
			const [invoiceRecord] = await tx
				.select({ campusId: student.campusId })
				.from(invoice)
				.innerJoin(
					student,
					and(
						eq(student.id, invoice.studentId),
						eq(student.organizationId, invoice.organizationId),
					),
				)
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.id, request.invoiceId),
					),
				)
				.limit(1)
				.for("update");
			if (!invoiceRecord || invoiceRecord.campusId !== request.campusId) {
				throw new RefundApprovalError("RESOURCE_UNAVAILABLE");
			}
			await assertActiveCampus(tx, {
				organizationId: input.organizationId,
				campusId: request.campusId,
				campusAccess: access.campusAccess,
			});

			const [existingEvent] = await tx
				.select({
					refundRequestId: refundRequestEvent.refundRequestId,
					inputHash: refundRequestEvent.inputHash,
				})
				.from(refundRequestEvent)
				.where(
					and(
						eq(refundRequestEvent.organizationId, input.organizationId),
						eq(refundRequestEvent.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existingEvent) {
				if (
					existingEvent.refundRequestId !== request.id ||
					existingEvent.inputHash !== inputHash
				) {
					throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
				}
				return { id: request.id, replayed: true };
			}

			if (request.status !== "pending") {
				throw new RefundApprovalError("REQUEST_NOT_PENDING");
			}
			if (request.version !== input.expectedVersion) {
				throw new RefundApprovalError("REQUEST_VERSION_CONFLICT");
			}
			const isApplicant = request.applicantUserId === input.operatorUserId;
			const isAdministrator =
				access.role === "owner" || access.role === "admin";
			if (!isApplicant && !isAdministrator) {
				throw new RefundApprovalError("CANCELLATION_FORBIDDEN");
			}
			if (!isApplicant && !reason) {
				throw new RefundApprovalError("INVALID_INPUT");
			}
			const operatorName = await getOperatorName(tx, input.operatorUserId);
			await tx.insert(refundRequestEvent).values({
				organizationId: input.organizationId,
				refundRequestId: request.id,
				action: "cancelled",
				fromStatus: "pending",
				toStatus: "cancelled",
				comment: reason,
				operatorUserId: input.operatorUserId,
				operatorName,
				requestId: input.requestId,
				inputHash,
			});
			await tx
				.update(refundRequest)
				.set({
					status: "cancelled",
					version: request.version + 1,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(refundRequest.id, request.id),
						eq(refundRequest.organizationId, input.organizationId),
					),
				);
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "refund_request_cancelled",
				entityType: "refund_request",
				entityId: request.id,
				actorUserId: input.operatorUserId,
				campusId: request.campusId,
				before: { status: "pending", version: request.version },
				after: {
					invoiceId: request.invoiceId,
					amountInCents: request.amountInCents,
					status: "cancelled",
					version: request.version + 1,
					requestId: input.requestId,
				},
			});
			return { id: request.id, replayed: false };
		});

		return {
			request: await getRefundRequestAggregate({
				organizationId: input.organizationId,
				refundRequestId: result.id,
			}),
			replayed: result.replayed,
		};
	} catch (error) {
		if (error instanceof RefundApprovalError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			throw new RefundApprovalError("IDEMPOTENCY_CONFLICT");
		}
		throw error;
	}
}

function getDatabaseError(
	error: unknown,
): { code?: string; constraint?: string } | null {
	if (!error || typeof error !== "object") return null;
	if ("code" in error || "constraint" in error) {
		return error as { code?: string; constraint?: string };
	}
	return "cause" in error ? getDatabaseError(error.cause) : null;
}
