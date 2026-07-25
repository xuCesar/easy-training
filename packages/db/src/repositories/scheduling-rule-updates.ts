import { and, asc, eq, gt, gte, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import { lesson, lessonScheduleBatch, lessonScheduleRule } from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { Transaction } from "./campus-access";
import {
	assertNoFutureRuleConflict,
	fingerprint,
	getScheduledMakeupCountByLessonId,
	isIsoDate,
	isoWeekday,
	loadRuleContext,
	markConflicts,
	normalizeRuleData,
	type ScheduleCandidate,
	type ScheduleConflict,
	type ScheduleContext,
	type ScheduleRuleData,
	shanghaiDateTime,
	syncClassScheduleText,
} from "./scheduling-rules";
import {
	normalizeRoom,
	resolveActiveClassroom,
	TeachingRepositoryError,
} from "./teaching-foundation";

export type ScheduleRuleUpdateItem = {
	lessonId: string;
	expectedVersion: number;
	occurrenceDate: string;
	isOverride: boolean;
	preserved: boolean;
	current: {
		startsAt: Date;
		endsAt: Date;
		room: string;
		roomId: string | null;
	};
	proposed: {
		startsAt: Date;
		endsAt: Date;
		room: string;
		roomId: string | null;
	};
	conflicts: ScheduleConflict[];
};

export async function buildRuleUpdatePreview(
	tx: Transaction,
	context: ScheduleContext,
	input: {
		data: ScheduleRuleData;
		effectiveFrom: string;
		reapplyOverrideLessonIds: string[];
		transactionNow?: Date;
	},
): Promise<{ data: ScheduleRuleData; items: ScheduleRuleUpdateItem[] }> {
	const data = normalizeRuleData(input.data);
	if (!isIsoDate(input.effectiveFrom)) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	const now = input.transactionNow ?? new Date();
	const lessons = await tx
		.select()
		.from(lesson)
		.where(
			and(
				eq(lesson.organizationId, context.rule.organizationId),
				eq(lesson.scheduleRuleId, context.rule.id),
				eq(lesson.status, "scheduled"),
				gt(lesson.startsAt, now),
				gte(lesson.scheduleOccurrenceDate, input.effectiveFrom),
			),
		)
		.orderBy(asc(lesson.startsAt), asc(lesson.id))
		.for("update");
	const roomRecord = await resolveActiveClassroom(tx, {
		organizationId: context.rule.organizationId,
		campusId: context.group.campusId,
		roomId: data.roomId,
		classGroupId: context.group.id,
	});
	data.room = roomRecord.name;
	data.roomId = roomRecord.id;
	const reapply = new Set(input.reapplyOverrideLessonIds);
	if (
		reapply.size !== input.reapplyOverrideLessonIds.length ||
		[...reapply].some(
			(id) =>
				!lessons.some((item) => item.id === id && item.isScheduleOverride),
		)
	) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	const items: ScheduleRuleUpdateItem[] = lessons.map((record) => {
		const occurrenceDate = record.scheduleOccurrenceDate;
		if (!occurrenceDate) {
			throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
		}
		const matchesNewRule =
			occurrenceDate >= data.validFrom &&
			occurrenceDate <= data.validUntil &&
			data.weekdays.includes(isoWeekday(occurrenceDate));
		const preserved =
			!matchesNewRule || (record.isScheduleOverride && !reapply.has(record.id));
		const startsAt = preserved
			? record.startsAt
			: shanghaiDateTime(occurrenceDate, data.startMinuteOfDay);
		return {
			lessonId: record.id,
			expectedVersion: record.version,
			occurrenceDate,
			isOverride: record.isScheduleOverride,
			preserved,
			current: {
				startsAt: record.startsAt,
				endsAt: record.endsAt,
				room: record.room,
				roomId: record.roomId,
			},
			proposed: {
				startsAt,
				endsAt: preserved
					? record.endsAt
					: new Date(
							startsAt.getTime() + context.course.durationMinutes * 60_000,
						),
				room: preserved ? record.room : data.room,
				roomId: preserved ? record.roomId : data.roomId,
			},
			conflicts: [],
		};
	});
	const changedLessonIds = items
		.filter((item) => !item.preserved)
		.map((item) => item.lessonId);
	const makeupCountByLessonId = await getScheduledMakeupCountByLessonId(tx, {
		organizationId: context.rule.organizationId,
		lessonIds: changedLessonIds,
	});
	for (const lessonId of changedLessonIds) {
		const extraAttendeeCount = makeupCountByLessonId.get(lessonId) ?? 0;
		if (extraAttendeeCount === 0) continue;
		await resolveActiveClassroom(tx, {
			organizationId: context.rule.organizationId,
			campusId: context.group.campusId,
			roomId: data.roomId,
			classGroupId: context.group.id,
			extraAttendeeCount,
		});
	}
	const candidates: ScheduleCandidate[] = items
		.filter((item) => !item.preserved)
		.map((item) => ({
			occurrenceDate: item.occurrenceDate,
			baselineStartsAt: item.proposed.startsAt,
			startsAt: item.proposed.startsAt,
			endsAt: item.proposed.endsAt,
			room: normalizeRoom(item.proposed.room),
			roomId: item.proposed.roomId,
			conflicts: [],
		}));
	await markConflicts(tx, context, candidates, {
		excludedLessonIds: items.map((item) => item.lessonId),
		ignoreGenerated: true,
	});
	for (const item of items) {
		const candidate = candidates.find(
			(value) => value.occurrenceDate === item.occurrenceDate,
		);
		if (candidate) item.conflicts = candidate.conflicts;
	}
	return { data, items };
}

export async function previewScheduleRuleUpdateRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
	expectedRevision: number;
	data: ScheduleRuleData;
	effectiveFrom: string;
	reapplyOverrideLessonIds: string[];
}): Promise<{
	ruleId: string;
	revision: number;
	items: ScheduleRuleUpdateItem[];
}> {
	return db.transaction(async (tx) => {
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		if (context.rule.revision !== input.expectedRevision)
			throw new TeachingRepositoryError("SCHEDULE_RULE_VERSION_CONFLICT");
		const transactionNow = new Date();
		const preview = await buildRuleUpdatePreview(tx, context, {
			...input,
			transactionNow,
		});
		await assertNoFutureRuleConflict(tx, {
			organizationId: input.organizationId,
			classGroupId: context.group.id,
			data: preview.data,
			durationMinutes: context.course.durationMinutes,
			now: transactionNow,
			excludeRuleId: context.rule.id,
		});
		return {
			ruleId: context.rule.id,
			revision: context.rule.revision,
			items: preview.items,
		};
	});
}

export async function updateScheduleRuleRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
	expectedRevision: number;
	data: ScheduleRuleData;
	effectiveFrom: string;
	reapplyOverrideLessonIds: string[];
	requestId: string;
}): Promise<{ lessonIds: string[]; revision: number; replayed: boolean }> {
	const requestFingerprint = fingerprint({
		...input,
		organizationId: undefined,
		userId: undefined,
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
			return {
				lessonIds: existingBatch.affectedLessonIds,
				revision: input.expectedRevision + 1,
				replayed: true,
			};
		}
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		if (context.rule.revision !== input.expectedRevision)
			throw new TeachingRepositoryError("SCHEDULE_RULE_VERSION_CONFLICT");
		const transactionNow = new Date();
		const preview = await buildRuleUpdatePreview(tx, context, {
			...input,
			transactionNow,
		});
		await assertNoFutureRuleConflict(tx, {
			organizationId: input.organizationId,
			classGroupId: context.group.id,
			data: preview.data,
			durationMinutes: context.course.durationMinutes,
			now: transactionNow,
			excludeRuleId: context.rule.id,
		});
		if (preview.items.some((item) => item.conflicts.length > 0))
			throw new TeachingRepositoryError("LESSON_CONFLICT");
		const changed = preview.items.filter((item) => !item.preserved);
		for (const item of changed) {
			const updated = await tx
				.update(lesson)
				.set({
					startsAt: item.proposed.startsAt,
					endsAt: item.proposed.endsAt,
					room: item.proposed.room,
					roomId: item.proposed.roomId,
					scheduleRuleRevision: context.rule.revision + 1,
					isScheduleOverride: false,
					version: sql`${lesson.version} + 1`,
				})
				.where(
					and(
						eq(lesson.id, item.lessonId),
						eq(lesson.status, "scheduled"),
						gt(lesson.startsAt, transactionNow),
						eq(lesson.version, item.expectedVersion),
					),
				)
				.returning({ id: lesson.id });
			if (updated.length !== 1)
				throw new TeachingRepositoryError("LESSON_BULK_UPDATE_INVALID");
		}
		const preservedIds = preview.items
			.filter((item) => item.preserved && !item.isOverride)
			.map((item) => item.lessonId);
		if (preservedIds.length > 0) {
			await tx
				.update(lesson)
				.set({ isScheduleOverride: true, version: sql`${lesson.version} + 1` })
				.where(inArray(lesson.id, preservedIds));
		}
		const revision = context.rule.revision + 1;
		await tx
			.update(lessonScheduleRule)
			.set({
				...preview.data,
				revision,
				updatedByUserId: input.userId,
				updatedAt: transactionNow,
			})
			.where(
				and(
					eq(lessonScheduleRule.id, context.rule.id),
					eq(lessonScheduleRule.revision, context.rule.revision),
				),
			);
		await syncClassScheduleText(tx, {
			organizationId: input.organizationId,
			classGroupId: context.group.id,
		});
		const lessonIds = [
			...changed.map((item) => item.lessonId),
			...preservedIds,
		];
		await tx.insert(lessonScheduleBatch).values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			kind: "rule_sync",
			scheduleRuleId: context.rule.id,
			actorUserId: input.userId,
			requestFingerprint,
			affectedLessonIds: lessonIds,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "schedule_rule_updated",
			entityType: "lesson_schedule_rule",
			entityId: context.rule.id,
			actorUserId: input.userId,
			campusId: context.group.campusId,
			before: { revision: context.rule.revision },
			after: {
				revision,
				effectiveFrom: input.effectiveFrom,
				updatedLessonCount: changed.length,
				preservedExceptionCount: preview.items.length - changed.length,
				requestId: input.requestId,
			},
		});
		return { lessonIds, revision, replayed: false };
	});
}
