import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	attendance,
	classGroup,
	enrollment,
	enrollmentLifecycleEvent,
	enrollmentPurchaseCycle,
	lesson,
	lessonConsumption,
	makeupLesson,
	organizationMember,
	renewalOpportunity,
	student,
	teacher,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { Transaction } from "./campus-access";
import type { CampusAccess } from "./organization";
import {
	assertTeacherOwnsLessonIfNeeded,
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	lessonWriteRoles,
	TeachingRepositoryError,
} from "./teaching-foundation";

import { type LessonRecord, listLessonRecords } from "./teaching-lessons";

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

export type AttendanceMembership = {
	id: string;
	makeupLessonId: string | null;
	studentId: string;
	studentName: string;
	remainingLessons: number;
	status: (typeof attendance.$inferSelect)["status"] | null;
	note: string | null;
};

export async function loadAttendanceMemberships(
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
