import { and, asc, eq } from "drizzle-orm";

import { db } from "../index";
import {
	classGroup,
	course,
	enrollment,
	lesson,
	organizationMember,
	teacher,
	teacherCampus,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { campusAccessCondition, type Transaction } from "./campus-access";
import type { CampusAccess } from "./organization";

import {
	assertWritableCampus,
	courseWriteRoles,
	currentTeacherCapacityHours,
	ensurePositive,
	getCurrentWriteCampusAccess,
	isUniqueError,
	normalizeName,
	recordTeacherCapacityHistory,
	TeachingRepositoryError,
} from "./teaching-foundation";

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

export async function assertBindableTeacherUser(
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
		.where(
			and(
				eq(teacher.organizationId, input.organizationId),
				campusAccessCondition(teacherCampus.campusId, input.campusAccess),
			),
		)
		.orderBy(asc(teacher.name), asc(teacher.id), asc(teacherCampus.campusId));
	const records = new Map<string, TeacherRecord>();
	for (const row of rows) {
		const current = records.get(row.teacher.id) ?? {
			...row.teacher,
			campusIds: [],
		};
		if (row.campusId) {
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
	capacityEffectiveFrom?: string;
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
				effectiveFrom: input.capacityEffectiveFrom,
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
	capacityEffectiveFrom?: string;
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
			if (
				existing.weeklyCapacityHours !== updated.weeklyCapacityHours ||
				input.capacityEffectiveFrom
			) {
				await recordTeacherCapacityHistory(tx, {
					organizationId: input.organizationId,
					teacherId: updated.id,
					weeklyCapacityHours: updated.weeklyCapacityHours,
					actorUserId: input.userId,
					effectiveFrom: input.capacityEffectiveFrom,
				});
			}
			const currentCapacityHours = await currentTeacherCapacityHours(
				tx,
				input.organizationId,
				updated.id,
			);
			if (
				currentCapacityHours !== null &&
				currentCapacityHours !== updated.weeklyCapacityHours
			) {
				await tx
					.update(teacher)
					.set({ weeklyCapacityHours: currentCapacityHours })
					.where(eq(teacher.id, updated.id));
				updated.weeklyCapacityHours = currentCapacityHours;
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
