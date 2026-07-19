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
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	attendance,
	campus,
	classGroup,
	course,
	enrollment,
	lesson,
	lessonConsumption,
	organizationMember,
	organizationMemberCampus,
	student,
	teacher,
	teacherCampus,
} from "../schema";
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
	| "LESSON_COMPLETION_INVALID"
	| "LESSON_CONSUMPTION_INSUFFICIENT"
	| "INVALID_INPUT";

export class TeachingRepositoryError extends Error {
	constructor(public readonly code: TeachingRepositoryErrorCode) {
		super(code);
		this.name = "TeachingRepositoryError";
	}
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MemberRole = (typeof organizationMember.$inferSelect)["role"];
type ClassStatus = (typeof classGroup.$inferSelect)["status"];

const courseWriteRoles = new Set<MemberRole>(["owner", "admin"]);
const academicWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
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

async function getCurrentWriteCampusAccess(
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

async function assertWritableCampus(
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

function normalizeRoom(value: string): string {
	const normalized = value
		.trim()
		.normalize("NFKC")
		.replace(/\s+/gu, " ")
		.toLocaleLowerCase("zh-CN");
	if (!normalized) throw new TeachingRepositoryError("INVALID_INPUT");
	return normalized;
}

function ensurePositive(value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
}

async function assertCourseActive(
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

async function assertTeacherForCampus(
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

export async function listCourseRecords(input: {
	organizationId: string;
	includeInactive?: boolean;
}): Promise<CourseRecord[]> {
	const filters = [eq(course.organizationId, input.organizationId)];
	if (!input.includeInactive) filters.push(eq(course.isActive, true));
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
	return db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: courseWriteRoles,
		});
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
				name: normalizeName(input.name),
				phone: input.phone?.trim() || null,
				subjects: input.subjects.map(normalizeName),
				weeklyCapacityHours: input.weeklyCapacityHours,
			})
			.returning();
		if (!created) throw new Error("Teacher creation did not return a record.");
		await tx.insert(teacherCampus).values(
			input.campusIds.map((campusId) => ({
				teacherId: created.id,
				campusId,
			})),
		);
		return { ...created, campusIds: input.campusIds };
	});
}

export async function updateTeacherRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
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
	return db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: courseWriteRoles,
		});
		for (const campusId of input.campusIds) {
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess: access,
				campusId,
			});
		}
		const [updated] = await tx
			.update(teacher)
			.set({
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
		await tx
			.delete(teacherCampus)
			.where(eq(teacherCampus.teacherId, updated.id));
		await tx.insert(teacherCampus).values(
			input.campusIds.map((campusId) => ({
				teacherId: updated.id,
				campusId,
			})),
		);
		return { ...updated, campusIds: input.campusIds };
	});
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
}): Promise<ClassGroupRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [
		eq(classGroup.organizationId, input.organizationId),
		campusAccessCondition(input.campusAccess),
	];
	if (input.campusId) filters.push(eq(classGroup.campusId, input.campusId));
	if (input.status) filters.push(eq(classGroup.status, input.status));
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
				eq(enrollment.status, "active"),
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
	courseName: string;
	campusId: string;
	campusName: string;
	teacherId: string;
	teacherName: string;
	room: string;
	startsAt: Date;
	endsAt: Date;
	status: (typeof lesson.$inferSelect)["status"];
	cancelledAt: Date | null;
	cancelledByUserId: string | null;
	cancellationReason: string | null;
};

export async function listLessonRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	campusId?: string;
	classGroupId?: string;
	from?: Date;
	to?: Date;
}): Promise<LessonRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [eq(lesson.organizationId, input.organizationId)];
	if (input.campusAccess.kind === "selected")
		filters.push(inArray(lesson.campusId, input.campusAccess.campusIds));
	if (input.campusId) filters.push(eq(lesson.campusId, input.campusId));
	if (input.classGroupId)
		filters.push(eq(lesson.classGroupId, input.classGroupId));
	if (input.from) filters.push(gte(lesson.startsAt, input.from));
	if (input.to) filters.push(lte(lesson.startsAt, input.to));
	return db
		.select({
			id: lesson.id,
			classGroupId: lesson.classGroupId,
			className: classGroup.name,
			courseName: course.name,
			campusId: lesson.campusId,
			campusName: campus.name,
			teacherId: lesson.teacherId,
			teacherName: teacher.name,
			room: lesson.room,
			startsAt: lesson.startsAt,
			endsAt: lesson.endsAt,
			status: lesson.status,
			cancelledAt: lesson.cancelledAt,
			cancelledByUserId: lesson.cancelledByUserId,
			cancellationReason: lesson.cancellationReason,
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
}

export async function createLessonRecord(input: {
	organizationId: string;
	userId: string;
	classGroupId: string;
	room: string;
	startsAt: Date;
	endsAt: Date;
}): Promise<LessonRecord> {
	if (input.startsAt >= input.endsAt)
		throw new TeachingRepositoryError("LESSON_TIME_INVALID");
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
		const room = normalizeRoom(input.room);
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
						and(eq(lesson.campusId, group.campusId), eq(lesson.room, room)),
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
		studentId: string;
		studentName: string;
		remainingLessons: number;
		status: (typeof attendance.$inferSelect)["status"] | null;
		note: string | null;
	}>;
};

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
	const members = await db
		.select({
			enrollmentId: enrollment.id,
			studentId: student.id,
			studentName: student.name,
			remainingLessons: enrollment.remainingLessons,
			status: attendance.status,
			note: attendance.note,
		})
		.from(enrollment)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			attendance,
			and(
				eq(attendance.lessonId, lessonRecord.id),
				eq(attendance.studentId, enrollment.studentId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.classGroupId, lessonRecord.classGroupId),
				eq(enrollment.status, "active"),
			),
		)
		.orderBy(asc(student.name), asc(enrollment.id));
	return { lesson: lessonRecord, members };
}

export async function completeLessonRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	attendance: LessonAttendanceInput[];
}): Promise<LessonRecord> {
	const completedId = await db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
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
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: lessonRecord.campusId,
		});
		if (lessonRecord.status !== "scheduled") {
			throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
		}
		const [group] = await tx
			.select({ id: classGroup.id })
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
		const memberships = await tx
			.select({
				id: enrollment.id,
				studentId: enrollment.studentId,
				remainingLessons: enrollment.remainingLessons,
			})
			.from(enrollment)
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					eq(enrollment.classGroupId, lessonRecord.classGroupId),
					eq(enrollment.status, "active"),
				),
			)
			.for("update");
		if (
			new Set(memberships.map((item) => item.studentId)).size !==
			memberships.length
		) {
			throw new TeachingRepositoryError("CLASS_STUDENT_DUPLICATE");
		}
		const submitted = new Map(
			input.attendance.map((item) => [item.enrollmentId, item]),
		);
		if (
			memberships.length !== input.attendance.length ||
			submitted.size !== input.attendance.length ||
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
		for (const membership of memberships) {
			const item = submitted.get(membership.id);
			if (!item) throw new TeachingRepositoryError("LESSON_COMPLETION_INVALID");
			await tx.insert(attendance).values({
				lessonId: lessonRecord.id,
				studentId: membership.studentId,
				status: item.status,
				checkedInAt:
					item.status === "present" || item.status === "late"
						? new Date()
						: null,
				note: item.note?.trim() || null,
			});
			if (item.status === "present" || item.status === "late") {
				await tx.insert(lessonConsumption).values({
					organizationId: input.organizationId,
					enrollmentId: membership.id,
					lessonId: lessonRecord.id,
					attendanceStatus: item.status,
					previousRemainingLessons: membership.remainingLessons,
					remainingLessons: membership.remainingLessons - 1,
					consumedByUserId: input.userId,
				});
				await tx
					.update(enrollment)
					.set({ remainingLessons: membership.remainingLessons - 1 })
					.where(eq(enrollment.id, membership.id));
			}
		}
		await tx
			.update(lesson)
			.set({ status: "completed" })
			.where(eq(lesson.id, lessonRecord.id));
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
