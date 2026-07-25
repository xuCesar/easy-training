import { Buffer } from "node:buffer";

import {
	and,
	asc,
	countDistinct,
	desc,
	eq,
	gt,
	inArray,
	lt,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	campus,
	classGroup,
	classroom,
	classStatusEvent,
	course,
	enrollment,
	lesson,
	makeupLesson,
	student,
	teacher,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	campusAccessCondition,
	isCampusAccessible,
	type Transaction,
} from "./campus-access";
import type { CampusAccess } from "./organization";
import {
	academicWriteRoles,
	assertClassStatusTransition,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	type ClassStatus,
	currentClassGroupCapacity,
	ensurePositive,
	getCurrentWriteCampusAccess,
	markMakeupLessonsNeedsReschedule,
	normalizeName,
	recordClassGroupCapacityHistory,
	TeachingRepositoryError,
} from "./teaching-foundation";

export type ClassGroupRecord = {
	id: string;
	name: string;
	status: (typeof classGroup.$inferSelect)["status"];
	capacity: number;
	capacityEffectiveFrom?: string;
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

export type ClassGroupCursor = {
	startDate: string;
	name: string;
	id: string;
};

export function decodeClassGroupCursor(
	cursor: string | undefined,
): ClassGroupCursor | null {
	if (!cursor) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("startDate" in parsed) ||
			!("name" in parsed) ||
			!("id" in parsed) ||
			typeof parsed.startDate !== "string" ||
			typeof parsed.name !== "string" ||
			typeof parsed.id !== "string"
		) {
			throw new Error("Invalid class group cursor.");
		}
		return parsed;
	} catch {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
}

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

export const classSelection = {
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
	cursor?: string;
	pageSize?: number;
}): Promise<ClassGroupRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const cursor = decodeClassGroupCursor(input.cursor);
	const filters = [
		eq(classGroup.organizationId, input.organizationId),
		campusAccessCondition(classGroup.campusId, input.campusAccess),
	];
	if (input.campusId) filters.push(eq(classGroup.campusId, input.campusId));
	if (input.status) filters.push(eq(classGroup.status, input.status));
	if (input.targetId) filters.push(eq(classGroup.id, input.targetId));
	if (cursor) {
		const cursorFilter = or(
			lt(classGroup.startDate, cursor.startDate),
			and(
				eq(classGroup.startDate, cursor.startDate),
				gt(classGroup.name, cursor.name),
			),
			and(
				eq(classGroup.startDate, cursor.startDate),
				eq(classGroup.name, cursor.name),
				gt(classGroup.id, cursor.id),
			),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}
	const query = db
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
	return input.pageSize ? query.limit(input.pageSize + 1) : query;
}

export async function assertClassDependencies(
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
	capacityEffectiveFrom?: string;
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
			effectiveFrom: input.capacityEffectiveFrom,
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
	capacityEffectiveFrom?: string;
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
		if (existing.capacity !== input.capacity || input.capacityEffectiveFrom) {
			await recordClassGroupCapacityHistory(tx, {
				organizationId: input.organizationId,
				classGroupId: existing.id,
				capacity: input.capacity,
				actorUserId: input.userId,
				effectiveFrom: input.capacityEffectiveFrom,
			});
		}
		const currentCapacity = await currentClassGroupCapacity(
			tx,
			input.organizationId,
			existing.id,
		);
		const projectedCapacity = currentCapacity ?? input.capacity;
		if (projectedCapacity < (occupancy?.value ?? 0))
			throw new TeachingRepositoryError("CLASS_CAPACITY_TOO_LOW");
		await tx
			.update(classGroup)
			.set({
				name: normalizeName(input.name),
				campusId: input.campusId,
				courseId: input.courseId,
				teacherId: input.teacherId,
				capacity: projectedCapacity,
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
