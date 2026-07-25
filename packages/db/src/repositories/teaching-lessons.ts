import { Buffer } from "node:buffer";

import { and, asc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db } from "../index";
import { campus, classGroup, course, lesson, teacher } from "../schema";
import type { CampusAccess } from "./organization";
import {
	academicWriteRoles,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	type ClassStatus,
	getCurrentWriteCampusAccess,
	markMakeupLessonsNeedsReschedule,
	normalizeRoom,
	resolveActiveClassroom,
	TeachingRepositoryError,
} from "./teaching-foundation";

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

export type LessonCursor = {
	startsAt: string;
	id: string;
};

export function decodeLessonCursor(
	cursor: string | undefined,
): LessonCursor | null {
	if (!cursor) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("startsAt" in parsed) ||
			!("id" in parsed) ||
			typeof parsed.startsAt !== "string" ||
			typeof parsed.id !== "string" ||
			Number.isNaN(new Date(parsed.startsAt).getTime())
		) {
			throw new Error("Invalid lesson cursor.");
		}
		return parsed;
	} catch {
		throw new TeachingRepositoryError("INVALID_INPUT");
	}
}

export async function listLessonRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	campusId?: string;
	classGroupId?: string;
	teacherId?: string;
	from?: Date;
	to?: Date;
	targetId?: string;
	cursor?: string;
	pageSize?: number;
}): Promise<LessonRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const cursor = decodeLessonCursor(input.cursor);
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
	if (cursor) {
		const startsAt = new Date(cursor.startsAt);
		const cursorFilter = or(
			gt(lesson.startsAt, startsAt),
			and(eq(lesson.startsAt, startsAt), gt(lesson.id, cursor.id)),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}
	const now = new Date();
	const query = db
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
	const records = await (input.pageSize
		? query.limit(input.pageSize + 1)
		: query);
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
