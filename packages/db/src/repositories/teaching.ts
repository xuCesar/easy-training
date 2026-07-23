import { createHash } from "node:crypto";

import {
	and,
	asc,
	countDistinct,
	desc,
	eq,
	gt,
	gte,
	inArray,
	lt,
	lte,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	attendance,
	campus,
	classGroup,
	classGroupCapacityHistory,
	classroom,
	classStatusEvent,
	course,
	enrollment,
	enrollmentLifecycleEvent,
	enrollmentPurchaseCycle,
	lesson,
	lessonConsumption,
	makeupLesson,
	organizationMember,
	organizationMemberCampus,
	renewalOpportunity,
	student,
	teacher,
	teacherCampus,
	teacherCapacityHistory,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
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

type MakeupRescheduleReason =
	| "class_paused"
	| "lesson_cancelled"
	| "lesson_completed"
	| "schedule_rule_deactivated";

export async function markMakeupLessonsNeedsReschedule(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
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

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MemberRole = (typeof organizationMember.$inferSelect)["role"];

function getShanghaiDate(now = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

async function recordTeacherCapacityHistory(
	tx: Transaction,
	input: {
		organizationId: string;
		teacherId: string;
		weeklyCapacityHours: number;
		actorUserId: string;
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
			effectiveFrom: getShanghaiDate(now),
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

async function recordClassGroupCapacityHistory(
	tx: Transaction,
	input: {
		organizationId: string;
		classGroupId: string;
		capacity: number;
		actorUserId: string;
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
			effectiveFrom: getShanghaiDate(now),
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
type ClassStatus = (typeof classGroup.$inferSelect)["status"];

const courseWriteRoles = new Set<MemberRole>(["owner", "admin"]);
export const academicWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
]);
const lessonWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"teacher",
]);
const allowedClassStatusTransitions: Record<
	ClassStatus,
	ReadonlySet<ClassStatus>
> = {
	recruiting: new Set(["recruiting", "running"]),
	running: new Set(["running", "paused", "completed"]),
	paused: new Set(["paused", "running", "completed"]),
	completed: new Set(["completed"]),
};

function assertClassStatusTransition(
	currentStatus: ClassStatus,
	nextStatus: ClassStatus,
) {
	if (!allowedClassStatusTransitions[currentStatus].has(nextStatus)) {
		throw new TeachingRepositoryError("CLASS_STATUS_TRANSITION_INVALID");
	}
}

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function campusAccessCondition(access: CampusAccess) {
	if (access.kind === "none") return sql`false`;
	return access.kind === "selected"
		? inArray(classGroup.campusId, access.campusIds)
		: sql`true`;
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

async function assertTeacherOwnsLessonIfNeeded(
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

function normalizeName(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new TeachingRepositoryError("INVALID_INPUT");
	return normalized;
}

function fingerprint(value: unknown): string {
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

function ensurePositive(value: number): void {
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

export type CourseRecord = typeof course.$inferSelect;
export type TeacherRecord = typeof teacher.$inferSelect & {
	campusIds: string[];
};

export type BindableTeacherMemberRecord = {
	userId: string;
	name: string;
	email: string;
	boundTeacherId: string | null;
};

export async function listBindableTeacherMemberRecords(input: {
	organizationId: string;
}): Promise<BindableTeacherMemberRecord[]> {
	return db
		.select({
			userId: organizationMember.userId,
			name: user.name,
			email: user.email,
			boundTeacherId: teacher.id,
		})
		.from(organizationMember)
		.innerJoin(user, eq(user.id, organizationMember.userId))
		.leftJoin(
			teacher,
			and(
				eq(teacher.organizationId, input.organizationId),
				eq(teacher.userId, organizationMember.userId),
			),
		)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.role, "teacher"),
			),
		)
		.orderBy(asc(user.name), asc(organizationMember.userId));
}

async function assertBindableTeacherUser(
	tx: Transaction,
	input: { organizationId: string; boundUserId?: string | null },
): Promise<void> {
	if (!input.boundUserId) return;
	const [member] = await tx
		.select({ role: organizationMember.role })
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.boundUserId),
			),
		)
		.limit(1)
		.for("update");
	if (member?.role !== "teacher") {
		throw new TeachingRepositoryError("TEACHER_BINDING_INVALID");
	}
}

export async function listCourseRecords(input: {
	organizationId: string;
	includeInactive?: boolean;
	targetId?: string;
}): Promise<CourseRecord[]> {
	const filters = [eq(course.organizationId, input.organizationId)];
	if (!input.includeInactive) filters.push(eq(course.isActive, true));
	if (input.targetId) filters.push(eq(course.id, input.targetId));
	return db
		.select()
		.from(course)
		.where(and(...filters))
		.orderBy(asc(course.name), asc(course.id));
}

export async function createCourseRecord(
	input: Omit<CourseRecord, "id" | "createdAt" | "updatedAt" | "isActive"> & {
		userId: string;
	},
): Promise<CourseRecord> {
	ensurePositive(input.durationMinutes);
	ensurePositive(input.lessonsPerPackage);
	if (!Number.isInteger(input.listPriceInCents) || input.listPriceInCents < 0) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
	try {
		const [record] = await db.transaction(async (tx) => {
			await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: courseWriteRoles,
			});
			return tx
				.insert(course)
				.values({
					organizationId: input.organizationId,
					code: normalizeName(input.code),
					name: normalizeName(input.name),
					category: input.category,
					level: normalizeName(input.level),
					durationMinutes: input.durationMinutes,
					listPriceInCents: input.listPriceInCents,
					lessonsPerPackage: input.lessonsPerPackage,
					tags: input.tags.map(normalizeName),
				})
				.returning();
		});
		if (!record) throw new Error("Course creation did not return a record.");
		return record;
	} catch (error) {
		if (isUniqueError(error, "course_org_code_uidx")) {
			throw new TeachingRepositoryError("COURSE_DUPLICATE");
		}
		throw error;
	}
}

export async function updateCourseRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	data: Pick<
		CourseRecord,
		| "code"
		| "name"
		| "category"
		| "level"
		| "durationMinutes"
		| "listPriceInCents"
		| "lessonsPerPackage"
		| "tags"
	>;
}): Promise<CourseRecord> {
	ensurePositive(input.data.durationMinutes);
	ensurePositive(input.data.lessonsPerPackage);
	if (
		!Number.isInteger(input.data.listPriceInCents) ||
		input.data.listPriceInCents < 0
	) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
	try {
		const [record] = await db.transaction(async (tx) => {
			await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: courseWriteRoles,
			});
			const [existing] = await tx
				.select({ durationMinutes: course.durationMinutes })
				.from(course)
				.where(
					and(
						eq(course.id, input.id),
						eq(course.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!existing) throw new TeachingRepositoryError("COURSE_NOT_FOUND");
			if (existing.durationMinutes !== input.data.durationMinutes) {
				const [dependentEnrollment] = await tx
					.select({ id: enrollment.id })
					.from(enrollment)
					.where(
						and(
							eq(enrollment.organizationId, input.organizationId),
							eq(enrollment.courseId, input.id),
						),
					)
					.limit(1);
				const [dependentLesson] = await tx
					.select({ id: lesson.id })
					.from(lesson)
					.innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
					.where(
						and(
							eq(lesson.organizationId, input.organizationId),
							eq(classGroup.organizationId, input.organizationId),
							eq(classGroup.courseId, input.id),
						),
					)
					.limit(1);
				if (dependentEnrollment || dependentLesson) {
					throw new TeachingRepositoryError("COURSE_DURATION_LOCKED");
				}
			}
			return tx
				.update(course)
				.set({
					...input.data,
					code: normalizeName(input.data.code),
					name: normalizeName(input.data.name),
					level: normalizeName(input.data.level),
					tags: input.data.tags.map(normalizeName),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(course.id, input.id),
						eq(course.organizationId, input.organizationId),
					),
				)
				.returning();
		});
		if (!record) throw new TeachingRepositoryError("COURSE_NOT_FOUND");
		return record;
	} catch (error) {
		if (isUniqueError(error, "course_org_code_uidx")) {
			throw new TeachingRepositoryError("COURSE_DUPLICATE");
		}
		throw error;
	}
}

export async function setCourseActiveRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	isActive: boolean;
}): Promise<CourseRecord> {
	const [record] = await db.transaction(async (tx) => {
		await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: courseWriteRoles,
		});
		return tx
			.update(course)
			.set({ isActive: input.isActive, updatedAt: new Date() })
			.where(
				and(
					eq(course.id, input.id),
					eq(course.organizationId, input.organizationId),
				),
			)
			.returning();
	});
	if (!record) throw new TeachingRepositoryError("COURSE_NOT_FOUND");
	return record;
}

export async function listTeacherRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
}): Promise<TeacherRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const rows = await db
		.select({
			teacher,
			campusId: teacherCampus.campusId,
		})
		.from(teacher)
		.leftJoin(teacherCampus, eq(teacherCampus.teacherId, teacher.id))
		.where(eq(teacher.organizationId, input.organizationId))
		.orderBy(asc(teacher.name), asc(teacher.id), asc(teacherCampus.campusId));
	const records = new Map<string, TeacherRecord>();
	for (const row of rows) {
		const current = records.get(row.teacher.id) ?? {
			...row.teacher,
			campusIds: [],
		};
		if (
			row.campusId &&
			(input.campusAccess.kind === "all" ||
				input.campusAccess.campusIds.includes(row.campusId))
		) {
			current.campusIds.push(row.campusId);
		}
		records.set(row.teacher.id, current);
	}
	return [...records.values()].filter(
		(record) =>
			record.campusIds.length > 0 || input.campusAccess.kind === "all",
	);
}

export async function createTeacherRecord(input: {
	organizationId: string;
	userId: string;
	boundUserId?: string | null;
	name: string;
	phone: string | null;
	subjects: string[];
	weeklyCapacityHours: number;
	campusIds: string[];
}): Promise<TeacherRecord> {
	ensurePositive(input.weeklyCapacityHours);
	if (
		input.campusIds.length === 0 ||
		new Set(input.campusIds).size !== input.campusIds.length
	) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: courseWriteRoles,
			});
			await assertBindableTeacherUser(tx, input);
			for (const campusId of input.campusIds) {
				await assertWritableCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access,
					campusId,
				});
			}
			const [created] = await tx
				.insert(teacher)
				.values({
					organizationId: input.organizationId,
					userId: input.boundUserId ?? null,
					name: normalizeName(input.name),
					phone: input.phone?.trim() || null,
					subjects: input.subjects.map(normalizeName),
					weeklyCapacityHours: input.weeklyCapacityHours,
				})
				.returning();
			if (!created)
				throw new Error("Teacher creation did not return a record.");
			await recordTeacherCapacityHistory(tx, {
				organizationId: input.organizationId,
				teacherId: created.id,
				weeklyCapacityHours: created.weeklyCapacityHours,
				actorUserId: input.userId,
			});
			await tx.insert(teacherCampus).values(
				input.campusIds.map((campusId) => ({
					teacherId: created.id,
					campusId,
				})),
			);
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "teacher_binding_changed",
				entityType: "teacher",
				entityId: created.id,
				actorUserId: input.userId,
				targetUserId: input.boundUserId ?? null,
				after: { userId: input.boundUserId ?? null },
			});
			return { ...created, campusIds: input.campusIds };
		});
	} catch (error) {
		if (isUniqueError(error, "teacher_org_user_uidx")) {
			throw new TeachingRepositoryError("TEACHER_BINDING_INVALID");
		}
		throw error;
	}
}

export async function updateTeacherRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	boundUserId?: string | null;
	name: string;
	phone: string | null;
	subjects: string[];
	weeklyCapacityHours: number;
	campusIds: string[];
}): Promise<TeacherRecord> {
	ensurePositive(input.weeklyCapacityHours);
	if (
		input.campusIds.length === 0 ||
		new Set(input.campusIds).size !== input.campusIds.length
	) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: courseWriteRoles,
			});
			await assertBindableTeacherUser(tx, input);
			for (const campusId of input.campusIds) {
				await assertWritableCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access,
					campusId,
				});
			}
			const [existing] = await tx
				.select({
					userId: teacher.userId,
					weeklyCapacityHours: teacher.weeklyCapacityHours,
				})
				.from(teacher)
				.where(
					and(
						eq(teacher.id, input.id),
						eq(teacher.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!existing) throw new TeachingRepositoryError("TEACHER_NOT_FOUND");
			const boundUserId = input.boundUserId ?? null;
			const [updated] = await tx
				.update(teacher)
				.set({
					userId: boundUserId,
					name: normalizeName(input.name),
					phone: input.phone?.trim() || null,
					subjects: input.subjects.map(normalizeName),
					weeklyCapacityHours: input.weeklyCapacityHours,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(teacher.id, input.id),
						eq(teacher.organizationId, input.organizationId),
					),
				)
				.returning();
			if (!updated) throw new TeachingRepositoryError("TEACHER_NOT_FOUND");
			if (existing.weeklyCapacityHours !== updated.weeklyCapacityHours) {
				await recordTeacherCapacityHistory(tx, {
					organizationId: input.organizationId,
					teacherId: updated.id,
					weeklyCapacityHours: updated.weeklyCapacityHours,
					actorUserId: input.userId,
				});
			}
			await tx
				.delete(teacherCampus)
				.where(eq(teacherCampus.teacherId, updated.id));
			await tx.insert(teacherCampus).values(
				input.campusIds.map((campusId) => ({
					teacherId: updated.id,
					campusId,
				})),
			);
			if (existing.userId !== boundUserId) {
				await writeOrganizationAuditEvent(tx, {
					organizationId: input.organizationId,
					action: "teacher_binding_changed",
					entityType: "teacher",
					entityId: updated.id,
					actorUserId: input.userId,
					targetUserId: boundUserId ?? existing.userId,
					before: { userId: existing.userId },
					after: { userId: boundUserId },
				});
			}
			return { ...updated, campusIds: input.campusIds };
		});
	} catch (error) {
		if (isUniqueError(error, "teacher_org_user_uidx")) {
			throw new TeachingRepositoryError("TEACHER_BINDING_INVALID");
		}
		throw error;
	}
}

export type ClassGroupRecord = {
	id: string;
	name: string;
	status: (typeof classGroup.$inferSelect)["status"];
	capacity: number;
	startDate: string;
	scheduleText: string;
	campusId: string;
	campusName: string;
	courseId: string;
	courseName: string;
	teacherId: string;
	teacherName: string;
	enrollmentCount: number;
};

export type ClassEnrollmentRecord = {
	enrollmentId: string;
	studentId: string;
	studentName: string;
	remainingLessons: number;
	status: "active" | "frozen" | "transferred";
	version: number;
	classGroupId: string | null;
	className: string | null;
};

const classSelection = {
	id: classGroup.id,
	name: classGroup.name,
	status: classGroup.status,
	capacity: classGroup.capacity,
	startDate: classGroup.startDate,
	scheduleText: classGroup.scheduleText,
	campusId: classGroup.campusId,
	campusName: campus.name,
	courseId: classGroup.courseId,
	courseName: course.name,
	teacherId: classGroup.teacherId,
	teacherName: teacher.name,
	enrollmentCount: countDistinct(enrollment.studentId),
};

export async function listClassGroupRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	campusId?: string;
	status?: (typeof classGroup.$inferSelect)["status"];
	targetId?: string;
}): Promise<ClassGroupRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [
		eq(classGroup.organizationId, input.organizationId),
		campusAccessCondition(input.campusAccess),
	];
	if (input.campusId) filters.push(eq(classGroup.campusId, input.campusId));
	if (input.status) filters.push(eq(classGroup.status, input.status));
	if (input.targetId) filters.push(eq(classGroup.id, input.targetId));
	return db
		.select(classSelection)
		.from(classGroup)
		.innerJoin(
			campus,
			and(
				eq(campus.id, classGroup.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			course,
			and(
				eq(course.id, classGroup.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			teacher,
			and(
				eq(teacher.id, classGroup.teacherId),
				eq(teacher.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			enrollment,
			and(
				eq(enrollment.classGroupId, classGroup.id),
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.status, "active"),
			),
		)
		.where(and(...filters))
		.groupBy(classGroup.id, campus.name, course.name, teacher.name)
		.orderBy(
			desc(classGroup.startDate),
			asc(classGroup.name),
			asc(classGroup.id),
		);
}

async function assertClassDependencies(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		campusId: string;
		courseId: string;
		teacherId: string;
	},
) {
	await assertWritableCampus(tx, input);
	await assertCourseActive(tx, input.organizationId, input.courseId);
	await assertTeacherForCampus(tx, input);
}

export async function createClassGroupRecord(input: {
	organizationId: string;
	userId: string;
	name: string;
	campusId: string;
	courseId: string;
	teacherId: string;
	capacity: number;
	startDate: string;
}): Promise<ClassGroupRecord> {
	ensurePositive(input.capacity);
	const createdId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		await assertClassDependencies(tx, { ...input, campusAccess: access });
		const [created] = await tx
			.insert(classGroup)
			.values({
				organizationId: input.organizationId,
				name: normalizeName(input.name),
				campusId: input.campusId,
				courseId: input.courseId,
				teacherId: input.teacherId,
				capacity: input.capacity,
				// 班级只能从招生中开始，后续必须通过受控状态迁移进入其他阶段。
				status: "recruiting",
				startDate: input.startDate,
				scheduleText: "排课待定",
			})
			.returning({ id: classGroup.id });
		if (!created) throw new Error("Class creation did not return a record.");
		await recordClassGroupCapacityHistory(tx, {
			organizationId: input.organizationId,
			classGroupId: created.id,
			capacity: input.capacity,
			actorUserId: input.userId,
		});
		return created.id;
	});
	const record = (
		await listClassGroupRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === createdId);
	if (!record) throw new Error("Created class was not readable.");
	return record;
}

export async function updateClassGroupRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	name: string;
	campusId: string;
	courseId: string;
	teacherId: string;
	capacity: number;
	status: ClassStatus;
	startDate: string;
}): Promise<ClassGroupRecord> {
	ensurePositive(input.capacity);
	const updatedId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [existing] = await tx
			.select()
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, input.id),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!existing) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: existing.campusId,
		});
		if (
			(existing.status === "running" && input.status === "paused") ||
			(existing.status === "paused" && input.status === "running")
		) {
			throw new TeachingRepositoryError("CLASS_STATUS_TRANSITION_INVALID");
		}
		assertClassStatusTransition(existing.status, input.status);
		const [occupancy] = await tx
			.select({ value: countDistinct(enrollment.studentId) })
			.from(enrollment)
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					eq(enrollment.classGroupId, existing.id),
					eq(enrollment.status, "active"),
				),
			);
		if (input.capacity < (occupancy?.value ?? 0))
			throw new TeachingRepositoryError("CLASS_CAPACITY_TOO_LOW");
		const [dependentLesson] = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(eq(lesson.classGroupId, existing.id))
			.limit(1);
		if (dependentLesson || (occupancy?.value ?? 0) > 0) {
			if (
				existing.courseId !== input.courseId ||
				existing.campusId !== input.campusId
			)
				throw new TeachingRepositoryError("CLASS_LOCKED");
		}
		if (existing.status !== "completed" && input.status === "completed") {
			const [scheduledLesson] = await tx
				.select({ id: lesson.id })
				.from(lesson)
				.where(
					and(
						eq(lesson.organizationId, input.organizationId),
						eq(lesson.classGroupId, existing.id),
						eq(lesson.status, "scheduled"),
					),
				)
				.limit(1)
				.for("update");
			if (scheduledLesson) {
				throw new TeachingRepositoryError("CLASS_HAS_SCHEDULED_LESSONS");
			}
		}
		await assertClassDependencies(tx, { ...input, campusAccess: access });
		if (existing.capacity !== input.capacity) {
			await recordClassGroupCapacityHistory(tx, {
				organizationId: input.organizationId,
				classGroupId: existing.id,
				capacity: input.capacity,
				actorUserId: input.userId,
			});
		}
		await tx
			.update(classGroup)
			.set({
				name: normalizeName(input.name),
				campusId: input.campusId,
				courseId: input.courseId,
				teacherId: input.teacherId,
				capacity: input.capacity,
				status: input.status,
				startDate: input.startDate,
				updatedAt: new Date(),
			})
			.where(eq(classGroup.id, existing.id));
		return existing.id;
	});
	const record = (
		await listClassGroupRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === updatedId);
	if (!record) throw new Error("Updated class was not readable.");
	return record;
}

export async function pauseClassGroupRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	reason: string;
	futureLessonPolicy: "keep" | "cancel";
	requestId: string;
}): Promise<{
	classGroup: ClassGroupRecord;
	affectedLessonIds: string[];
	replayed: boolean;
}> {
	const reason = input.reason.trim();
	if (!reason) throw new TeachingRepositoryError("INVALID_INPUT");
	const result = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [existingEvent] = await tx
			.select()
			.from(classStatusEvent)
			.where(
				and(
					eq(classStatusEvent.organizationId, input.organizationId),
					eq(classStatusEvent.requestId, input.requestId),
				),
			)
			.limit(1)
			.for("update");
		if (existingEvent) {
			const [eventGroup] = await tx
				.select({ campusId: classGroup.campusId })
				.from(classGroup)
				.where(
					and(
						eq(classGroup.id, existingEvent.classGroupId),
						eq(classGroup.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!eventGroup) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess: access,
				campusId: eventGroup.campusId,
			});
			if (
				existingEvent.classGroupId !== input.id ||
				existingEvent.kind !== "paused" ||
				existingEvent.futureLessonPolicy !== input.futureLessonPolicy ||
				existingEvent.reason !== reason
			)
				throw new TeachingRepositoryError("IDEMPOTENCY_CONFLICT");
			return {
				classGroupId: existingEvent.classGroupId,
				affectedLessonIds: existingEvent.affectedLessonIds,
				replayed: true,
			};
		}
		const [group] = await tx
			.select()
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, input.id),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: group.campusId,
		});
		if (group.status !== "running")
			throw new TeachingRepositoryError("CLASS_NOT_PAUSABLE");
		const transactionNow = new Date();
		const futureLessons = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(lesson.classGroupId, group.id),
					eq(lesson.status, "scheduled"),
					gt(lesson.startsAt, transactionNow),
				),
			)
			.orderBy(asc(lesson.id))
			.for("update");
		const affectedLessonIds = futureLessons.map((item) => item.id);
		if (input.futureLessonPolicy === "cancel" && affectedLessonIds.length > 0) {
			await tx
				.update(lesson)
				.set({
					status: "cancelled",
					cancelledAt: transactionNow,
					cancelledByUserId: input.userId,
					cancellationReason: reason,
					version: sql`${lesson.version} + 1`,
				})
				.where(inArray(lesson.id, affectedLessonIds));
			await markMakeupLessonsNeedsReschedule(tx, {
				organizationId: input.organizationId,
				actorUserId: input.userId,
				campusId: group.campusId,
				targetLessonIds: affectedLessonIds,
				reason: "class_paused",
				occurredAt: transactionNow,
			});
		}
		await tx
			.update(classGroup)
			.set({ status: "paused", updatedAt: transactionNow })
			.where(eq(classGroup.id, group.id));
		await tx.insert(classStatusEvent).values({
			organizationId: input.organizationId,
			classGroupId: group.id,
			kind: "paused",
			futureLessonPolicy: input.futureLessonPolicy,
			reason,
			affectedLessonIds,
			requestId: input.requestId,
			actorUserId: input.userId,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "class_paused",
			entityType: "class_group",
			entityId: group.id,
			actorUserId: input.userId,
			campusId: group.campusId,
			before: { status: group.status },
			after: {
				status: "paused",
				futureLessonPolicy: input.futureLessonPolicy,
				affectedLessonCount: affectedLessonIds.length,
				requestId: input.requestId,
			},
		});
		return { classGroupId: group.id, affectedLessonIds, replayed: false };
	});
	const record = (
		await listClassGroupRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === result.classGroupId);
	if (!record) throw new Error("Paused class group was not readable.");
	return {
		classGroup: record,
		affectedLessonIds: result.affectedLessonIds,
		replayed: result.replayed,
	};
}

export async function resumeClassGroupRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	reason: string;
	requestId: string;
}): Promise<{ classGroup: ClassGroupRecord; replayed: boolean }> {
	const reason = input.reason.trim();
	if (!reason) throw new TeachingRepositoryError("INVALID_INPUT");
	const result = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [existingEvent] = await tx
			.select()
			.from(classStatusEvent)
			.where(
				and(
					eq(classStatusEvent.organizationId, input.organizationId),
					eq(classStatusEvent.requestId, input.requestId),
				),
			)
			.limit(1)
			.for("update");
		if (existingEvent) {
			const [eventGroup] = await tx
				.select({ campusId: classGroup.campusId })
				.from(classGroup)
				.where(
					and(
						eq(classGroup.id, existingEvent.classGroupId),
						eq(classGroup.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!eventGroup) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess: access,
				campusId: eventGroup.campusId,
			});
			if (
				existingEvent.classGroupId !== input.id ||
				existingEvent.kind !== "resumed" ||
				existingEvent.reason !== reason
			)
				throw new TeachingRepositoryError("IDEMPOTENCY_CONFLICT");
			return { classGroupId: existingEvent.classGroupId, replayed: true };
		}
		const [group] = await tx
			.select()
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, input.id),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: group.campusId,
		});
		if (group.status !== "paused")
			throw new TeachingRepositoryError("CLASS_NOT_RESUMABLE");
		await tx
			.update(classGroup)
			.set({ status: "running", updatedAt: new Date() })
			.where(eq(classGroup.id, group.id));
		await tx.insert(classStatusEvent).values({
			organizationId: input.organizationId,
			classGroupId: group.id,
			kind: "resumed",
			futureLessonPolicy: null,
			reason,
			affectedLessonIds: [],
			requestId: input.requestId,
			actorUserId: input.userId,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "class_resumed",
			entityType: "class_group",
			entityId: group.id,
			actorUserId: input.userId,
			campusId: group.campusId,
			before: { status: group.status },
			after: { status: "running", requestId: input.requestId },
		});
		return { classGroupId: group.id, replayed: false };
	});
	const record = (
		await listClassGroupRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === result.classGroupId);
	if (!record) throw new Error("Resumed class group was not readable.");
	return { classGroup: record, replayed: result.replayed };
}

export async function listClassEnrollmentRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	classGroupId: string;
}): Promise<ClassEnrollmentRecord[]> {
	const [group] = await db
		.select({
			id: classGroup.id,
			campusId: classGroup.campusId,
			courseId: classGroup.courseId,
		})
		.from(classGroup)
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
	if (!isCampusAccessible(input.campusAccess, group.campusId)) {
		throw new TeachingRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}
	const assignedClass = alias(classGroup, "assigned_class");
	return db
		.select({
			enrollmentId: enrollment.id,
			studentId: student.id,
			studentName: student.name,
			remainingLessons: enrollment.remainingLessons,
			status: enrollment.status,
			version: enrollment.version,
			classGroupId: enrollment.classGroupId,
			className: assignedClass.name,
		})
		.from(enrollment)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
				eq(student.campusId, group.campusId),
			),
		)
		.leftJoin(
			assignedClass,
			and(
				eq(assignedClass.id, enrollment.classGroupId),
				eq(assignedClass.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.courseId, group.courseId),
				inArray(enrollment.status, ["active", "frozen"]),
			),
		)
		.orderBy(asc(student.name), asc(enrollment.id));
}

export async function assignEnrollmentClassRecord(input: {
	organizationId: string;
	userId: string;
	enrollmentId: string;
	classGroupId: string | null;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const targetClass = input.classGroupId
			? await tx
					.select()
					.from(classGroup)
					.where(
						and(
							eq(classGroup.id, input.classGroupId),
							eq(classGroup.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update")
					.then(([record]) => record)
			: null;
		if (input.classGroupId && !targetClass) {
			throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		}
		if (targetClass) {
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess: access,
				campusId: targetClass.campusId,
			});
		}
		const [enrollmentRecord] = await tx
			.select({
				id: enrollment.id,
				studentId: enrollment.studentId,
				courseId: enrollment.courseId,
				classGroupId: enrollment.classGroupId,
				studentCampusId: student.campusId,
				status: enrollment.status,
			})
			.from(enrollment)
			.innerJoin(
				student,
				and(
					eq(student.id, enrollment.studentId),
					eq(student.organizationId, input.organizationId),
				),
			)
			.where(
				and(
					eq(enrollment.id, input.enrollmentId),
					eq(enrollment.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!enrollmentRecord)
			throw new TeachingRepositoryError("ENROLLMENT_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: enrollmentRecord.studentCampusId,
		});
		if (enrollmentRecord.status !== "active") {
			throw new TeachingRepositoryError("ENROLLMENT_NOT_ACTIVE");
		}
		if (!input.classGroupId) {
			await tx
				.update(enrollment)
				.set({ classGroupId: null })
				.where(eq(enrollment.id, enrollmentRecord.id));
			return;
		}
		if (!targetClass) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		if (targetClass.courseId !== enrollmentRecord.courseId) {
			throw new TeachingRepositoryError("CLASS_COURSE_MISMATCH");
		}
		if (targetClass.campusId !== enrollmentRecord.studentCampusId) {
			throw new TeachingRepositoryError("CLASS_CAMPUS_MISMATCH");
		}
		if (
			targetClass.status !== "recruiting" &&
			targetClass.status !== "running"
		) {
			throw new TeachingRepositoryError("CLASS_NOT_SCHEDULABLE");
		}
		const [duplicate] = await tx
			.select({ id: enrollment.id })
			.from(enrollment)
			.where(
				and(
					eq(enrollment.classGroupId, targetClass.id),
					eq(enrollment.studentId, enrollmentRecord.studentId),
					eq(enrollment.status, "active"),
				),
			)
			.limit(1)
			.for("update");
		if (duplicate && duplicate.id !== enrollmentRecord.id) {
			throw new TeachingRepositoryError("CLASS_STUDENT_DUPLICATE");
		}
		const transactionNow = new Date();
		const [conflictingMakeup] = await tx
			.select({ id: makeupLesson.id })
			.from(makeupLesson)
			.innerJoin(
				lesson,
				and(
					eq(lesson.id, makeupLesson.targetLessonId),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.innerJoin(
				enrollment,
				and(
					eq(enrollment.id, makeupLesson.sourceEnrollmentId),
					eq(enrollment.organizationId, input.organizationId),
				),
			)
			.where(
				and(
					eq(makeupLesson.organizationId, input.organizationId),
					eq(makeupLesson.status, "scheduled"),
					eq(enrollment.studentId, enrollmentRecord.studentId),
					eq(lesson.classGroupId, targetClass.id),
					eq(lesson.status, "scheduled"),
					gt(lesson.startsAt, transactionNow),
				),
			)
			.limit(1)
			.for("update");
		if (conflictingMakeup) {
			throw new TeachingRepositoryError("CLASS_STUDENT_DUPLICATE");
		}
		const [occupancy] = await tx
			.select({ value: countDistinct(enrollment.studentId) })
			.from(enrollment)
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					eq(enrollment.classGroupId, targetClass.id),
					eq(enrollment.status, "active"),
				),
			);
		if (
			(occupancy?.value ?? 0) >= targetClass.capacity &&
			enrollmentRecord.classGroupId !== targetClass.id
		) {
			throw new TeachingRepositoryError("CLASS_FULL");
		}
		if (enrollmentRecord.classGroupId !== targetClass.id) {
			const futureRooms = await tx
				.select({
					lessonId: lesson.id,
					roomId: lesson.roomId,
					className: classGroup.name,
					startsAt: lesson.startsAt,
					roomName: lesson.room,
					capacity: classroom.capacity,
				})
				.from(lesson)
				.innerJoin(
					classGroup,
					and(
						eq(classGroup.id, lesson.classGroupId),
						eq(classGroup.organizationId, input.organizationId),
					),
				)
				.innerJoin(
					classroom,
					and(
						eq(classroom.id, lesson.roomId),
						eq(classroom.organizationId, input.organizationId),
					),
				)
				.where(
					and(
						eq(lesson.organizationId, input.organizationId),
						eq(lesson.classGroupId, targetClass.id),
						eq(lesson.status, "scheduled"),
						gt(lesson.startsAt, transactionNow),
					),
				)
				.for("update");
			const makeupCounts =
				futureRooms.length > 0
					? await tx
							.select({
								lessonId: makeupLesson.targetLessonId,
								value: sql<number>`count(*)::int`,
							})
							.from(makeupLesson)
							.where(
								and(
									eq(makeupLesson.organizationId, input.organizationId),
									eq(makeupLesson.status, "scheduled"),
									inArray(
										makeupLesson.targetLessonId,
										futureRooms.map((item) => item.lessonId),
									),
								),
							)
							.groupBy(makeupLesson.targetLessonId)
					: [];
			const makeupCountByLessonId = new Map(
				makeupCounts.map((item) => [item.lessonId, item.value]),
			);
			const affectedLessons = futureRooms
				.map((item) => ({
					id: item.lessonId,
					className: item.className,
					startsAt: item.startsAt,
					roomName: item.roomName,
					occupancy:
						(occupancy?.value ?? 0) +
						(makeupCountByLessonId.get(item.lessonId) ?? 0) +
						1,
					capacity: item.capacity,
				}))
				.filter((item) => item.occupancy > item.capacity);
			if (affectedLessons.length > 0) {
				throw new TeachingRepositoryError("CLASS_FULL", { affectedLessons });
			}
		}
		await tx
			.update(enrollment)
			.set({ classGroupId: targetClass.id })
			.where(eq(enrollment.id, enrollmentRecord.id));
	});
}

export type LessonRecord = {
	id: string;
	classGroupId: string;
	className: string;
	courseId: string;
	courseName: string;
	classStatus: ClassStatus;
	pausedOverdue: boolean;
	campusId: string;
	campusName: string;
	teacherId: string;
	teacherName: string;
	room: string;
	roomId: string | null;
	startsAt: Date;
	endsAt: Date;
	status: (typeof lesson.$inferSelect)["status"];
	cancelledAt: Date | null;
	cancelledByUserId: string | null;
	cancellationReason: string | null;
	scheduleRuleId: string | null;
	scheduleRuleRevision: number | null;
	scheduleOccurrenceDate: string | null;
	isScheduleOverride: boolean;
	version: number;
	teachingSummary: string | null;
	completedAt: Date | null;
	completedByUserId: string | null;
};

export async function listLessonRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	campusId?: string;
	classGroupId?: string;
	teacherId?: string;
	from?: Date;
	to?: Date;
	targetId?: string;
}): Promise<LessonRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [eq(lesson.organizationId, input.organizationId)];
	if (input.campusAccess.kind === "selected")
		filters.push(inArray(lesson.campusId, input.campusAccess.campusIds));
	if (input.campusId) filters.push(eq(lesson.campusId, input.campusId));
	if (input.classGroupId)
		filters.push(eq(lesson.classGroupId, input.classGroupId));
	if (input.teacherId) filters.push(eq(lesson.teacherId, input.teacherId));
	if (input.from) filters.push(gte(lesson.startsAt, input.from));
	if (input.to) filters.push(lte(lesson.startsAt, input.to));
	if (input.targetId) filters.push(eq(lesson.id, input.targetId));
	const now = new Date();
	const records = await db
		.select({
			id: lesson.id,
			classGroupId: lesson.classGroupId,
			className: classGroup.name,
			courseId: course.id,
			courseName: course.name,
			classStatus: classGroup.status,
			campusId: lesson.campusId,
			campusName: campus.name,
			teacherId: lesson.teacherId,
			teacherName: teacher.name,
			room: lesson.room,
			roomId: lesson.roomId,
			startsAt: lesson.startsAt,
			endsAt: lesson.endsAt,
			status: lesson.status,
			cancelledAt: lesson.cancelledAt,
			cancelledByUserId: lesson.cancelledByUserId,
			cancellationReason: lesson.cancellationReason,
			scheduleRuleId: lesson.scheduleRuleId,
			scheduleRuleRevision: lesson.scheduleRuleRevision,
			scheduleOccurrenceDate: lesson.scheduleOccurrenceDate,
			isScheduleOverride: lesson.isScheduleOverride,
			version: lesson.version,
			teachingSummary: lesson.teachingSummary,
			completedAt: lesson.completedAt,
			completedByUserId: lesson.completedByUserId,
		})
		.from(lesson)
		.innerJoin(
			classGroup,
			and(
				eq(classGroup.id, lesson.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			course,
			and(
				eq(course.id, classGroup.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			campus,
			and(
				eq(campus.id, lesson.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			teacher,
			and(
				eq(teacher.id, lesson.teacherId),
				eq(teacher.organizationId, input.organizationId),
			),
		)
		.where(and(...filters))
		.orderBy(asc(lesson.startsAt), asc(lesson.id));
	return records.map((record) => ({
		...record,
		pausedOverdue:
			record.status === "scheduled" &&
			record.classStatus === "paused" &&
			record.startsAt <= now,
	}));
}

export async function createLessonRecord(input: {
	organizationId: string;
	userId: string;
	classGroupId: string;
	room: string;
	roomId: string;
	startsAt: Date;
	endsAt: Date;
}): Promise<LessonRecord> {
	if (input.startsAt >= input.endsAt)
		throw new TeachingRepositoryError("LESSON_TIME_INVALID");
	if (!input.roomId) throw new TeachingRepositoryError("INVALID_INPUT");
	const createdId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [group] = await tx
			.select()
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, input.classGroupId),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: group.campusId,
		});
		if (group.status !== "recruiting" && group.status !== "running")
			throw new TeachingRepositoryError("CLASS_NOT_SCHEDULABLE");
		const activeCourse = await assertCourseActive(
			tx,
			input.organizationId,
			group.courseId,
		);
		await assertTeacherForCampus(tx, {
			organizationId: input.organizationId,
			teacherId: group.teacherId,
			campusId: group.campusId,
		});
		if (
			input.endsAt.getTime() - input.startsAt.getTime() !==
			activeCourse.durationMinutes * 60_000
		)
			throw new TeachingRepositoryError("LESSON_DURATION_INVALID");
		const roomRecord = await resolveActiveClassroom(tx, {
			organizationId: input.organizationId,
			campusId: group.campusId,
			roomId: input.roomId,
			classGroupId: group.id,
		});
		const room = roomRecord.name;
		const normalizedRoom = normalizeRoom(room);
		const conflicts = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(lesson.status, "scheduled"),
					lt(lesson.startsAt, input.endsAt),
					gt(lesson.endsAt, input.startsAt),
					or(
						eq(lesson.teacherId, group.teacherId),
						and(
							eq(lesson.campusId, group.campusId),
							or(
								eq(lesson.roomId, roomRecord.id),
								sql`lower(regexp_replace(trim(${lesson.room}), '\\s+', ' ', 'g')) = ${normalizedRoom}`,
							),
						),
					),
				),
			)
			.limit(1)
			.for("update");
		if (conflicts.length > 0)
			throw new TeachingRepositoryError("LESSON_CONFLICT");
		const [created] = await tx
			.insert(lesson)
			.values({
				organizationId: input.organizationId,
				classGroupId: group.id,
				teacherId: group.teacherId,
				campusId: group.campusId,
				room,
				roomId: roomRecord.id,
				startsAt: input.startsAt,
				endsAt: input.endsAt,
			})
			.returning({ id: lesson.id });
		if (!created) throw new Error("Lesson creation did not return a record.");
		return created.id;
	});
	const record = (
		await listLessonRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === createdId);
	if (!record) throw new Error("Created lesson was not readable.");
	return record;
}

export type MakeupLessonRecord = {
	id: string;
	organizationId: string;
	sourceLessonId: string;
	sourceEnrollmentId: string;
	targetLessonId: string;
	studentId: string;
	studentName: string;
	courseId: string;
	courseName: string;
	campusId: string;
	targetClassGroupId: string;
	targetClassName: string;
	targetStartsAt: Date;
	status: (typeof makeupLesson.$inferSelect)["status"];
	requestId: string;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
};

export async function listMakeupLessonRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	campusId?: string;
	sourceEnrollmentId?: string;
	targetLessonId?: string;
	status?: (typeof makeupLesson.$inferSelect)["status"];
}): Promise<MakeupLessonRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const sourceLesson = alias(lesson, "makeup_source_lesson");
	const targetLesson = alias(lesson, "makeup_target_lesson");
	const targetClass = alias(classGroup, "makeup_target_class");
	const filters = [eq(makeupLesson.organizationId, input.organizationId)];
	if (input.campusAccess.kind === "selected") {
		filters.push(inArray(targetLesson.campusId, input.campusAccess.campusIds));
	}
	if (input.campusId) filters.push(eq(targetLesson.campusId, input.campusId));
	if (input.sourceEnrollmentId) {
		filters.push(eq(makeupLesson.sourceEnrollmentId, input.sourceEnrollmentId));
	}
	if (input.targetLessonId) {
		filters.push(eq(makeupLesson.targetLessonId, input.targetLessonId));
	}
	if (input.status) filters.push(eq(makeupLesson.status, input.status));
	return db
		.select({
			id: makeupLesson.id,
			organizationId: makeupLesson.organizationId,
			sourceLessonId: makeupLesson.sourceLessonId,
			sourceEnrollmentId: makeupLesson.sourceEnrollmentId,
			targetLessonId: makeupLesson.targetLessonId,
			studentId: enrollment.studentId,
			studentName: student.name,
			courseId: enrollment.courseId,
			courseName: course.name,
			campusId: targetLesson.campusId,
			targetClassGroupId: targetLesson.classGroupId,
			targetClassName: targetClass.name,
			targetStartsAt: targetLesson.startsAt,
			status: makeupLesson.status,
			requestId: makeupLesson.requestId,
			createdByUserId: makeupLesson.createdByUserId,
			createdAt: makeupLesson.createdAt,
			updatedAt: makeupLesson.updatedAt,
		})
		.from(makeupLesson)
		.innerJoin(
			sourceLesson,
			and(
				eq(sourceLesson.id, makeupLesson.sourceLessonId),
				eq(sourceLesson.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			targetLesson,
			and(
				eq(targetLesson.id, makeupLesson.targetLessonId),
				eq(targetLesson.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			targetClass,
			and(
				eq(targetClass.id, targetLesson.classGroupId),
				eq(targetClass.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			enrollment,
			and(
				eq(enrollment.id, makeupLesson.sourceEnrollmentId),
				eq(enrollment.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.where(and(...filters))
		.orderBy(desc(targetLesson.startsAt), desc(makeupLesson.createdAt));
}

async function getMakeupLessonById(input: {
	organizationId: string;
	id: string;
}): Promise<MakeupLessonRecord> {
	const record = (
		await listMakeupLessonRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === input.id);
	if (!record) throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
	return record;
}

export async function createMakeupLessonRecord(input: {
	organizationId: string;
	userId: string;
	sourceLessonId: string;
	sourceEnrollmentId: string;
	targetLessonId: string;
	requestId: string;
}): Promise<{ makeupLesson: MakeupLessonRecord; replayed: boolean }> {
	const requestFingerprint = fingerprint({
		sourceLessonId: input.sourceLessonId,
		sourceEnrollmentId: input.sourceEnrollmentId,
		targetLessonId: input.targetLessonId,
	});
	try {
		const result = await db.transaction(async (tx) => {
			const access = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: academicWriteRoles,
			});
			const [existingRequest] = await tx
				.select()
				.from(makeupLesson)
				.where(
					and(
						eq(makeupLesson.organizationId, input.organizationId),
						eq(makeupLesson.requestId, input.requestId),
					),
				)
				.limit(1)
				.for("update");
			if (existingRequest) {
				const [replayTargetLesson] = await tx
					.select({ campusId: lesson.campusId })
					.from(lesson)
					.where(
						and(
							eq(lesson.id, existingRequest.targetLessonId),
							eq(lesson.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update");
				if (!replayTargetLesson)
					throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
				await assertWritableCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access,
					campusId: replayTargetLesson.campusId,
				});
				if (existingRequest.requestFingerprint !== requestFingerprint) {
					throw new TeachingRepositoryError("IDEMPOTENCY_CONFLICT");
				}
				return { id: existingRequest.id, replayed: true };
			}
			const lessonIds = [
				...new Set([input.sourceLessonId, input.targetLessonId]),
			].sort();
			const lockedLessons = await tx
				.select()
				.from(lesson)
				.where(
					and(
						eq(lesson.organizationId, input.organizationId),
						inArray(lesson.id, lessonIds),
					),
				)
				.orderBy(asc(lesson.id))
				.for("update");
			const sourceLesson = lockedLessons.find(
				(item) => item.id === input.sourceLessonId,
			);
			const targetLesson = lockedLessons.find(
				(item) => item.id === input.targetLessonId,
			);
			if (
				!sourceLesson ||
				!targetLesson ||
				sourceLesson.id === targetLesson.id
			) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess: access,
				campusId: targetLesson.campusId,
			});
			if (sourceLesson.campusId !== targetLesson.campusId) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			const [sourceGroup, targetGroup] = await tx
				.select()
				.from(classGroup)
				.where(
					and(
						eq(classGroup.organizationId, input.organizationId),
						inArray(classGroup.id, [
							sourceLesson.classGroupId,
							targetLesson.classGroupId,
						]),
					),
				)
				.orderBy(asc(classGroup.id))
				.for("update")
				.then((groups) => [
					groups.find((item) => item.id === sourceLesson.classGroupId),
					groups.find((item) => item.id === targetLesson.classGroupId),
				]);
			if (
				!sourceGroup ||
				!targetGroup ||
				sourceGroup.courseId !== targetGroup.courseId ||
				targetGroup.status === "paused" ||
				targetGroup.status === "completed" ||
				sourceLesson.status !== "completed" ||
				targetLesson.status !== "scheduled" ||
				targetLesson.startsAt <= new Date()
			) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			const [sourceEnrollment] = await tx
				.select({
					id: enrollment.id,
					studentId: enrollment.studentId,
					courseId: enrollment.courseId,
					status: enrollment.status,
					studentCampusId: student.campusId,
				})
				.from(enrollment)
				.innerJoin(
					student,
					and(
						eq(student.id, enrollment.studentId),
						eq(student.organizationId, input.organizationId),
					),
				)
				.where(
					and(
						eq(enrollment.id, input.sourceEnrollmentId),
						eq(enrollment.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (
				sourceEnrollment?.status !== "active" ||
				sourceEnrollment.courseId !== sourceGroup.courseId ||
				sourceEnrollment.studentCampusId !== sourceLesson.campusId
			) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			const [sourceAttendance] = await tx
				.select({ status: attendance.status })
				.from(attendance)
				.where(
					and(
						eq(attendance.lessonId, sourceLesson.id),
						eq(attendance.studentId, sourceEnrollment.studentId),
					),
				)
				.limit(1)
				.for("update");
			if (
				sourceAttendance?.status !== "absent" &&
				sourceAttendance?.status !== "leave"
			) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			const [fulfilledMakeup] = await tx
				.select({ id: makeupLesson.id })
				.from(makeupLesson)
				.where(
					and(
						eq(makeupLesson.organizationId, input.organizationId),
						eq(makeupLesson.sourceLessonId, sourceLesson.id),
						eq(makeupLesson.sourceEnrollmentId, sourceEnrollment.id),
						eq(makeupLesson.status, "fulfilled"),
					),
				)
				.limit(1)
				.for("update");
			if (fulfilledMakeup) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_DUPLICATE");
			}
			const [targetMembership] = await tx
				.select({ id: enrollment.id })
				.from(enrollment)
				.where(
					and(
						eq(enrollment.organizationId, input.organizationId),
						eq(enrollment.classGroupId, targetGroup.id),
						eq(enrollment.studentId, sourceEnrollment.studentId),
						eq(enrollment.status, "active"),
					),
				)
				.limit(1)
				.for("update");
			if (targetMembership) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			if (!targetLesson.roomId) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
			}
			// 教室行锁串行化同一目标课次的补课容量检查，避免并发超容。
			await resolveActiveClassroom(tx, {
				organizationId: input.organizationId,
				campusId: targetLesson.campusId,
				roomId: targetLesson.roomId,
				classGroupId: targetGroup.id,
			});
			const makeupEnrollment = alias(enrollment, "target_makeup_enrollment");
			const existingTargetMakeups = await tx
				.select({ studentId: makeupEnrollment.studentId })
				.from(makeupLesson)
				.innerJoin(
					makeupEnrollment,
					and(
						eq(makeupEnrollment.id, makeupLesson.sourceEnrollmentId),
						eq(makeupEnrollment.organizationId, input.organizationId),
					),
				)
				.where(
					and(
						eq(makeupLesson.organizationId, input.organizationId),
						eq(makeupLesson.targetLessonId, targetLesson.id),
						eq(makeupLesson.status, "scheduled"),
					),
				)
				.for("update");
			if (
				existingTargetMakeups.some(
					(item) => item.studentId === sourceEnrollment.studentId,
				)
			) {
				throw new TeachingRepositoryError("MAKEUP_LESSON_DUPLICATE");
			}
			await resolveActiveClassroom(tx, {
				organizationId: input.organizationId,
				campusId: targetLesson.campusId,
				roomId: targetLesson.roomId,
				classGroupId: targetGroup.id,
				extraAttendeeCount: existingTargetMakeups.length + 1,
			});
			const [created] = await tx
				.insert(makeupLesson)
				.values({
					organizationId: input.organizationId,
					sourceLessonId: sourceLesson.id,
					sourceEnrollmentId: sourceEnrollment.id,
					targetLessonId: targetLesson.id,
					requestId: input.requestId,
					requestFingerprint,
					createdByUserId: input.userId,
				})
				.returning({ id: makeupLesson.id });
			if (!created)
				throw new Error("Makeup lesson creation did not return a record.");
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "makeup_lesson_created",
				entityType: "makeup_lesson",
				entityId: created.id,
				actorUserId: input.userId,
				campusId: targetLesson.campusId,
				after: {
					sourceLessonId: sourceLesson.id,
					sourceEnrollmentId: sourceEnrollment.id,
					targetLessonId: targetLesson.id,
					requestId: input.requestId,
				},
			});
			return { id: created.id, replayed: false };
		});
		return {
			makeupLesson: await getMakeupLessonById({
				organizationId: input.organizationId,
				id: result.id,
			}),
			replayed: result.replayed,
		};
	} catch (error) {
		if (isUniqueError(error, "makeup_lesson_org_request_uidx")) {
			const existingRequest = await db.transaction(async (tx) => {
				const access = await getCurrentWriteCampusAccess(tx, {
					organizationId: input.organizationId,
					userId: input.userId,
					allowedRoles: academicWriteRoles,
				});
				const [record] = await tx
					.select()
					.from(makeupLesson)
					.where(
						and(
							eq(makeupLesson.organizationId, input.organizationId),
							eq(makeupLesson.requestId, input.requestId),
						),
					)
					.limit(1)
					.for("update");
				if (!record) return null;
				const [target] = await tx
					.select({ campusId: lesson.campusId })
					.from(lesson)
					.where(
						and(
							eq(lesson.id, record.targetLessonId),
							eq(lesson.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update");
				if (!target) throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
				await assertWritableCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access,
					campusId: target.campusId,
				});
				return record;
			});
			if (!existingRequest) throw error;
			if (existingRequest.requestFingerprint !== requestFingerprint) {
				throw new TeachingRepositoryError("IDEMPOTENCY_CONFLICT");
			}
			return {
				makeupLesson: await getMakeupLessonById({
					organizationId: input.organizationId,
					id: existingRequest.id,
				}),
				replayed: true,
			};
		}
		if (isUniqueError(error, "makeup_lesson_source_active_uidx")) {
			throw new TeachingRepositoryError("MAKEUP_LESSON_DUPLICATE");
		}
		throw error;
	}
}

export async function cancelMakeupLessonRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
}): Promise<{ makeupLesson: MakeupLessonRecord; replayed: boolean }> {
	const result = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [existing] = await tx
			.select()
			.from(makeupLesson)
			.where(
				and(
					eq(makeupLesson.id, input.id),
					eq(makeupLesson.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!existing) throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
		const [targetLesson] = await tx
			.select({
				campusId: lesson.campusId,
				status: lesson.status,
				startsAt: lesson.startsAt,
			})
			.from(lesson)
			.where(
				and(
					eq(lesson.id, existing.targetLessonId),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!targetLesson)
			throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: targetLesson.campusId,
		});
		if (existing.status === "cancelled") return { replayed: true };
		if (
			existing.status === "fulfilled" ||
			targetLesson.status !== "scheduled" ||
			targetLesson.startsAt <= new Date()
		) {
			throw new TeachingRepositoryError("MAKEUP_LESSON_INVALID");
		}
		await tx
			.update(makeupLesson)
			.set({ status: "cancelled", updatedAt: new Date() })
			.where(eq(makeupLesson.id, existing.id));
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "makeup_lesson_cancelled",
			entityType: "makeup_lesson",
			entityId: existing.id,
			actorUserId: input.userId,
			campusId: targetLesson.campusId,
			before: { status: existing.status },
			after: { status: "cancelled" },
		});
		return { replayed: false };
	});
	return {
		makeupLesson: await getMakeupLessonById({
			organizationId: input.organizationId,
			id: input.id,
		}),
		replayed: result.replayed,
	};
}

export async function cancelLessonRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	reason: string | null;
}): Promise<LessonRecord> {
	const cancelledId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [existing] = await tx
			.select()
			.from(lesson)
			.where(
				and(
					eq(lesson.id, input.id),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!existing) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: existing.campusId,
		});
		if (existing.status !== "scheduled")
			throw new TeachingRepositoryError("LESSON_NOT_CANCELLABLE");
		await tx
			.update(lesson)
			.set({
				status: "cancelled",
				cancelledAt: new Date(),
				cancelledByUserId: input.userId,
				cancellationReason: input.reason?.trim() || null,
			})
			.where(eq(lesson.id, existing.id));
		await markMakeupLessonsNeedsReschedule(tx, {
			organizationId: input.organizationId,
			actorUserId: input.userId,
			campusId: existing.campusId,
			targetLessonIds: [existing.id],
			reason: "lesson_cancelled",
			occurredAt: new Date(),
		});
		return existing.id;
	});
	const record = (
		await listLessonRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === cancelledId);
	if (!record) throw new Error("Cancelled lesson was not readable.");
	return record;
}

export type LessonAttendanceInput = {
	enrollmentId: string;
	status: "present" | "absent" | "late" | "leave";
	note: string | null;
};

export type LessonAttendanceRecord = {
	lesson: LessonRecord;
	members: Array<{
		enrollmentId: string;
		makeupLessonId: string | null;
		studentId: string;
		studentName: string;
		remainingLessons: number;
		status: (typeof attendance.$inferSelect)["status"] | null;
		note: string | null;
	}>;
};

type AttendanceMembership = {
	id: string;
	makeupLessonId: string | null;
	studentId: string;
	studentName: string;
	remainingLessons: number;
	status: (typeof attendance.$inferSelect)["status"] | null;
	note: string | null;
};

async function loadAttendanceMemberships(
	tx: Transaction,
	input: {
		organizationId: string;
		lessonId: string;
		classGroupId: string;
		startsAt: Date;
	},
): Promise<AttendanceMembership[]> {
	const [group] = await tx
		.select({ courseId: classGroup.courseId })
		.from(classGroup)
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
	const baseMemberships = await tx
		.select({
			id: enrollment.id,
			makeupLessonId: sql<string | null>`null`,
			studentId: enrollment.studentId,
			studentName: student.name,
			remainingLessons: enrollment.remainingLessons,
			status: enrollment.status,
			classGroupId: enrollment.classGroupId,
		})
		.from(enrollment)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.courseId, group.courseId),
				inArray(enrollment.status, ["active", "frozen"]),
			),
		)
		.for("update");
	const baseEvents =
		baseMemberships.length > 0
			? await tx
					.select({
						enrollmentId: enrollmentLifecycleEvent.enrollmentId,
						beforeStatus: enrollmentLifecycleEvent.beforeStatus,
						afterStatus: enrollmentLifecycleEvent.afterStatus,
						fromClassGroupId: enrollmentLifecycleEvent.fromClassGroupId,
						toClassGroupId: enrollmentLifecycleEvent.toClassGroupId,
						effectiveAt: enrollmentLifecycleEvent.effectiveAt,
						id: enrollmentLifecycleEvent.id,
					})
					.from(enrollmentLifecycleEvent)
					.where(
						and(
							eq(enrollmentLifecycleEvent.organizationId, input.organizationId),
							inArray(
								enrollmentLifecycleEvent.enrollmentId,
								baseMemberships.map((item) => item.id),
							),
						),
					)
					.orderBy(
						asc(enrollmentLifecycleEvent.effectiveAt),
						asc(enrollmentLifecycleEvent.id),
					)
			: [];
	const eventsByEnrollmentId = new Map<string, typeof baseEvents>();
	for (const event of baseEvents) {
		const events = eventsByEnrollmentId.get(event.enrollmentId) ?? [];
		events.push(event);
		eventsByEnrollmentId.set(event.enrollmentId, events);
	}
	const activeBaseMemberships = baseMemberships.filter((membership) => {
		const events = eventsByEnrollmentId.get(membership.id) ?? [];
		let status = events[0]?.beforeStatus ?? membership.status;
		let classGroupId = events[0]?.fromClassGroupId ?? membership.classGroupId;
		for (const event of events) {
			if (event.effectiveAt > input.startsAt) break;
			status = event.afterStatus;
			classGroupId = event.toClassGroupId;
		}
		return status === "active" && classGroupId === input.classGroupId;
	});
	const makeupMemberships = await tx
		.select({
			id: enrollment.id,
			makeupLessonId: makeupLesson.id,
			studentId: enrollment.studentId,
			studentName: student.name,
			remainingLessons: enrollment.remainingLessons,
			status: enrollment.status,
		})
		.from(makeupLesson)
		.innerJoin(
			enrollment,
			and(
				eq(enrollment.id, makeupLesson.sourceEnrollmentId),
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.status, "active"),
			),
		)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(makeupLesson.organizationId, input.organizationId),
				eq(makeupLesson.targetLessonId, input.lessonId),
				eq(makeupLesson.status, "scheduled"),
				inArray(enrollment.status, ["active", "frozen"]),
			),
		)
		.for("update");
	const makeupEvents =
		makeupMemberships.length > 0
			? await tx
					.select({
						enrollmentId: enrollmentLifecycleEvent.enrollmentId,
						beforeStatus: enrollmentLifecycleEvent.beforeStatus,
						afterStatus: enrollmentLifecycleEvent.afterStatus,
						effectiveAt: enrollmentLifecycleEvent.effectiveAt,
						id: enrollmentLifecycleEvent.id,
					})
					.from(enrollmentLifecycleEvent)
					.where(
						and(
							eq(enrollmentLifecycleEvent.organizationId, input.organizationId),
							inArray(
								enrollmentLifecycleEvent.enrollmentId,
								makeupMemberships.map((item) => item.id),
							),
						),
					)
					.orderBy(
						asc(enrollmentLifecycleEvent.effectiveAt),
						asc(enrollmentLifecycleEvent.id),
					)
			: [];
	const makeupEventsByEnrollmentId = new Map<string, typeof makeupEvents>();
	for (const event of makeupEvents) {
		const events = makeupEventsByEnrollmentId.get(event.enrollmentId) ?? [];
		events.push(event);
		makeupEventsByEnrollmentId.set(event.enrollmentId, events);
	}
	const activeMakeupMemberships = makeupMemberships.filter((membership) => {
		const events = makeupEventsByEnrollmentId.get(membership.id) ?? [];
		let status = events[0]?.beforeStatus ?? membership.status;
		for (const event of events) {
			if (event.effectiveAt > input.startsAt) break;
			status = event.afterStatus;
		}
		return status === "active";
	});
	const rawMemberships = [...activeBaseMemberships, ...activeMakeupMemberships];
	if (
		new Set(rawMemberships.map((item) => item.studentId)).size !==
		rawMemberships.length
	) {
		throw new TeachingRepositoryError("CLASS_STUDENT_DUPLICATE");
	}
	const attendanceRecords =
		rawMemberships.length > 0
			? await tx
					.select({
						studentId: attendance.studentId,
						status: attendance.status,
						note: attendance.note,
					})
					.from(attendance)
					.where(
						and(
							eq(attendance.lessonId, input.lessonId),
							inArray(
								attendance.studentId,
								rawMemberships.map((item) => item.studentId),
							),
						),
					)
					.for("update")
			: [];
	const attendanceByStudentId = new Map(
		attendanceRecords.map((item) => [item.studentId, item]),
	);
	const memberships: AttendanceMembership[] = rawMemberships.map((item) => ({
		...item,
		status: attendanceByStudentId.get(item.studentId)?.status ?? null,
		note: attendanceByStudentId.get(item.studentId)?.note ?? null,
	}));
	return memberships.sort(
		(left, right) =>
			left.studentName.localeCompare(right.studentName, "zh-CN") ||
			left.id.localeCompare(right.id),
	);
}

export async function getLessonAttendanceRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	id: string;
}): Promise<LessonAttendanceRecord> {
	const lessonRecord = (
		await listLessonRecords({
			organizationId: input.organizationId,
			campusAccess: input.campusAccess,
		})
	).find((item) => item.id === input.id);
	if (!lessonRecord) {
		const [exists] = await db
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.id, input.id),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.limit(1);
		if (!exists) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		throw new TeachingRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}
	const members = await db.transaction((tx) =>
		loadAttendanceMemberships(tx, {
			organizationId: input.organizationId,
			lessonId: lessonRecord.id,
			classGroupId: lessonRecord.classGroupId,
			startsAt: lessonRecord.startsAt,
		}),
	);
	return {
		lesson: lessonRecord,
		members: members.map(({ id, ...item }) => ({ enrollmentId: id, ...item })),
	};
}

export type TeacherWorkspaceRecord = {
	teacher: Pick<typeof teacher.$inferSelect, "id" | "name"> | null;
	lessons: LessonRecord[];
};

export async function getTeacherWorkspaceRecord(input: {
	organizationId: string;
	userId: string;
	from: Date;
	to: Date;
	targetId?: string;
}): Promise<TeacherWorkspaceRecord> {
	const [member] = await db
		.select({ role: organizationMember.role })
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.userId),
			),
		)
		.limit(1);
	if (member?.role !== "teacher") {
		throw new TeachingRepositoryError("MEMBER_FORBIDDEN");
	}
	const [binding] = await db
		.select({ id: teacher.id, name: teacher.name })
		.from(teacher)
		.where(
			and(
				eq(teacher.organizationId, input.organizationId),
				eq(teacher.userId, input.userId),
			),
		)
		.limit(1);
	if (!binding) {
		if (input.targetId) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		return { teacher: null, lessons: [] };
	}
	const lessons = await listLessonRecords({
		organizationId: input.organizationId,
		campusAccess: { kind: "all" },
		teacherId: binding.id,
		from: input.from,
		to: input.to,
	});
	if (input.targetId && !lessons.some((item) => item.id === input.targetId)) {
		const [target] = await listLessonRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
			teacherId: binding.id,
			targetId: input.targetId,
		});
		if (!target) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		lessons.push(target);
	}
	return { teacher: binding, lessons };
}

export async function getTeacherLessonAttendanceRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
}): Promise<LessonAttendanceRecord> {
	const [owned] = await db
		.select({ id: lesson.id })
		.from(lesson)
		.innerJoin(
			teacher,
			and(
				eq(teacher.id, lesson.teacherId),
				eq(teacher.organizationId, input.organizationId),
				eq(teacher.userId, input.userId),
			),
		)
		.innerJoin(
			organizationMember,
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.userId),
				eq(organizationMember.role, "teacher"),
			),
		)
		.where(
			and(
				eq(lesson.id, input.id),
				eq(lesson.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!owned) throw new TeachingRepositoryError("MEMBER_FORBIDDEN");
	return getLessonAttendanceRecord({
		organizationId: input.organizationId,
		campusAccess: { kind: "all" },
		id: input.id,
	});
}

export async function saveLessonAttendanceDraftRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	attendance: LessonAttendanceInput[];
}): Promise<LessonAttendanceRecord> {
	await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: lessonWriteRoles,
		});
		const [lessonRecord] = await tx
			.select()
			.from(lesson)
			.where(
				and(
					eq(lesson.id, input.id),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!lessonRecord) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		await assertTeacherOwnsLessonIfNeeded(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			teacherId: lessonRecord.teacherId,
		});
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: lessonRecord.campusId,
		});
		const now = new Date();
		if (
			lessonRecord.status !== "scheduled" ||
			now < new Date(lessonRecord.startsAt.getTime() - 30 * 60_000)
		) {
			throw new TeachingRepositoryError("ATTENDANCE_TOO_EARLY");
		}
		const [group] = await tx
			.select({ id: classGroup.id, status: classGroup.status })
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, lessonRecord.classGroupId),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		if (group.status === "paused") {
			throw new TeachingRepositoryError("CLASS_ATTENDANCE_LOCKED");
		}
		const memberships = await loadAttendanceMemberships(tx, {
			organizationId: input.organizationId,
			lessonId: lessonRecord.id,
			classGroupId: lessonRecord.classGroupId,
			startsAt: lessonRecord.startsAt,
		});
		const submitted = new Map(
			input.attendance.map((item) => [item.enrollmentId, item]),
		);
		if (
			memberships.length !== input.attendance.length ||
			submitted.size !== input.attendance.length ||
			memberships.some((item) => !submitted.has(item.id))
		) {
			throw new TeachingRepositoryError("ATTENDANCE_DRAFT_INVALID");
		}
		const studentIds = memberships.map((item) => item.studentId);
		await tx
			.delete(attendance)
			.where(
				studentIds.length > 0
					? and(
							eq(attendance.lessonId, lessonRecord.id),
							notInArray(attendance.studentId, studentIds),
						)
					: eq(attendance.lessonId, lessonRecord.id),
			);
		for (const membership of memberships) {
			const item = submitted.get(membership.id);
			if (!item) throw new TeachingRepositoryError("ATTENDANCE_DRAFT_INVALID");
			await tx
				.insert(attendance)
				.values({
					lessonId: lessonRecord.id,
					studentId: membership.studentId,
					status: item.status,
					checkedInAt:
						item.status === "present" || item.status === "late" ? now : null,
					note: item.note?.trim() || null,
					recordedByUserId: input.userId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [attendance.lessonId, attendance.studentId],
					set: {
						status: item.status,
						checkedInAt:
							item.status === "present" || item.status === "late" ? now : null,
						note: item.note?.trim() || null,
						recordedByUserId: input.userId,
						updatedAt: now,
					},
				});
		}
	});
	return getLessonAttendanceRecord({
		organizationId: input.organizationId,
		campusAccess: { kind: "all" },
		id: input.id,
	});
}

export async function completeLessonRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	attendance: LessonAttendanceInput[] | null;
	teachingSummary?: string | null;
}): Promise<LessonRecord> {
	const completedId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: lessonWriteRoles,
		});
		const [lessonRecord] = await tx
			.select()
			.from(lesson)
			.where(
				and(
					eq(lesson.id, input.id),
					eq(lesson.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!lessonRecord) throw new TeachingRepositoryError("LESSON_NOT_FOUND");
		await assertTeacherOwnsLessonIfNeeded(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			teacherId: lessonRecord.teacherId,
		});
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: lessonRecord.campusId,
		});
		const completedAt = new Date();
		if (
			lessonRecord.status !== "scheduled" ||
			completedAt < lessonRecord.endsAt
		) {
			throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
		}
		const [group] = await tx
			.select({ id: classGroup.id, status: classGroup.status })
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, lessonRecord.classGroupId),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!group) throw new TeachingRepositoryError("CLASS_NOT_FOUND");
		if (group.status === "paused") {
			throw new TeachingRepositoryError("CLASS_ATTENDANCE_LOCKED");
		}
		const memberships = await loadAttendanceMemberships(tx, {
			organizationId: input.organizationId,
			lessonId: lessonRecord.id,
			classGroupId: lessonRecord.classGroupId,
			startsAt: lessonRecord.startsAt,
		});
		const existingDrafts = await tx
			.select({
				studentId: attendance.studentId,
				status: attendance.status,
				note: attendance.note,
			})
			.from(attendance)
			.where(eq(attendance.lessonId, lessonRecord.id))
			.for("update");
		const enrollmentByStudentId = new Map(
			memberships.map((item) => [item.studentId, item.id]),
		);
		if (
			input.attendance === null &&
			existingDrafts.length > 0 &&
			(existingDrafts.length !== memberships.length ||
				existingDrafts.some(
					(item) => !enrollmentByStudentId.has(item.studentId),
				))
		) {
			throw new TeachingRepositoryError("ATTENDANCE_DRAFT_INVALID");
		}
		const finalAttendance =
			input.attendance ??
			(existingDrafts.length > 0
				? existingDrafts.map((item) => ({
						enrollmentId: enrollmentByStudentId.get(item.studentId) ?? "",
						status: item.status,
						note: item.note,
					}))
				: memberships.map((item) => ({
						enrollmentId: item.id,
						status: "present" as const,
						note: null,
					})));
		const submitted = new Map(
			finalAttendance.map((item) => [item.enrollmentId, item]),
		);
		if (
			memberships.length !== finalAttendance.length ||
			submitted.size !== finalAttendance.length ||
			memberships.some((item) => !submitted.has(item.id))
		) {
			throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
		}
		for (const membership of memberships) {
			const item = submitted.get(membership.id);
			if (!item) throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
			const consumesLesson =
				item.status === "present" || item.status === "late";
			if (consumesLesson && membership.remainingLessons < 1) {
				throw new TeachingRepositoryError("LESSON_CONSUMPTION_INSUFFICIENT");
			}
		}
		const currentStudentIds = memberships.map((item) => item.studentId);
		await tx
			.delete(attendance)
			.where(
				currentStudentIds.length > 0
					? and(
							eq(attendance.lessonId, lessonRecord.id),
							notInArray(attendance.studentId, currentStudentIds),
						)
					: eq(attendance.lessonId, lessonRecord.id),
			);
		for (const membership of memberships) {
			const item = submitted.get(membership.id);
			if (!item) throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
			await tx
				.insert(attendance)
				.values({
					lessonId: lessonRecord.id,
					studentId: membership.studentId,
					status: item.status,
					checkedInAt:
						item.status === "present" || item.status === "late"
							? new Date()
							: null,
					note: item.note?.trim() || null,
					recordedByUserId: input.userId,
					updatedAt: completedAt,
				})
				.onConflictDoUpdate({
					target: [attendance.lessonId, attendance.studentId],
					set: {
						status: item.status,
						checkedInAt:
							item.status === "present" || item.status === "late"
								? completedAt
								: null,
						note: item.note?.trim() || null,
						recordedByUserId: input.userId,
						updatedAt: completedAt,
					},
				});
			if (item.status === "present" || item.status === "late") {
				const [createdConsumption] = await tx
					.insert(lessonConsumption)
					.values({
						organizationId: input.organizationId,
						enrollmentId: membership.id,
						lessonId: lessonRecord.id,
						attendanceStatus: item.status,
						previousRemainingLessons: membership.remainingLessons,
						remainingLessons: membership.remainingLessons - 1,
						consumedByUserId: input.userId,
						consumedAt: completedAt,
					})
					.returning({ id: lessonConsumption.id });
				if (!createdConsumption) {
					throw new Error("Lesson consumption did not return a record.");
				}
				await tx
					.update(enrollment)
					.set({ remainingLessons: membership.remainingLessons - 1 })
					.where(eq(enrollment.id, membership.id));

				const [purchaseCycle] = await tx
					.select({
						id: enrollmentPurchaseCycle.id,
						purchasedLessons: enrollmentPurchaseCycle.purchasedLessons,
					})
					.from(enrollmentPurchaseCycle)
					.where(
						and(
							eq(enrollmentPurchaseCycle.organizationId, input.organizationId),
							eq(enrollmentPurchaseCycle.enrollmentId, membership.id),
						),
					)
					.orderBy(desc(enrollmentPurchaseCycle.sequence))
					.limit(1)
					.for("update");
				if (purchaseCycle) {
					const thresholdLessons = Math.max(
						1,
						Math.ceil(purchaseCycle.purchasedLessons * 0.2),
					);
					const remainingLessons = membership.remainingLessons - 1;
					if (
						membership.remainingLessons > thresholdLessons &&
						remainingLessons <= thresholdLessons
					) {
						await tx
							.insert(renewalOpportunity)
							.values({
								organizationId: input.organizationId,
								enrollmentId: membership.id,
								purchaseCycleId: purchaseCycle.id,
								triggeringLessonConsumptionId: createdConsumption.id,
								thresholdLessons,
								remainingLessons,
								campusId: lessonRecord.campusId,
								triggeredAt: completedAt,
							})
							.onConflictDoNothing({
								target: renewalOpportunity.purchaseCycleId,
							});
					}
				}
			}
			if (membership.makeupLessonId) {
				const nextMakeupStatus =
					item.status === "present" || item.status === "late"
						? "fulfilled"
						: "needs_reschedule";
				const [updatedMakeup] = await tx
					.update(makeupLesson)
					.set({
						status: nextMakeupStatus,
						updatedAt: completedAt,
					})
					.where(
						and(
							eq(makeupLesson.id, membership.makeupLessonId),
							eq(makeupLesson.status, "scheduled"),
						),
					)
					.returning({ id: makeupLesson.id });
				if (updatedMakeup && nextMakeupStatus === "needs_reschedule") {
					await writeOrganizationAuditEvent(tx, {
						organizationId: input.organizationId,
						action: "makeup_lesson_needs_reschedule",
						entityType: "makeup_lesson",
						entityId: updatedMakeup.id,
						actorUserId: input.userId,
						campusId: lessonRecord.campusId,
						before: { status: "scheduled" },
						after: {
							status: "needs_reschedule",
							targetLessonId: lessonRecord.id,
							reason: "lesson_completed",
						},
					});
				}
			}
		}
		await tx
			.update(lesson)
			.set({
				status: "completed",
				teachingSummary: input.teachingSummary?.trim() || null,
				completedAt,
				completedByUserId: input.userId,
				version: sql`${lesson.version} + 1`,
			})
			.where(eq(lesson.id, lessonRecord.id));
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "lesson_completed",
			entityType: "lesson",
			entityId: lessonRecord.id,
			actorUserId: input.userId,
			campusId: lessonRecord.campusId,
			after: {
				classGroupId: lessonRecord.classGroupId,
				activeEnrollmentCount: memberships.length,
			},
		});
		return lessonRecord.id;
	});
	const record = (
		await listLessonRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === completedId);
	if (!record) throw new Error("Completed lesson was not readable.");
	return record;
}

function isUniqueError(error: unknown, constraint: string): boolean {
	if (typeof error !== "object" || error === null) return false;
	if ("code" in error && "constraint" in error) {
		return error.code === "23505" && error.constraint === constraint;
	}
	return "cause" in error && isUniqueError(error.cause, constraint);
}
