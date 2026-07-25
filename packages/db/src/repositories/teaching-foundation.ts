import { createHash } from "node:crypto";

import {
	and,
	asc,
	countDistinct,
	desc,
	eq,
	inArray,
	lte,
	sql,
} from "drizzle-orm";
import {
	campus,
	type classGroup,
	classGroupCapacityHistory,
	classroom,
	course,
	enrollment,
	makeupLesson,
	organizationMember,
	organizationMemberCampus,
	teacher,
	teacherCampus,
	teacherCapacityHistory,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { isCampusAccessible, type Transaction } from "./campus-access";
import type { CampusAccess } from "./organization";

export type TeachingRepositoryErrorCode =
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "COURSE_NOT_FOUND"
	| "COURSE_INACTIVE"
	| "COURSE_DUPLICATE"
	| "COURSE_DURATION_LOCKED"
	| "TEACHER_NOT_FOUND"
	| "TEACHER_CAMPUS_MISMATCH"
	| "CLASS_NOT_FOUND"
	| "CLASS_LOCKED"
	| "CLASS_STATUS_TRANSITION_INVALID"
	| "CLASS_HAS_SCHEDULED_LESSONS"
	| "CLASS_CAPACITY_TOO_LOW"
	| "CLASS_NOT_SCHEDULABLE"
	| "CLASS_NOT_PAUSABLE"
	| "CLASS_NOT_RESUMABLE"
	| "CLASS_ATTENDANCE_LOCKED"
	| "CLASS_FULL"
	| "CLASS_COURSE_MISMATCH"
	| "CLASS_CAMPUS_MISMATCH"
	| "CLASS_STUDENT_DUPLICATE"
	| "ENROLLMENT_NOT_FOUND"
	| "ENROLLMENT_NOT_ACTIVE"
	| "LESSON_NOT_FOUND"
	| "LESSON_NOT_CANCELLABLE"
	| "LESSON_TIME_INVALID"
	| "LESSON_DURATION_INVALID"
	| "LESSON_CONFLICT"
	| "SCHEDULE_RULE_NOT_FOUND"
	| "SCHEDULE_RULE_DUPLICATE"
	| "SCHEDULE_RULE_CONFLICT"
	| "SCHEDULE_RULE_HAS_GENERATED_LESSONS"
	| "SCHEDULE_RULE_INACTIVE"
	| "SCHEDULE_RULE_VERSION_CONFLICT"
	| "SCHEDULE_CANDIDATE_INVALID"
	| "SCHEDULE_BATCH_TOO_LARGE"
	| "IDEMPOTENCY_CONFLICT"
	| "LESSON_BULK_UPDATE_INVALID"
	| "TEACHER_BINDING_INVALID"
	| "ATTENDANCE_DRAFT_INVALID"
	| "ATTENDANCE_TOO_EARLY"
	| "LESSON_COMPLETION_INVALID"
	| "LESSON_CONSUMPTION_INSUFFICIENT"
	| "MAKEUP_LESSON_INVALID"
	| "MAKEUP_LESSON_DUPLICATE"
	| "INVALID_INPUT";

export class TeachingRepositoryError extends Error {
	constructor(
		public readonly code: TeachingRepositoryErrorCode,
		public readonly details?: {
			affectedLessons?: Array<{
				id: string;
				className: string;
				startsAt: Date;
				roomName: string;
				occupancy: number;
				capacity: number;
			}>;
		},
	) {
		super(code);
		this.name = "TeachingRepositoryError";
	}
}

export type MakeupRescheduleReason =
	| "class_paused"
	| "lesson_cancelled"
	| "lesson_completed"
	| "schedule_rule_deactivated";

export async function markMakeupLessonsNeedsReschedule(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
		effectiveFrom?: string;
		campusId: string;
		targetLessonIds: string[];
		reason: MakeupRescheduleReason;
		occurredAt: Date;
	},
) {
	if (input.targetLessonIds.length === 0) return;
	const changed = await tx
		.update(makeupLesson)
		.set({ status: "needs_reschedule", updatedAt: input.occurredAt })
		.where(
			and(
				eq(makeupLesson.organizationId, input.organizationId),
				inArray(makeupLesson.targetLessonId, input.targetLessonIds),
				eq(makeupLesson.status, "scheduled"),
			),
		)
		.returning({
			id: makeupLesson.id,
			targetLessonId: makeupLesson.targetLessonId,
		});
	for (const record of changed) {
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "makeup_lesson_needs_reschedule",
			entityType: "makeup_lesson",
			entityId: record.id,
			actorUserId: input.actorUserId,
			campusId: input.campusId,
			before: { status: "scheduled" },
			after: {
				status: "needs_reschedule",
				targetLessonId: record.targetLessonId,
				reason: input.reason,
			},
		});
	}
}

export type { Transaction } from "./campus-access";

export type MemberRole = (typeof organizationMember.$inferSelect)["role"];

export function getShanghaiDate(now = new Date()): string {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function recordTeacherCapacityHistory(
	tx: Transaction,
	input: {
		organizationId: string;
		teacherId: string;
		weeklyCapacityHours: number;
		actorUserId: string;
		effectiveFrom?: string;
		now?: Date;
	},
) {
	const now = input.now ?? new Date();
	await tx
		.insert(teacherCapacityHistory)
		.values({
			organizationId: input.organizationId,
			teacherId: input.teacherId,
			weeklyCapacityMinutes: input.weeklyCapacityHours * 60,
			effectiveFrom: input.effectiveFrom ?? getShanghaiDate(now),
			createdByUserId: input.actorUserId,
			createdAt: now,
		})
		.onConflictDoUpdate({
			target: [
				teacherCapacityHistory.teacherId,
				teacherCapacityHistory.effectiveFrom,
			],
			set: {
				weeklyCapacityMinutes: input.weeklyCapacityHours * 60,
				createdByUserId: input.actorUserId,
				createdAt: now,
			},
		});
}

export async function recordClassGroupCapacityHistory(
	tx: Transaction,
	input: {
		organizationId: string;
		classGroupId: string;
		capacity: number;
		actorUserId: string;
		effectiveFrom?: string;
		now?: Date;
	},
) {
	const now = input.now ?? new Date();
	await tx
		.insert(classGroupCapacityHistory)
		.values({
			organizationId: input.organizationId,
			classGroupId: input.classGroupId,
			capacity: input.capacity,
			effectiveFrom: input.effectiveFrom ?? getShanghaiDate(now),
			createdByUserId: input.actorUserId,
			createdAt: now,
		})
		.onConflictDoUpdate({
			target: [
				classGroupCapacityHistory.classGroupId,
				classGroupCapacityHistory.effectiveFrom,
			],
			set: {
				capacity: input.capacity,
				createdByUserId: input.actorUserId,
				createdAt: now,
			},
		});
}

export async function currentTeacherCapacityHours(
	tx: Transaction,
	organizationId: string,
	teacherId: string,
	now = new Date(),
): Promise<number | null> {
	const [record] = await tx
		.select({ minutes: teacherCapacityHistory.weeklyCapacityMinutes })
		.from(teacherCapacityHistory)
		.where(
			and(
				eq(teacherCapacityHistory.organizationId, organizationId),
				eq(teacherCapacityHistory.teacherId, teacherId),
				lte(teacherCapacityHistory.effectiveFrom, getShanghaiDate(now)),
			),
		)
		.orderBy(desc(teacherCapacityHistory.effectiveFrom))
		.limit(1);
	return record ? record.minutes / 60 : null;
}

export async function currentClassGroupCapacity(
	tx: Transaction,
	organizationId: string,
	classGroupId: string,
	now = new Date(),
): Promise<number | null> {
	const [record] = await tx
		.select({ capacity: classGroupCapacityHistory.capacity })
		.from(classGroupCapacityHistory)
		.where(
			and(
				eq(classGroupCapacityHistory.organizationId, organizationId),
				eq(classGroupCapacityHistory.classGroupId, classGroupId),
				lte(classGroupCapacityHistory.effectiveFrom, getShanghaiDate(now)),
			),
		)
		.orderBy(desc(classGroupCapacityHistory.effectiveFrom))
		.limit(1);
	return record?.capacity ?? null;
}
export type ClassStatus = (typeof classGroup.$inferSelect)["status"];

export const courseWriteRoles = new Set<MemberRole>(["owner", "admin"]);
export const academicWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
]);
export const lessonWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"teacher",
]);
export const allowedClassStatusTransitions: Record<
	ClassStatus,
	ReadonlySet<ClassStatus>
> = {
	recruiting: new Set(["recruiting", "running"]),
	running: new Set(["running", "paused", "completed"]),
	paused: new Set(["paused", "running", "completed"]),
	completed: new Set(["completed"]),
};

export function assertClassStatusTransition(
	currentStatus: ClassStatus,
	nextStatus: ClassStatus,
) {
	if (!allowedClassStatusTransitions[currentStatus].has(nextStatus)) {
		throw new TeachingRepositoryError("CLASS_STATUS_TRANSITION_INVALID");
	}
}

export async function getCurrentWriteCampusAccess(
	tx: Transaction,
	input: {
		organizationId: string;
		userId: string;
		allowedRoles: ReadonlySet<MemberRole>;
	},
): Promise<CampusAccess> {
	// 与成员权限变更共用机构锁，写入总是基于本事务读取到的最新权限。
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`,
	);
	const [member] = await tx
		.select({
			id: organizationMember.id,
			role: organizationMember.role,
			campusAccessMode: organizationMember.campusAccessMode,
		})
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.userId),
			),
		)
		.limit(1)
		.for("update");
	if (!member || !input.allowedRoles.has(member.role)) {
		throw new TeachingRepositoryError("MEMBER_FORBIDDEN");
	}
	if (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	) {
		return { kind: "all" };
	}
	const scopes = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));
	return scopes.length > 0
		? { kind: "selected", campusIds: scopes.map((item) => item.campusId) }
		: { kind: "none" };
}

export async function assertTeacherOwnsLessonIfNeeded(
	tx: Transaction,
	input: {
		organizationId: string;
		userId: string;
		teacherId: string;
	},
): Promise<void> {
	const [member] = await tx
		.select({ role: organizationMember.role })
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.userId),
			),
		)
		.limit(1);
	if (!member || !lessonWriteRoles.has(member.role)) {
		throw new TeachingRepositoryError("MEMBER_FORBIDDEN");
	}
	if (member.role !== "teacher") return;
	const [binding] = await tx
		.select({ id: teacher.id })
		.from(teacher)
		.where(
			and(
				eq(teacher.organizationId, input.organizationId),
				eq(teacher.userId, input.userId),
				eq(teacher.id, input.teacherId),
			),
		)
		.limit(1)
		.for("update");
	if (!binding) throw new TeachingRepositoryError("MEMBER_FORBIDDEN");
}

export async function assertWritableCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		campusId: string;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new TeachingRepositoryError("CAMPUS_OUT_OF_SCOPE");
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
	if (!record) throw new TeachingRepositoryError("CAMPUS_NOT_FOUND");
	if (!record.isActive) throw new TeachingRepositoryError("CAMPUS_INACTIVE");
}

export function normalizeName(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new TeachingRepositoryError("INVALID_INPUT");
	return normalized;
}

export function isUniqueError(error: unknown, constraint: string): boolean {
	if (typeof error !== "object" || error === null) return false;
	if ("code" in error && "constraint" in error) {
		return error.code === "23505" && error.constraint === constraint;
	}
	return "cause" in error && isUniqueError(error.cause, constraint);
}

export function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeRoom(value: string): string {
	const normalized = value
		.trim()
		.normalize("NFKC")
		.replace(/\s+/gu, " ")
		.toLocaleLowerCase("zh-CN");
	if (!normalized) throw new TeachingRepositoryError("INVALID_INPUT");
	return normalized;
}

export async function resolveActiveClassroom(
	tx: Transaction,
	input: {
		organizationId: string;
		campusId: string;
		roomId: string;
		classGroupId: string;
		extraAttendeeCount?: number;
	},
): Promise<typeof classroom.$inferSelect> {
	const [roomRecord] = await tx
		.select()
		.from(classroom)
		.where(
			and(
				eq(classroom.id, input.roomId),
				eq(classroom.organizationId, input.organizationId),
				eq(classroom.campusId, input.campusId),
			),
		)
		.limit(1)
		.for("update");
	if (!roomRecord) throw new TeachingRepositoryError("CAMPUS_OUT_OF_SCOPE");
	if (!roomRecord.isActive)
		throw new TeachingRepositoryError("CLASS_NOT_SCHEDULABLE");
	const [occupancy] = await tx
		.select({ value: countDistinct(enrollment.studentId) })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.classGroupId, input.classGroupId),
				eq(enrollment.status, "active"),
			),
		);
	if (
		(occupancy?.value ?? 0) + (input.extraAttendeeCount ?? 0) >
		roomRecord.capacity
	) {
		throw new TeachingRepositoryError("CLASS_FULL");
	}
	return roomRecord;
}

export function ensurePositive(value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
}

export async function assertCourseActive(
	tx: Transaction,
	organizationId: string,
	courseId: string,
): Promise<typeof course.$inferSelect> {
	const [record] = await tx
		.select()
		.from(course)
		.where(
			and(eq(course.id, courseId), eq(course.organizationId, organizationId)),
		)
		.limit(1)
		.for("update");
	if (!record) throw new TeachingRepositoryError("COURSE_NOT_FOUND");
	if (!record.isActive) throw new TeachingRepositoryError("COURSE_INACTIVE");
	return record;
}

export async function assertTeacherForCampus(
	tx: Transaction,
	input: { organizationId: string; teacherId: string; campusId: string },
): Promise<typeof teacher.$inferSelect> {
	const [record] = await tx
		.select({
			id: teacher.id,
			organizationId: teacher.organizationId,
			userId: teacher.userId,
			name: teacher.name,
			phone: teacher.phone,
			subjects: teacher.subjects,
			weeklyCapacityHours: teacher.weeklyCapacityHours,
			createdAt: teacher.createdAt,
			updatedAt: teacher.updatedAt,
		})
		.from(teacher)
		.innerJoin(
			teacherCampus,
			and(
				eq(teacherCampus.teacherId, teacher.id),
				eq(teacherCampus.campusId, input.campusId),
			),
		)
		.where(
			and(
				eq(teacher.id, input.teacherId),
				eq(teacher.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (record) return record;
	const [exists] = await tx
		.select({ id: teacher.id })
		.from(teacher)
		.where(
			and(
				eq(teacher.id, input.teacherId),
				eq(teacher.organizationId, input.organizationId),
			),
		)
		.limit(1);
	throw new TeachingRepositoryError(
		exists ? "TEACHER_CAMPUS_MISMATCH" : "TEACHER_NOT_FOUND",
	);
}
