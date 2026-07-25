import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { db } from "../index";
import { classGroup, course, lesson, lessonScheduleBatch } from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { Transaction } from "./campus-access";
import {
	fingerprint,
	getScheduledMakeupCountByLessonId,
	MAX_SCHEDULE_CANDIDATES,
	overlaps,
} from "./scheduling-rules";
import {
	academicWriteRoles,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	normalizeRoom,
	resolveActiveClassroom,
	TeachingRepositoryError,
} from "./teaching-foundation";

export type BulkLessonUpdateInput = {
	id: string;
	expectedVersion: number;
	startsAt: Date;
	teacherId: string;
	room: string;
	roomId: string;
};

export type BulkLessonUpdateItem = {
	id: string;
	expectedVersion: number;
	classGroupId: string;
	campusId: string;
	current: {
		startsAt: Date;
		endsAt: Date;
		teacherId: string;
		room: string;
		roomId: string | null;
	};
	proposed: {
		startsAt: Date;
		endsAt: Date;
		teacherId: string;
		room: string;
		roomId: string | null;
	};
	conflicts: Array<"teacher" | "room" | "time">;
};

export async function buildBulkLessonUpdatePreview(
	tx: Transaction,
	input: {
		organizationId: string;
		userId: string;
		items: BulkLessonUpdateInput[];
		transactionNow?: Date;
	},
): Promise<BulkLessonUpdateItem[]> {
	if (
		input.items.length === 0 ||
		input.items.length > MAX_SCHEDULE_CANDIDATES ||
		new Set(input.items.map((item) => item.id)).size !== input.items.length ||
		input.items.some((item) => !item.roomId)
	) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	const access = await getCurrentWriteCampusAccess(tx, {
		organizationId: input.organizationId,
		userId: input.userId,
		allowedRoles: academicWriteRoles,
	});
	const requested = new Map(input.items.map((item) => [item.id, item]));
	const records = await tx
		.select({
			lesson,
			courseId: classGroup.courseId,
			durationMinutes: course.durationMinutes,
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
		.where(
			and(
				eq(lesson.organizationId, input.organizationId),
				inArray(
					lesson.id,
					input.items.map((item) => item.id),
				),
			),
		)
		.orderBy(asc(lesson.id))
		.for("update");
	if (records.length !== input.items.length)
		throw new TeachingRepositoryError("LESSON_NOT_FOUND");
	const makeupCountByLessonId = await getScheduledMakeupCountByLessonId(tx, {
		organizationId: input.organizationId,
		lessonIds: records.map((record) => record.lesson.id),
	});
	const now = input.transactionNow ?? new Date();
	const result: BulkLessonUpdateItem[] = [];
	for (const record of records) {
		const requestedItem = requested.get(record.lesson.id);
		if (!requestedItem)
			throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
		if (
			record.lesson.status !== "scheduled" ||
			record.lesson.startsAt <= now ||
			record.lesson.version !== requestedItem.expectedVersion ||
			!Number.isFinite(requestedItem.startsAt.getTime())
		) {
			throw new TeachingRepositoryError("LESSON_BULK_UPDATE_INVALID");
		}
		const [groupStatus] = await tx
			.select({ status: classGroup.status })
			.from(classGroup)
			.where(
				and(
					eq(classGroup.id, record.lesson.classGroupId),
					eq(classGroup.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (
			!groupStatus ||
			groupStatus.status === "paused" ||
			groupStatus.status === "completed"
		)
			throw new TeachingRepositoryError("CLASS_NOT_SCHEDULABLE");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: record.lesson.campusId,
		});
		await assertCourseActive(tx, input.organizationId, record.courseId);
		await assertTeacherForCampus(tx, {
			organizationId: input.organizationId,
			teacherId: requestedItem.teacherId,
			campusId: record.lesson.campusId,
		});
		const roomRecord = await resolveActiveClassroom(tx, {
			organizationId: input.organizationId,
			campusId: record.lesson.campusId,
			roomId: requestedItem.roomId,
			classGroupId: record.lesson.classGroupId,
			extraAttendeeCount: makeupCountByLessonId.get(record.lesson.id) ?? 0,
		});
		result.push({
			id: record.lesson.id,
			expectedVersion: record.lesson.version,
			classGroupId: record.lesson.classGroupId,
			campusId: record.lesson.campusId,
			current: {
				startsAt: record.lesson.startsAt,
				endsAt: record.lesson.endsAt,
				teacherId: record.lesson.teacherId,
				room: record.lesson.room,
				roomId: record.lesson.roomId,
			},
			proposed: {
				startsAt: requestedItem.startsAt,
				endsAt: new Date(
					requestedItem.startsAt.getTime() + record.durationMinutes * 60_000,
				),
				teacherId: requestedItem.teacherId,
				room: roomRecord.name,
				roomId: roomRecord.id,
			},
			conflicts: [],
		});
	}
	const minStartsAt = new Date(
		Math.min(...result.map((item) => item.proposed.startsAt.getTime())),
	);
	const maxEndsAt = new Date(
		Math.max(...result.map((item) => item.proposed.endsAt.getTime())),
	);
	const selectedIds = new Set(result.map((item) => item.id));
	const existing = await tx
		.select({
			id: lesson.id,
			teacherId: lesson.teacherId,
			campusId: lesson.campusId,
			room: lesson.room,
			roomId: lesson.roomId,
			startsAt: lesson.startsAt,
			endsAt: lesson.endsAt,
		})
		.from(lesson)
		.where(
			and(
				eq(lesson.organizationId, input.organizationId),
				eq(lesson.status, "scheduled"),
				lt(lesson.startsAt, maxEndsAt),
				gt(lesson.endsAt, minStartsAt),
			),
		);
	for (const [index, item] of result.entries()) {
		const conflicts = new Set<"teacher" | "room" | "time">();
		for (const record of existing) {
			if (selectedIds.has(record.id) || !overlaps(item.proposed, record))
				continue;
			if (record.teacherId === item.proposed.teacherId)
				conflicts.add("teacher");
			if (
				record.campusId === item.campusId &&
				((record.roomId && record.roomId === item.proposed.roomId) ||
					normalizeRoom(record.room) === normalizeRoom(item.proposed.room))
			)
				conflicts.add("room");
		}
		for (let otherIndex = 0; otherIndex < result.length; otherIndex += 1) {
			if (index === otherIndex) continue;
			const other = result[otherIndex];
			if (!other || !overlaps(item.proposed, other.proposed)) continue;
			if (
				other.proposed.teacherId === item.proposed.teacherId ||
				(other.campusId === item.campusId &&
					((other.proposed.roomId &&
						other.proposed.roomId === item.proposed.roomId) ||
						normalizeRoom(other.proposed.room) ===
							normalizeRoom(item.proposed.room)))
			) {
				// 同一批次的候选课次互相重叠，调整时间即可解除，归类为时间冲突。
				conflicts.add("time");
			}
		}
		item.conflicts = [...conflicts];
	}
	return result;
}

export async function previewBulkLessonUpdateRecord(input: {
	organizationId: string;
	userId: string;
	items: BulkLessonUpdateInput[];
}): Promise<{ items: BulkLessonUpdateItem[] }> {
	return db.transaction(async (tx) => ({
		items: await buildBulkLessonUpdatePreview(tx, input),
	}));
}

export async function bulkUpdateLessonsRecord(input: {
	organizationId: string;
	userId: string;
	requestId: string;
	items: BulkLessonUpdateInput[];
}): Promise<{ lessonIds: string[]; replayed: boolean }> {
	const requestFingerprint = fingerprint({
		items: input.items.map((item) => ({
			...item,
			startsAt: item.startsAt.toISOString(),
		})),
	});
	return db.transaction(async (tx) => {
		const [existingBatch] = await tx
			.select()
			.from(lessonScheduleBatch)
			.where(
				and(
					eq(lessonScheduleBatch.organizationId, input.organizationId),
					eq(lessonScheduleBatch.requestId, input.requestId),
				),
			)
			.limit(1)
			.for("update");
		if (existingBatch) {
			if (existingBatch.requestFingerprint !== requestFingerprint)
				throw new TeachingRepositoryError("IDEMPOTENCY_CONFLICT");
			return { lessonIds: existingBatch.affectedLessonIds, replayed: true };
		}
		const transactionNow = new Date();
		const preview = await buildBulkLessonUpdatePreview(tx, {
			...input,
			transactionNow,
		});
		if (preview.some((item) => item.conflicts.length > 0))
			throw new TeachingRepositoryError("LESSON_CONFLICT");
		for (const item of preview) {
			const [updated] = await tx
				.update(lesson)
				.set({
					startsAt: item.proposed.startsAt,
					endsAt: item.proposed.endsAt,
					teacherId: item.proposed.teacherId,
					room: item.proposed.room,
					roomId: item.proposed.roomId,
					isScheduleOverride:
						item.current.startsAt.getTime() !==
							item.proposed.startsAt.getTime() ||
						item.current.teacherId !== item.proposed.teacherId ||
						item.current.roomId !== item.proposed.roomId ||
						normalizeRoom(item.current.room) !==
							normalizeRoom(item.proposed.room)
							? true
							: undefined,
					version: sql`${lesson.version} + 1`,
				})
				.where(
					and(
						eq(lesson.id, item.id),
						eq(lesson.status, "scheduled"),
						gt(lesson.startsAt, transactionNow),
						eq(lesson.version, item.expectedVersion),
					),
				)
				.returning({ id: lesson.id });
			if (!updated)
				throw new TeachingRepositoryError("LESSON_BULK_UPDATE_INVALID");
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "lessons_bulk_rescheduled",
				entityType: "lesson",
				entityId: item.id,
				actorUserId: input.userId,
				campusId: item.campusId,
				before: {
					startsAt: item.current.startsAt.toISOString(),
					endsAt: item.current.endsAt.toISOString(),
					teacherId: item.current.teacherId,
					room: item.current.room,
					version: item.expectedVersion,
				},
				after: {
					startsAt: item.proposed.startsAt.toISOString(),
					endsAt: item.proposed.endsAt.toISOString(),
					teacherId: item.proposed.teacherId,
					room: item.proposed.room,
					version: item.expectedVersion + 1,
					requestId: input.requestId,
				},
			});
		}
		const lessonIds = preview.map((item) => item.id);
		await tx.insert(lessonScheduleBatch).values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			kind: "bulk_reschedule",
			actorUserId: input.userId,
			requestFingerprint,
			affectedLessonIds: lessonIds,
		});
		return { lessonIds, replayed: false };
	});
}
