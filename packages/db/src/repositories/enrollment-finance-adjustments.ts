import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	course,
	enrollment,
	enrollmentRenewal,
	enrollmentTransfer,
	invoice,
	invoiceFollowUp,
	refund,
	student,
	user,
} from "../schema";
import { startArrearsCycleIfNeeded } from "./arrears-workflow";
import { writeOrganizationAuditEvent } from "./audit";
import { getCurrentFinanceWriteCampusAccess } from "./finance-access";
import type { CampusAccess } from "./organization";

export type EnrollmentFinanceAdjustmentErrorCode =
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "ENROLLMENT_NOT_FOUND"
	| "ENROLLMENT_NOT_ACTIVE"
	| "COURSE_NOT_FOUND"
	| "COURSE_INACTIVE"
	| "TRANSFER_SAME_COURSE"
	| "TRANSFER_NO_REMAINING_LESSONS"
	| "TRANSFER_OUTSTANDING_INVOICE"
	| "INVOICE_NOT_FOUND"
	| "INVOICE_NOT_REFUNDABLE"
	| "REFUND_EXCEEDS_PAID"
	| "FOLLOW_UP_NOT_ALLOWED"
	| "INVALID_INPUT"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE";

export class EnrollmentFinanceAdjustmentError extends Error {
	constructor(public readonly code: EnrollmentFinanceAdjustmentErrorCode) {
		super(code);
		this.name = "EnrollmentFinanceAdjustmentError";
	}
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function campusAccessCondition(access: CampusAccess) {
	if (access.kind === "none") return sql`false`;
	return access.kind === "selected"
		? inArray(student.campusId, access.campusIds)
		: sql`true`;
}

async function getCurrentWriteCampusAccess(
	tx: Transaction,
	input: { organizationId: string; userId: string },
): Promise<CampusAccess> {
	return getCurrentFinanceWriteCampusAccess(
		tx,
		input,
		() => new EnrollmentFinanceAdjustmentError("MEMBER_FORBIDDEN"),
	);
}

async function assertActiveAccessibleCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusId: string;
		campusAccess: CampusAccess;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new EnrollmentFinanceAdjustmentError("CAMPUS_OUT_OF_SCOPE");
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
		throw new EnrollmentFinanceAdjustmentError("CAMPUS_INACTIVE");
	}
}

function assertPositiveInteger(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new EnrollmentFinanceAdjustmentError("INVALID_INPUT");
	}
}

function assertValidTime(value: Date): void {
	if (Number.isNaN(value.getTime()) || value.getTime() > Date.now() + 300_000) {
		throw new EnrollmentFinanceAdjustmentError("INVALID_INPUT");
	}
}

export type EnrollmentAdjustmentRecord = {
	id: string;
	studentId: string;
	studentName: string;
	campusId: string;
	campusName: string;
	courseId: string;
	courseName: string;
	purchasedLessons: number;
	remainingLessons: number;
	status: "active" | "frozen" | "transferred";
};

export type EnrollmentAdjustmentCourseRecord = {
	id: string;
	name: string;
};

export async function listEnrollmentAdjustmentCourseRecords(input: {
	organizationId: string;
}): Promise<EnrollmentAdjustmentCourseRecord[]> {
	return db
		.select({ id: course.id, name: course.name })
		.from(course)
		.where(
			and(
				eq(course.organizationId, input.organizationId),
				eq(course.isActive, true),
			),
		)
		.orderBy(asc(course.name), asc(course.id));
}

export async function listEnrollmentAdjustmentRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
}): Promise<EnrollmentAdjustmentRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	return db
		.select({
			id: enrollment.id,
			studentId: student.id,
			studentName: student.name,
			campusId: campus.id,
			campusName: campus.name,
			courseId: course.id,
			courseName: course.name,
			purchasedLessons: enrollment.purchasedLessons,
			remainingLessons: enrollment.remainingLessons,
			status: enrollment.status,
		})
		.from(enrollment)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, enrollment.organizationId),
			),
		)
		.innerJoin(
			campus,
			and(
				eq(campus.id, student.campusId),
				eq(campus.organizationId, enrollment.organizationId),
			),
		)
		.innerJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, enrollment.organizationId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				campusAccessCondition(input.campusAccess),
			),
		)
		.orderBy(asc(student.name), asc(course.name), asc(enrollment.id));
}

type RenewalInput = {
	organizationId: string;
	operatorUserId: string;
	enrollmentId: string;
	addedLessons: number;
	amountInCents: number;
	dueDate: string;
	requestId: string;
};

export async function renewEnrollmentRecord(input: RenewalInput): Promise<{
	enrollmentId: string;
	invoiceId: string;
	addedLessons: number;
}> {
	assertPositiveInteger(input.addedLessons);
	if (!Number.isSafeInteger(input.amountInCents) || input.amountInCents < 0) {
		throw new EnrollmentFinanceAdjustmentError("INVALID_INPUT");
	}
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.operatorUserId,
			});
			const [existing] = await tx
				.select({
					enrollmentId: enrollmentRenewal.enrollmentId,
					invoiceId: enrollmentRenewal.invoiceId,
					addedLessons: enrollmentRenewal.addedLessons,
					amountInCents: enrollmentRenewal.amountInCents,
					dueDate: enrollmentRenewal.dueDate,
				})
				.from(enrollmentRenewal)
				.where(
					and(
						eq(enrollmentRenewal.organizationId, input.organizationId),
						eq(enrollmentRenewal.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (
					existing.enrollmentId !== input.enrollmentId ||
					existing.addedLessons !== input.addedLessons ||
					existing.amountInCents !== input.amountInCents ||
					existing.dueDate !== input.dueDate
				) {
					throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
				}
				return {
					enrollmentId: existing.enrollmentId,
					invoiceId: existing.invoiceId,
					addedLessons: existing.addedLessons,
				};
			}
			const [source] = await tx
				.select({
					id: enrollment.id,
					studentId: enrollment.studentId,
					campusId: student.campusId,
					status: enrollment.status,
				})
				.from(enrollment)
				.innerJoin(student, eq(student.id, enrollment.studentId))
				.where(
					and(
						eq(enrollment.id, input.enrollmentId),
						eq(enrollment.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!source)
				throw new EnrollmentFinanceAdjustmentError("ENROLLMENT_NOT_FOUND");
			if (source.status !== "active") {
				throw new EnrollmentFinanceAdjustmentError("ENROLLMENT_NOT_ACTIVE");
			}
			await assertActiveAccessibleCampus(tx, {
				organizationId: input.organizationId,
				campusId: source.campusId,
				campusAccess: access,
			});
			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.operatorUserId))
				.limit(1);
			if (!operator)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			const [createdInvoice] = await tx
				.insert(invoice)
				.values({
					organizationId: input.organizationId,
					studentId: source.studentId,
					enrollmentId: source.id,
					source: "renewal",
					businessActivityType: "course_renewal",
					summary: "课程续费费用",
					amountInCents: input.amountInCents,
					dueDate: input.dueDate,
					createdByUserId: input.operatorUserId,
					createdByName: operator.name,
				})
				.returning({ id: invoice.id });
			if (!createdInvoice)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			const [createdRenewal] = await tx
				.insert(enrollmentRenewal)
				.values({
					organizationId: input.organizationId,
					enrollmentId: source.id,
					invoiceId: createdInvoice.id,
					addedLessons: input.addedLessons,
					amountInCents: input.amountInCents,
					dueDate: input.dueDate,
					operatorUserId: input.operatorUserId,
					requestId: input.requestId,
				})
				.returning({ id: enrollmentRenewal.id });
			if (!createdRenewal)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			await startArrearsCycleIfNeeded(tx, {
				organizationId: input.organizationId,
				invoiceId: createdInvoice.id,
				sourceType: "enrollment_renewal",
				sourceId: createdRenewal.id,
				occurredAt: new Date(),
			});
			await tx
				.update(enrollment)
				.set({
					purchasedLessons: sql`${enrollment.purchasedLessons} + ${input.addedLessons}`,
					remainingLessons: sql`${enrollment.remainingLessons} + ${input.addedLessons}`,
				})
				.where(eq(enrollment.id, source.id));
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "enrollment_renewed",
				entityType: "enrollment_renewal",
				entityId: createdRenewal.id,
				actorUserId: input.operatorUserId,
				campusId: source.campusId,
				after: {
					enrollmentId: source.id,
					invoiceId: createdInvoice.id,
					addedLessons: input.addedLessons,
					amountInCents: input.amountInCents,
					dueDate: input.dueDate,
					requestId: input.requestId,
				},
			});
			return {
				enrollmentId: source.id,
				invoiceId: createdInvoice.id,
				addedLessons: input.addedLessons,
			};
		});
	} catch (error) {
		if (error instanceof EnrollmentFinanceAdjustmentError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
		}
		throw error;
	}
}

export async function transferEnrollmentRecord(input: {
	organizationId: string;
	operatorUserId: string;
	sourceEnrollmentId: string;
	targetCourseId: string;
	requestId: string;
}): Promise<{
	sourceEnrollmentId: string;
	targetEnrollmentId: string;
	transferredLessons: number;
}> {
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.operatorUserId,
			});
			const [existing] = await tx
				.select()
				.from(enrollmentTransfer)
				.where(
					and(
						eq(enrollmentTransfer.organizationId, input.organizationId),
						eq(enrollmentTransfer.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (
					existing.sourceEnrollmentId !== input.sourceEnrollmentId ||
					existing.targetCourseId !== input.targetCourseId
				)
					throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
				return {
					sourceEnrollmentId: existing.sourceEnrollmentId,
					targetEnrollmentId: existing.targetEnrollmentId,
					transferredLessons: existing.transferredLessons,
				};
			}
			const [source] = await tx
				.select({
					id: enrollment.id,
					studentId: enrollment.studentId,
					courseId: enrollment.courseId,
					remainingLessons: enrollment.remainingLessons,
					status: enrollment.status,
					campusId: student.campusId,
				})
				.from(enrollment)
				.innerJoin(student, eq(student.id, enrollment.studentId))
				.where(
					and(
						eq(enrollment.id, input.sourceEnrollmentId),
						eq(enrollment.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!source)
				throw new EnrollmentFinanceAdjustmentError("ENROLLMENT_NOT_FOUND");
			if (source.status !== "active")
				throw new EnrollmentFinanceAdjustmentError("ENROLLMENT_NOT_ACTIVE");
			if (source.courseId === input.targetCourseId)
				throw new EnrollmentFinanceAdjustmentError("TRANSFER_SAME_COURSE");
			if (source.remainingLessons <= 0)
				throw new EnrollmentFinanceAdjustmentError(
					"TRANSFER_NO_REMAINING_LESSONS",
				);
			await assertActiveAccessibleCampus(tx, {
				organizationId: input.organizationId,
				campusId: source.campusId,
				campusAccess: access,
			});
			const [targetCourse] = await tx
				.select({ id: course.id, isActive: course.isActive })
				.from(course)
				.where(
					and(
						eq(course.id, input.targetCourseId),
						eq(course.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!targetCourse)
				throw new EnrollmentFinanceAdjustmentError("COURSE_NOT_FOUND");
			if (!targetCourse.isActive)
				throw new EnrollmentFinanceAdjustmentError("COURSE_INACTIVE");
			const [outstanding] = await tx
				.select({ id: invoice.id })
				.from(invoice)
				.where(
					and(
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.enrollmentId, source.id),
						ne(invoice.status, "refunded"),
						sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
					),
				)
				.limit(1)
				.for("update");
			if (outstanding)
				throw new EnrollmentFinanceAdjustmentError(
					"TRANSFER_OUTSTANDING_INVOICE",
				);
			const [target] = await tx
				.insert(enrollment)
				.values({
					organizationId: input.organizationId,
					studentId: source.studentId,
					courseId: targetCourse.id,
					purchasedLessons: source.remainingLessons,
					remainingLessons: source.remainingLessons,
					amountInCents: 0,
				})
				.returning({ id: enrollment.id });
			if (!target)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			const [createdTransfer] = await tx
				.insert(enrollmentTransfer)
				.values({
					organizationId: input.organizationId,
					sourceEnrollmentId: source.id,
					targetEnrollmentId: target.id,
					targetCourseId: targetCourse.id,
					transferredLessons: source.remainingLessons,
					operatorUserId: input.operatorUserId,
					requestId: input.requestId,
				})
				.returning({ id: enrollmentTransfer.id });
			if (!createdTransfer)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			await tx
				.update(enrollment)
				.set({ status: "transferred", remainingLessons: 0, classGroupId: null })
				.where(eq(enrollment.id, source.id));
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "enrollment_transferred",
				entityType: "enrollment_transfer",
				entityId: createdTransfer.id,
				actorUserId: input.operatorUserId,
				campusId: source.campusId,
				after: {
					sourceEnrollmentId: source.id,
					targetEnrollmentId: target.id,
					targetCourseId: targetCourse.id,
					transferredLessons: source.remainingLessons,
					requestId: input.requestId,
				},
			});
			return {
				sourceEnrollmentId: source.id,
				targetEnrollmentId: target.id,
				transferredLessons: source.remainingLessons,
			};
		});
	} catch (error) {
		if (error instanceof EnrollmentFinanceAdjustmentError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505")
			throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
		throw error;
	}
}

export type RefundRecord = {
	id: string;
	amountInCents: number;
	refundedAt: Date;
	method: (typeof refund.$inferSelect)["method"];
	reason: string;
	operatorName: string;
	requestId: string;
	createdAt: Date;
};

const refundSelection = {
	id: refund.id,
	amountInCents: refund.amountInCents,
	refundedAt: refund.refundedAt,
	method: refund.method,
	reason: refund.reason,
	operatorName: refund.operatorName,
	requestId: refund.requestId,
	createdAt: refund.createdAt,
};

export async function updateEnrollmentPaidAmount(
	tx: Transaction,
	organizationId: string,
	enrollmentId: string,
): Promise<void> {
	const invoices = await tx
		.select({
			id: invoice.id,
			amountInCents: invoice.amountInCents,
			paidAmountInCents: invoice.paidAmountInCents,
			status: invoice.status,
		})
		.from(invoice)
		.where(
			and(
				eq(invoice.organizationId, organizationId),
				eq(invoice.enrollmentId, enrollmentId),
				inArray(invoice.source, ["enrollment", "renewal"]),
			),
		);
	const refunds = await tx
		.select({
			invoiceId: refund.invoiceId,
			amountInCents: refund.amountInCents,
		})
		.from(refund)
		.innerJoin(invoice, eq(invoice.id, refund.invoiceId))
		.where(
			and(
				eq(refund.organizationId, organizationId),
				eq(invoice.enrollmentId, enrollmentId),
				inArray(invoice.source, ["enrollment", "renewal"]),
			),
		);
	const refundedByInvoice = new Map<string, number>();
	for (const record of refunds)
		refundedByInvoice.set(
			record.invoiceId,
			(refundedByInvoice.get(record.invoiceId) ?? 0) + record.amountInCents,
		);
	const paidAmountInCents = invoices.reduce(
		(total, record) =>
			total +
			Math.max(
				record.paidAmountInCents,
				record.status === "paid" || record.status === "refunded"
					? record.amountInCents
					: 0,
			) -
			(refundedByInvoice.get(record.id) ?? 0),
		0,
	);
	await tx
		.update(enrollment)
		.set({ paidAmountInCents })
		.where(
			and(
				eq(enrollment.id, enrollmentId),
				eq(enrollment.organizationId, organizationId),
			),
		);
}

export async function listRefundRecords(input: {
	organizationId: string;
	invoiceId: string;
}): Promise<RefundRecord[]> {
	return db
		.select(refundSelection)
		.from(refund)
		.where(
			and(
				eq(refund.organizationId, input.organizationId),
				eq(refund.invoiceId, input.invoiceId),
			),
		)
		.orderBy(desc(refund.refundedAt), desc(refund.createdAt), desc(refund.id));
}

export type ArrearsRecord = {
	invoiceId: string;
	studentName: string;
	courseName: string | null;
	source: (typeof invoice.$inferSelect)["source"];
	summary: string;
	amountInCents: number;
	paidAmountInCents: number;
	outstandingAmountInCents: number;
	dueDate: string;
	isOverdue: boolean;
	lastFollowUpAt: Date | null;
	lastFollowUpNote: string | null;
	lastFollowUpOperatorName: string | null;
};

export async function listArrearsRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	today: string;
}): Promise<ArrearsRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const invoices = await db
		.select({
			invoiceId: invoice.id,
			studentName: student.name,
			courseName: course.name,
			source: invoice.source,
			summary: invoice.summary,
			amountInCents: invoice.amountInCents,
			paidAmountInCents: invoice.paidAmountInCents,
			dueDate: invoice.dueDate,
		})
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.leftJoin(
			enrollment,
			and(
				eq(enrollment.id, invoice.enrollmentId),
				eq(enrollment.organizationId, invoice.organizationId),
			),
		)
		.leftJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				ne(invoice.status, "refunded"),
				sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
				campusAccessCondition(input.campusAccess),
			),
		)
		.orderBy(asc(invoice.dueDate), asc(student.name), asc(invoice.id));
	if (invoices.length === 0) return [];
	const followUps = await db
		.select({
			invoiceId: invoiceFollowUp.invoiceId,
			note: invoiceFollowUp.note,
			followedUpAt: invoiceFollowUp.followedUpAt,
			operatorName: invoiceFollowUp.operatorName,
		})
		.from(invoiceFollowUp)
		.where(
			and(
				eq(invoiceFollowUp.organizationId, input.organizationId),
				inArray(
					invoiceFollowUp.invoiceId,
					invoices.map((item) => item.invoiceId),
				),
			),
		)
		.orderBy(
			desc(invoiceFollowUp.followedUpAt),
			desc(invoiceFollowUp.createdAt),
			desc(invoiceFollowUp.id),
		);
	const latest = new Map<string, (typeof followUps)[number]>();
	for (const followUp of followUps)
		if (!latest.has(followUp.invoiceId))
			latest.set(followUp.invoiceId, followUp);
	return invoices.map((item) => ({
		...item,
		outstandingAmountInCents: item.amountInCents - item.paidAmountInCents,
		isOverdue: item.dueDate < input.today,
		lastFollowUpAt: latest.get(item.invoiceId)?.followedUpAt ?? null,
		lastFollowUpNote: latest.get(item.invoiceId)?.note ?? null,
		lastFollowUpOperatorName: latest.get(item.invoiceId)?.operatorName ?? null,
	}));
}

export async function createInvoiceFollowUpRecord(input: {
	organizationId: string;
	operatorUserId: string;
	invoiceId: string;
	note: string;
	followedUpAt: Date;
	requestId: string;
}): Promise<{
	invoiceId: string;
	followedUpAt: Date;
	note: string;
	operatorName: string;
}> {
	assertValidTime(input.followedUpAt);
	if (!input.note.trim())
		throw new EnrollmentFinanceAdjustmentError("INVALID_INPUT");
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.operatorUserId,
			});
			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					studentId: invoice.studentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
					campusId: student.campusId,
				})
				.from(invoice)
				.innerJoin(student, eq(student.id, invoice.studentId))
				.where(
					and(
						eq(invoice.id, input.invoiceId),
						eq(invoice.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!invoiceRecord)
				throw new EnrollmentFinanceAdjustmentError("INVOICE_NOT_FOUND");
			await assertActiveAccessibleCampus(tx, {
				organizationId: input.organizationId,
				campusId: invoiceRecord.campusId,
				campusAccess: access,
			});
			if (
				invoiceRecord.status === "refunded" ||
				invoiceRecord.amountInCents <= invoiceRecord.paidAmountInCents
			)
				throw new EnrollmentFinanceAdjustmentError("FOLLOW_UP_NOT_ALLOWED");
			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.operatorUserId))
				.limit(1);
			if (!operator)
				throw new EnrollmentFinanceAdjustmentError("RESOURCE_UNAVAILABLE");
			const [existing] = await tx
				.select({
					invoiceId: invoiceFollowUp.invoiceId,
					note: invoiceFollowUp.note,
					followedUpAt: invoiceFollowUp.followedUpAt,
					operatorName: invoiceFollowUp.operatorName,
				})
				.from(invoiceFollowUp)
				.where(
					and(
						eq(invoiceFollowUp.organizationId, input.organizationId),
						eq(invoiceFollowUp.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (
					existing.invoiceId !== input.invoiceId ||
					existing.note !== input.note.trim() ||
					existing.followedUpAt.getTime() !== input.followedUpAt.getTime()
				)
					throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
				return existing;
			}
			await tx.insert(invoiceFollowUp).values({
				organizationId: input.organizationId,
				invoiceId: input.invoiceId,
				note: input.note.trim(),
				followedUpAt: input.followedUpAt,
				operatorUserId: input.operatorUserId,
				operatorName: operator.name,
				requestId: input.requestId,
			});
			return {
				invoiceId: input.invoiceId,
				note: input.note.trim(),
				followedUpAt: input.followedUpAt,
				operatorName: operator.name,
			};
		});
	} catch (error) {
		if (error instanceof EnrollmentFinanceAdjustmentError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505")
			throw new EnrollmentFinanceAdjustmentError("IDEMPOTENCY_CONFLICT");
		throw error;
	}
}

function getDatabaseError(
	error: unknown,
): { code?: unknown; constraint?: unknown } | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error;
	return "cause" in error ? getDatabaseError(error.cause) : null;
}
