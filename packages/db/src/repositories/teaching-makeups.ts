import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	attendance,
	classGroup,
	course,
	enrollment,
	lesson,
	makeupLesson,
	student,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";
import {
	academicWriteRoles,
	assertWritableCampus,
	fingerprint,
	getCurrentWriteCampusAccess,
	isUniqueError,
	resolveActiveClassroom,
	TeachingRepositoryError,
} from "./teaching-foundation";

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

export async function getMakeupLessonById(input: {
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
