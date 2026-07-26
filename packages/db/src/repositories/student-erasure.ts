import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	attendance,
	enrollment,
	enrollmentRegistration,
	invoice,
	manualInvoiceCreation,
	organizationAuditEvent,
	type organizationMember,
	receiptDocument,
	student,
	studentContact,
	studentMerge,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	getCurrentWriteCampusAccess,
	TeachingRepositoryError,
} from "./teaching-foundation";

type MemberRole = (typeof organizationMember.$inferSelect)["role"];

const erasureRoles = new Set<MemberRole>(["owner", "admin"]);
const OUTSTANDING_INVOICE_STATUSES = ["pending", "partial", "overdue"] as const;

export type StudentErasureErrorCode =
	| "MEMBER_FORBIDDEN"
	| "STUDENT_NOT_FOUND"
	| "STUDENT_MERGED"
	| "STUDENT_ALREADY_ERASED"
	| "ERASE_CONFIRM_MISMATCH"
	| "ERASE_OUTSTANDING_INVOICE";

export class StudentErasureError extends Error {
	constructor(public readonly code: StudentErasureErrorCode) {
		super(code);
		this.name = "StudentErasureError";
	}
}

export type EraseStudentResult = {
	mode: "deleted" | "anonymized";
};

/**
 * 删除学员个人信息(#61 数据主体删除权):
 * 无任何业务历史(报名、财务、考勤、合并)的学员物理删除;
 * 有业务历史的学员在同一事务内匿名化——抹除姓名、监护人姓名/电话、
 * 出生日期、联系人、审计快照与票据姓名,保留财务金额与业务记录。
 */
export async function eraseStudentRecord(input: {
	organizationId: string;
	userId: string;
	studentId: string;
	confirmName: string;
}): Promise<EraseStudentResult> {
	return db.transaction(async (tx) => {
		try {
			await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: erasureRoles,
			});
		} catch (error) {
			if (
				error instanceof TeachingRepositoryError &&
				error.code === "MEMBER_FORBIDDEN"
			) {
				throw new StudentErasureError("MEMBER_FORBIDDEN");
			}
			throw error;
		}

		const [current] = await tx
			.select({
				id: student.id,
				name: student.name,
				mergedIntoStudentId: student.mergedIntoStudentId,
				anonymizedAt: student.anonymizedAt,
			})
			.from(student)
			.where(
				and(
					eq(student.id, input.studentId),
					eq(student.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new StudentErasureError("STUDENT_NOT_FOUND");
		if (current.mergedIntoStudentId) {
			throw new StudentErasureError("STUDENT_MERGED");
		}
		if (current.anonymizedAt) {
			throw new StudentErasureError("STUDENT_ALREADY_ERASED");
		}
		if (current.name !== input.confirmName) {
			throw new StudentErasureError("ERASE_CONFIRM_MISMATCH");
		}

		const [outstanding] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(invoice)
			.where(
				and(
					eq(invoice.studentId, current.id),
					inArray(invoice.status, [...OUTSTANDING_INVOICE_STATUSES]),
				),
			);
		if ((outstanding?.count ?? 0) > 0) {
			throw new StudentErasureError("ERASE_OUTSTANDING_INVOICE");
		}

		const [history] = await tx
			.select({
				enrollments: sql<number>`(SELECT count(*)::int FROM ${enrollment} WHERE ${enrollment.studentId} = ${current.id})`,
				registrations: sql<number>`(SELECT count(*)::int FROM ${enrollmentRegistration} WHERE ${enrollmentRegistration.studentId} = ${current.id})`,
				invoices: sql<number>`(SELECT count(*)::int FROM ${invoice} WHERE ${invoice.studentId} = ${current.id})`,
				attendances: sql<number>`(SELECT count(*)::int FROM ${attendance} WHERE ${attendance.studentId} = ${current.id})`,
				receipts: sql<number>`(SELECT count(*)::int FROM ${receiptDocument} WHERE ${receiptDocument.studentId} = ${current.id})`,
				manualInvoices: sql<number>`(SELECT count(*)::int FROM ${manualInvoiceCreation} WHERE ${manualInvoiceCreation.studentId} = ${current.id})`,
				merges: sql<number>`(SELECT count(*)::int FROM ${studentMerge} WHERE ${studentMerge.sourceStudentId} = ${current.id} OR ${studentMerge.targetStudentId} = ${current.id})`,
			})
			.from(student)
			.where(eq(student.id, current.id));
		const hasHistory =
			history !== undefined &&
			Object.values(history).some((value) => Number(value) > 0);

		// 审计表有 BEFORE UPDATE 触发器保证不可变,无法就地改写 payload;
		// 数据主体删除权优先于内部审计留存(审计本身另有 180 天保留策略),
		// 因此删除该学员的历史审计行,擦除动作以新的 student_erased 事件留痕。
		const scrubAuditEvents = () =>
			tx
				.delete(organizationAuditEvent)
				.where(
					and(
						eq(organizationAuditEvent.organizationId, input.organizationId),
						eq(organizationAuditEvent.entityType, "student"),
						eq(organizationAuditEvent.entityId, current.id),
					),
				);

		if (!hasHistory) {
			await scrubAuditEvents();
			await tx.delete(student).where(eq(student.id, current.id));
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "student_erased",
				entityType: "student",
				entityId: current.id,
				actorUserId: input.userId,
				after: { mode: "deleted" },
			});
			return { mode: "deleted" };
		}

		const anonymizedName = `已注销学员-${randomUUID().slice(0, 8)}`;
		await tx
			.update(student)
			.set({
				name: anonymizedName,
				guardianName: "",
				guardianPhone: "",
				guardianPhoneNormalized: "",
				birthDate: null,
				anonymizedAt: new Date(),
			})
			.where(eq(student.id, current.id));
		await tx
			.delete(studentContact)
			.where(eq(studentContact.studentId, current.id));
		await scrubAuditEvents();
		await tx
			.update(receiptDocument)
			.set({ studentName: anonymizedName })
			.where(eq(receiptDocument.studentId, current.id));
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "student_erased",
			entityType: "student",
			entityId: current.id,
			actorUserId: input.userId,
			after: { mode: "anonymized" },
		});
		return { mode: "anonymized" };
	});
}
