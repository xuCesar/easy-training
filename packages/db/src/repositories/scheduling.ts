import { createHash } from "node:crypto";

import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "../index";
import {
	classGroup,
	course,
	lesson,
	lessonScheduleBatch,
	lessonScheduleRule,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";
import {
	academicWriteRoles,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	normalizeRoom,
	TeachingRepositoryError,
	type Transaction,
} from "./teaching";

export const MAX_SCHEDULE_CANDIDATES = 200;
const SHANGHAI_TIMEZONE = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;
const weekdayLabels = ["", "一", "二", "三", "四", "五", "六", "日"];

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

export type ScheduleRuleData = {
	weekdays: number[];
	startMinuteOfDay: number;
	room: string;
	validFrom: string;
	validUntil: string;
};

export type ScheduleRuleRecord = typeof lessonScheduleRule.$inferSelect & {
	className: string;
	campusId: string;
	teacherId: string;
	courseId: string;
	durationMinutes: number;
	hasGeneratedLessons?: boolean;
};

export type ScheduleConflict = "teacher" | "room" | "already_generated";

export type ScheduleCandidate = {
	occurrenceDate: string;
	baselineStartsAt: Date;
	startsAt: Date;
	endsAt: Date;
	room: string;
	conflicts: ScheduleConflict[];
};

export type ScheduleCandidateOverride = {
	occurrenceDate: string;
	startsAt: Date;
	room: string;
};

type ScheduleContext = {
	rule: typeof lessonScheduleRule.$inferSelect;
	group: typeof classGroup.$inferSelect;
	course: typeof course.$inferSelect;
};

function normalizeRuleData(input: ScheduleRuleData): ScheduleRuleData {
	const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
	if (
		weekdays.length === 0 ||
		weekdays.some(
			(value) => !Number.isInteger(value) || value < 1 || value > 7,
		) ||
		!Number.isInteger(input.startMinuteOfDay) ||
		input.startMinuteOfDay < 0 ||
		input.startMinuteOfDay >= 1440 ||
		!isIsoDate(input.validFrom) ||
		!isIsoDate(input.validUntil) ||
		input.validFrom > input.validUntil
	) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	return { ...input, weekdays, room: normalizeRoom(input.room) };
}

function isIsoDate(value: string): boolean {
	return (
		/^\d{4}-\d{2}-\d{2}$/u.test(value) &&
		!Number.isNaN(Date.parse(`${value}T00:00:00Z`))
	);
}

function isoWeekday(value: string): number {
	const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
	return weekday === 0 ? 7 : weekday;
}

function addIsoDate(value: string, days: number): string {
	return new Date(Date.parse(`${value}T12:00:00Z`) + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

function shanghaiDateTime(date: string, minuteOfDay: number): Date {
	const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
	const minutes = String(minuteOfDay % 60).padStart(2, "0");
	return new Date(`${date}T${hours}:${minutes}:00+08:00`);
}

function formatRuleScheduleText(
	rule: Pick<
		typeof lessonScheduleRule.$inferSelect,
		"weekdays" | "startMinuteOfDay" | "room"
	>,
): string {
	const hours = String(Math.floor(rule.startMinuteOfDay / 60)).padStart(2, "0");
	const minutes = String(rule.startMinuteOfDay % 60).padStart(2, "0");
	const weekdays = rule.weekdays
		.map((weekday) => weekdayLabels[weekday])
		.filter((weekday): weekday is string => Boolean(weekday))
		.join("、");
	return `每周${weekdays} ${hours}:${minutes} · ${rule.room}`;
}

async function syncClassScheduleText(
	tx: Transaction,
	input: { organizationId: string; classGroupId: string },
): Promise<void> {
	const activeRules = await tx
		.select({
			weekdays: lessonScheduleRule.weekdays,
			startMinuteOfDay: lessonScheduleRule.startMinuteOfDay,
			room: lessonScheduleRule.room,
		})
		.from(lessonScheduleRule)
		.where(
			and(
				eq(lessonScheduleRule.organizationId, input.organizationId),
				eq(lessonScheduleRule.classGroupId, input.classGroupId),
				eq(lessonScheduleRule.isActive, true),
			),
		)
		.orderBy(asc(lessonScheduleRule.validFrom), asc(lessonScheduleRule.id));
	await tx
		.update(classGroup)
		.set({
			scheduleText:
				activeRules.map(formatRuleScheduleText).join("；") || "排课待定",
		})
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		);
}

function overlaps(
	left: Pick<ScheduleCandidate, "startsAt" | "endsAt">,
	right: Pick<ScheduleCandidate, "startsAt" | "endsAt">,
): boolean {
	return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
}

function shanghaiDate(now: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: SHANGHAI_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = new Map(parts.map((part) => [part.type, part.value]));
	return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function hasFutureRuleTimeConflict(
	left: Pick<
		typeof lessonScheduleRule.$inferSelect,
		"weekdays" | "startMinuteOfDay" | "validFrom" | "validUntil"
	>,
	right: Pick<
		ScheduleRuleData,
		"weekdays" | "startMinuteOfDay" | "validFrom" | "validUntil"
	>,
	durationMinutes: number,
	now: Date,
): boolean {
	const from = [left.validFrom, right.validFrom, shanghaiDate(now)].sort()[2];
	const to = [left.validUntil, right.validUntil].sort()[0];
	if (!from || !to || from > to) return false;
	const sharedWeekdays = new Set(
		left.weekdays.filter((weekday) => right.weekdays.includes(weekday)),
	);
	if (sharedWeekdays.size === 0) return false;
	for (let offset = 0; offset < 7; offset += 1) {
		const occurrenceDate = addIsoDate(from, offset);
		if (occurrenceDate > to) return false;
		if (!sharedWeekdays.has(isoWeekday(occurrenceDate))) continue;
		const leftStartsAt = shanghaiDateTime(
			occurrenceDate,
			left.startMinuteOfDay,
		);
		const rightStartsAt = shanghaiDateTime(
			occurrenceDate,
			right.startMinuteOfDay,
		);
		if (leftStartsAt <= now || rightStartsAt <= now) continue;
		const leftEndsAt = new Date(
			leftStartsAt.getTime() + durationMinutes * 60_000,
		);
		const rightEndsAt = new Date(
			rightStartsAt.getTime() + durationMinutes * 60_000,
		);
		if (leftStartsAt < rightEndsAt && leftEndsAt > rightStartsAt) return true;
	}
	return false;
}

async function assertNoFutureRuleConflict(
	tx: Transaction,
	input: {
		organizationId: string;
		classGroupId: string;
		data: ScheduleRuleData;
		durationMinutes: number;
		now: Date;
		excludeRuleId?: string;
	},
): Promise<void> {
	const activeRules = await tx
		.select()
		.from(lessonScheduleRule)
		.where(
			and(
				eq(lessonScheduleRule.organizationId, input.organizationId),
				eq(lessonScheduleRule.classGroupId, input.classGroupId),
				eq(lessonScheduleRule.isActive, true),
			),
		)
		.for("update");
	if (
		activeRules.some(
			(rule) =>
				rule.id !== input.excludeRuleId &&
				hasFutureRuleTimeConflict(
					rule,
					input.data,
					input.durationMinutes,
					input.now,
				),
		)
	) {
		throw new TeachingRepositoryError("SCHEDULE_RULE_CONFLICT");
	}
}

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadRuleContext(
	tx: Transaction,
	input: { organizationId: string; userId: string; ruleId: string },
	options: { requireSchedulable?: boolean } = {},
): Promise<ScheduleContext> {
	const access = await getCurrentWriteCampusAccess(tx, {
		organizationId: input.organizationId,
		userId: input.userId,
		allowedRoles: academicWriteRoles,
	});
	const [record] = await tx
		.select({ rule: lessonScheduleRule, group: classGroup, course })
		.from(lessonScheduleRule)
		.innerJoin(
			classGroup,
			and(
				eq(classGroup.id, lessonScheduleRule.classGroupId),
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
				eq(lessonScheduleRule.id, input.ruleId),
				eq(lessonScheduleRule.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!record) throw new TeachingRepositoryError("SCHEDULE_RULE_NOT_FOUND");
	await assertWritableCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: access,
		campusId: record.group.campusId,
	});
	if (!options.requireSchedulable) return record;
	if (
		record.group.status !== "recruiting" &&
		record.group.status !== "running"
	) {
		throw new TeachingRepositoryError("CLASS_NOT_SCHEDULABLE");
	}
	await assertCourseActive(tx, input.organizationId, record.group.courseId);
	await assertTeacherForCampus(tx, {
		organizationId: input.organizationId,
		teacherId: record.group.teacherId,
		campusId: record.group.campusId,
	});
	return record;
}

function expandCandidates(
	rule: Pick<
		typeof lessonScheduleRule.$inferSelect,
		"weekdays" | "startMinuteOfDay" | "room" | "validFrom" | "validUntil"
	>,
	durationMinutes: number,
	range: { from: string; to: string },
	overrides: ScheduleCandidateOverride[],
): ScheduleCandidate[] {
	const from = range.from > rule.validFrom ? range.from : rule.validFrom;
	const to = range.to < rule.validUntil ? range.to : rule.validUntil;
	if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
	const overrideMap = new Map(
		overrides.map((item) => [item.occurrenceDate, item]),
	);
	const result: ScheduleCandidate[] = [];
	for (let date = from; date <= to; date = addIsoDate(date, 1)) {
		if (!rule.weekdays.includes(isoWeekday(date))) continue;
		const baselineStartsAt = shanghaiDateTime(date, rule.startMinuteOfDay);
		const override = overrideMap.get(date);
		const startsAt = override?.startsAt ?? baselineStartsAt;
		const room = normalizeRoom(override?.room ?? rule.room);
		result.push({
			occurrenceDate: date,
			baselineStartsAt,
			startsAt,
			endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
			room,
			conflicts: [],
		});
		if (result.length > MAX_SCHEDULE_CANDIDATES) {
			throw new TeachingRepositoryError("SCHEDULE_BATCH_TOO_LARGE");
		}
	}
	if (
		overrideMap.size !== overrides.length ||
		result.some((item) => !Number.isFinite(item.startsAt.getTime()))
	) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	return result;
}

async function markConflicts(
	tx: Transaction,
	context: ScheduleContext,
	candidates: ScheduleCandidate[],
	options: { excludedLessonIds?: string[]; ignoreGenerated?: boolean } = {},
): Promise<ScheduleCandidate[]> {
	if (candidates.length === 0) return candidates;
	const excludedLessonIds = options.excludedLessonIds ?? [];
	const occurrenceDates = candidates.map((item) => item.occurrenceDate);
	const generated = options.ignoreGenerated
		? []
		: await tx
				.select({ occurrenceDate: lesson.scheduleOccurrenceDate })
				.from(lesson)
				.where(
					and(
						eq(lesson.organizationId, context.rule.organizationId),
						eq(lesson.scheduleRuleId, context.rule.id),
						inArray(lesson.scheduleOccurrenceDate, occurrenceDates),
					),
				);
	const generatedDates = new Set(
		generated.flatMap((item) => item.occurrenceDate ?? []),
	);
	const minStartsAt = new Date(
		Math.min(...candidates.map((item) => item.startsAt.getTime())),
	);
	const maxEndsAt = new Date(
		Math.max(...candidates.map((item) => item.endsAt.getTime())),
	);
	const existing = await tx
		.select({
			id: lesson.id,
			teacherId: lesson.teacherId,
			campusId: lesson.campusId,
			room: lesson.room,
			startsAt: lesson.startsAt,
			endsAt: lesson.endsAt,
		})
		.from(lesson)
		.where(
			and(
				eq(lesson.organizationId, context.rule.organizationId),
				eq(lesson.status, "scheduled"),
				lt(lesson.startsAt, maxEndsAt),
				gt(lesson.endsAt, minStartsAt),
			),
		);
	const excluded = new Set(excludedLessonIds);
	for (const [index, candidate] of candidates.entries()) {
		const conflicts = new Set<ScheduleConflict>();
		if (generatedDates.has(candidate.occurrenceDate))
			conflicts.add("already_generated");
		for (const record of existing) {
			if (excluded.has(record.id) || !overlaps(candidate, record)) continue;
			if (record.teacherId === context.group.teacherId)
				conflicts.add("teacher");
			if (
				record.campusId === context.group.campusId &&
				normalizeRoom(record.room) === candidate.room
			) {
				conflicts.add("room");
			}
		}
		for (let otherIndex = 0; otherIndex < candidates.length; otherIndex += 1) {
			if (index === otherIndex) continue;
			const other = candidates[otherIndex];
			if (!other || !overlaps(candidate, other)) continue;
			conflicts.add("teacher");
			if (candidate.room === other.room) conflicts.add("room");
		}
		candidate.conflicts = [...conflicts];
	}
	return candidates;
}

export async function listScheduleRuleRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	classGroupId?: string;
}): Promise<ScheduleRuleRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [eq(lessonScheduleRule.organizationId, input.organizationId)];
	if (input.classGroupId)
		filters.push(eq(lessonScheduleRule.classGroupId, input.classGroupId));
	const rows = await db
		.select({
			rule: lessonScheduleRule,
			className: classGroup.name,
			campusId: classGroup.campusId,
			teacherId: classGroup.teacherId,
			courseId: classGroup.courseId,
			durationMinutes: course.durationMinutes,
		})
		.from(lessonScheduleRule)
		.innerJoin(classGroup, eq(classGroup.id, lessonScheduleRule.classGroupId))
		.innerJoin(course, eq(course.id, classGroup.courseId))
		.where(and(...filters))
		.orderBy(asc(lessonScheduleRule.validFrom), asc(lessonScheduleRule.id));
	const ruleIds = rows.map((row) => row.rule.id);
	const generatedRuleIds = new Set(
		ruleIds.length === 0
			? []
			: (
					await db
						.select({ scheduleRuleId: lesson.scheduleRuleId })
						.from(lesson)
						.where(
							and(
								eq(lesson.organizationId, input.organizationId),
								inArray(lesson.scheduleRuleId, ruleIds),
							),
						)
				).flatMap((item) => item.scheduleRuleId ?? []),
	);
	return rows
		.filter((row) => isCampusAccessible(input.campusAccess, row.campusId))
		.map(({ rule, ...context }) => ({
			...rule,
			...context,
			hasGeneratedLessons: generatedRuleIds.has(rule.id),
		}));
}

export async function createScheduleRuleRecord(input: {
	organizationId: string;
	userId: string;
	classGroupId: string;
	data: ScheduleRuleData;
}): Promise<ScheduleRuleRecord> {
	const data = normalizeRuleData(input.data);
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
		await assertCourseActive(tx, input.organizationId, group.courseId);
		const [courseRecord] = await tx
			.select({ durationMinutes: course.durationMinutes })
			.from(course)
			.where(
				and(
					eq(course.id, group.courseId),
					eq(course.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!courseRecord) throw new TeachingRepositoryError("COURSE_NOT_FOUND");
		await assertTeacherForCampus(tx, {
			organizationId: input.organizationId,
			teacherId: group.teacherId,
			campusId: group.campusId,
		});
		const [duplicate] = await tx
			.select({ id: lessonScheduleRule.id })
			.from(lessonScheduleRule)
			.where(
				and(
					eq(lessonScheduleRule.organizationId, input.organizationId),
					eq(lessonScheduleRule.classGroupId, group.id),
					eq(lessonScheduleRule.kind, "weekly"),
					eq(lessonScheduleRule.intervalWeeks, 1),
					eq(lessonScheduleRule.weekdays, data.weekdays),
					eq(lessonScheduleRule.startMinuteOfDay, data.startMinuteOfDay),
					eq(lessonScheduleRule.room, data.room),
					eq(lessonScheduleRule.validFrom, data.validFrom),
					eq(lessonScheduleRule.validUntil, data.validUntil),
					eq(lessonScheduleRule.isActive, true),
				),
			)
			.limit(1)
			.for("update");
		if (duplicate) throw new TeachingRepositoryError("SCHEDULE_RULE_DUPLICATE");
		await assertNoFutureRuleConflict(tx, {
			organizationId: input.organizationId,
			classGroupId: group.id,
			data,
			durationMinutes: courseRecord.durationMinutes,
			now: new Date(),
		});
		const [created] = await tx
			.insert(lessonScheduleRule)
			.values({
				organizationId: input.organizationId,
				classGroupId: group.id,
				kind: "weekly",
				intervalWeeks: 1,
				...data,
				timezone: SHANGHAI_TIMEZONE,
				createdByUserId: input.userId,
				updatedByUserId: input.userId,
			})
			.returning({ id: lessonScheduleRule.id });
		if (!created)
			throw new Error("Schedule rule creation did not return a record.");
		await syncClassScheduleText(tx, {
			organizationId: input.organizationId,
			classGroupId: group.id,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "schedule_rule_created",
			entityType: "lesson_schedule_rule",
			entityId: created.id,
			actorUserId: input.userId,
			campusId: group.campusId,
			after: {
				classGroupId: group.id,
				validFrom: data.validFrom,
				validUntil: data.validUntil,
				revision: 1,
			},
		});
		return created.id;
	});
	const record = (
		await listScheduleRuleRecords({
			organizationId: input.organizationId,
			campusAccess: { kind: "all" },
		})
	).find((item) => item.id === createdId);
	if (!record) throw new Error("Created schedule rule was not readable.");
	return record;
}

export async function previewScheduleGenerationRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
	from: string;
	to: string;
	overrides: ScheduleCandidateOverride[];
}): Promise<{ rule: ScheduleRuleRecord; candidates: ScheduleCandidate[] }> {
	return db.transaction(async (tx) => {
		const context = await loadRuleContext(tx, input);
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		const candidates = expandCandidates(
			context.rule,
			context.course.durationMinutes,
			input,
			input.overrides,
		);
		await markConflicts(tx, context, candidates);
		return {
			rule: {
				...context.rule,
				className: context.group.name,
				campusId: context.group.campusId,
				teacherId: context.group.teacherId,
				courseId: context.group.courseId,
				durationMinutes: context.course.durationMinutes,
			},
			candidates,
		};
	});
}

export async function generateScheduleLessonsRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
	expectedRevision: number;
	from: string;
	to: string;
	requestId: string;
	candidates: ScheduleCandidateOverride[];
}): Promise<{ lessonIds: string[]; replayed: boolean }> {
	const requestFingerprint = fingerprint({
		ruleId: input.ruleId,
		expectedRevision: input.expectedRevision,
		from: input.from,
		to: input.to,
		candidates: input.candidates.map((item) => ({
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
		const context = await loadRuleContext(tx, input);
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		if (context.rule.revision !== input.expectedRevision)
			throw new TeachingRepositoryError("SCHEDULE_RULE_VERSION_CONFLICT");
		const candidates = expandCandidates(
			context.rule,
			context.course.durationMinutes,
			input,
			input.candidates,
		);
		const submittedOccurrenceDates = new Set(
			input.candidates.map((item) => item.occurrenceDate),
		);
		const expectedOccurrenceDates = new Set(
			candidates.map((item) => item.occurrenceDate),
		);
		if (
			candidates.length !== input.candidates.length ||
			submittedOccurrenceDates.size !== input.candidates.length ||
			submittedOccurrenceDates.size !== expectedOccurrenceDates.size ||
			[...submittedOccurrenceDates].some(
				(occurrenceDate) => !expectedOccurrenceDates.has(occurrenceDate),
			)
		)
			throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
		await markConflicts(tx, context, candidates);
		if (candidates.some((candidate) => candidate.conflicts.length > 0))
			throw new TeachingRepositoryError("LESSON_CONFLICT");
		const created = await tx
			.insert(lesson)
			.values(
				candidates.map((candidate) => ({
					organizationId: input.organizationId,
					classGroupId: context.group.id,
					teacherId: context.group.teacherId,
					campusId: context.group.campusId,
					room: candidate.room,
					startsAt: candidate.startsAt,
					endsAt: candidate.endsAt,
					scheduleRuleId: context.rule.id,
					scheduleRuleRevision: context.rule.revision,
					scheduleOccurrenceDate: candidate.occurrenceDate,
					isScheduleOverride:
						candidate.startsAt.getTime() !==
							candidate.baselineStartsAt.getTime() ||
						candidate.room !== context.rule.room,
				})),
			)
			.returning({ id: lesson.id });
		const lessonIds = created.map((item) => item.id);
		await tx.insert(lessonScheduleBatch).values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			kind: "generate",
			scheduleRuleId: context.rule.id,
			actorUserId: input.userId,
			requestFingerprint,
			affectedLessonIds: lessonIds,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "lessons_generated",
			entityType: "lesson_schedule_rule",
			entityId: context.rule.id,
			actorUserId: input.userId,
			campusId: context.group.campusId,
			after: {
				requestId: input.requestId,
				count: lessonIds.length,
				from: input.from,
				to: input.to,
			},
		});
		return { lessonIds, replayed: false };
	});
}

export async function previewScheduleRuleDeactivationRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
}): Promise<{ ruleId: string; revision: number; futureLessonIds: string[] }> {
	return db.transaction(async (tx) => {
		const context = await loadRuleContext(tx, input);
		const rows = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(lesson.scheduleRuleId, input.ruleId),
					eq(lesson.status, "scheduled"),
					gt(lesson.startsAt, new Date()),
				),
			)
			.orderBy(asc(lesson.startsAt), asc(lesson.id));
		return {
			ruleId: context.rule.id,
			revision: context.rule.revision,
			futureLessonIds: rows.map((item) => item.id),
		};
	});
}

export async function deactivateScheduleRuleRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
	expectedRevision: number;
	cancelFuture: boolean;
	reason: string | null;
	requestId: string;
}): Promise<{ cancelledLessonIds: string[] }> {
	const reason = input.reason?.trim() || null;
	if (input.cancelFuture && !reason)
		throw new TeachingRepositoryError("INVALID_INPUT");
	const requestFingerprint = fingerprint({
		ruleId: input.ruleId,
		expectedRevision: input.expectedRevision,
		cancelFuture: input.cancelFuture,
		reason,
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
			return { cancelledLessonIds: existingBatch.affectedLessonIds };
		}
		const context = await loadRuleContext(tx, input);
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		if (context.rule.revision !== input.expectedRevision)
			throw new TeachingRepositoryError("SCHEDULE_RULE_VERSION_CONFLICT");
		const now = new Date();
		const future = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(lesson.scheduleRuleId, input.ruleId),
					eq(lesson.status, "scheduled"),
					gt(lesson.startsAt, now),
				),
			)
			.orderBy(asc(lesson.id))
			.for("update");
		const cancelledLessonIds = input.cancelFuture
			? future.map((item) => item.id)
			: [];
		if (cancelledLessonIds.length > 0) {
			await tx
				.update(lesson)
				.set({
					status: "cancelled",
					cancelledAt: now,
					cancelledByUserId: input.userId,
					cancellationReason: reason,
					version: sql`${lesson.version} + 1`,
				})
				.where(inArray(lesson.id, cancelledLessonIds));
		}
		await tx
			.update(lessonScheduleRule)
			.set({
				isActive: false,
				revision: context.rule.revision + 1,
				updatedByUserId: input.userId,
				updatedAt: now,
			})
			.where(eq(lessonScheduleRule.id, context.rule.id));
		await syncClassScheduleText(tx, {
			organizationId: input.organizationId,
			classGroupId: context.group.id,
		});
		await tx.insert(lessonScheduleBatch).values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			kind: "rule_cancel_future",
			scheduleRuleId: context.rule.id,
			actorUserId: input.userId,
			requestFingerprint,
			affectedLessonIds: cancelledLessonIds,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "schedule_rule_deactivated",
			entityType: "lesson_schedule_rule",
			entityId: context.rule.id,
			actorUserId: input.userId,
			campusId: context.group.campusId,
			before: { revision: context.rule.revision, isActive: true },
			after: {
				revision: context.rule.revision + 1,
				isActive: false,
				cancelledLessonCount: cancelledLessonIds.length,
				requestId: input.requestId,
			},
		});
		if (cancelledLessonIds.length > 0)
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "lessons_bulk_cancelled",
				entityType: "lesson_schedule_rule",
				entityId: context.rule.id,
				actorUserId: input.userId,
				campusId: context.group.campusId,
				after: { requestId: input.requestId, count: cancelledLessonIds.length },
			});
		return { cancelledLessonIds };
	});
}

export async function deleteScheduleRuleRecord(input: {
	organizationId: string;
	userId: string;
	ruleId: string;
}): Promise<{ deletedRuleId: string }> {
	return db.transaction(async (tx) => {
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: false,
		});
		const [generatedLesson] = await tx
			.select({ id: lesson.id })
			.from(lesson)
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(lesson.scheduleRuleId, context.rule.id),
				),
			)
			.limit(1)
			.for("update");
		if (generatedLesson) {
			throw new TeachingRepositoryError("SCHEDULE_RULE_HAS_GENERATED_LESSONS");
		}
		await tx
			.delete(lessonScheduleBatch)
			.where(
				and(
					eq(lessonScheduleBatch.organizationId, input.organizationId),
					eq(lessonScheduleBatch.scheduleRuleId, context.rule.id),
				),
			);
		const [deleted] = await tx
			.delete(lessonScheduleRule)
			.where(
				and(
					eq(lessonScheduleRule.id, context.rule.id),
					eq(lessonScheduleRule.organizationId, input.organizationId),
				),
			)
			.returning({ id: lessonScheduleRule.id });
		if (!deleted) throw new TeachingRepositoryError("SCHEDULE_RULE_NOT_FOUND");
		await syncClassScheduleText(tx, {
			organizationId: input.organizationId,
			classGroupId: context.group.id,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "schedule_rule_deleted",
			entityType: "lesson_schedule_rule",
			entityId: context.rule.id,
			actorUserId: input.userId,
			campusId: context.group.campusId,
			before: {
				revision: context.rule.revision,
				isActive: context.rule.isActive,
			},
		});
		return { deletedRuleId: deleted.id };
	});
}

export type ScheduleRuleUpdateItem = {
	lessonId: string;
	expectedVersion: number;
	occurrenceDate: string;
	isOverride: boolean;
	preserved: boolean;
	current: { startsAt: Date; endsAt: Date; room: string };
	proposed: { startsAt: Date; endsAt: Date; room: string };
	conflicts: ScheduleConflict[];
};

async function buildRuleUpdatePreview(
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
			},
			proposed: {
				startsAt,
				endsAt: preserved
					? record.endsAt
					: new Date(
							startsAt.getTime() + context.course.durationMinutes * 60_000,
						),
				room: preserved ? record.room : data.room,
			},
			conflicts: [],
		};
	});
	const candidates: ScheduleCandidate[] = items
		.filter((item) => !item.preserved)
		.map((item) => ({
			occurrenceDate: item.occurrenceDate,
			baselineStartsAt: item.proposed.startsAt,
			startsAt: item.proposed.startsAt,
			endsAt: item.proposed.endsAt,
			room: normalizeRoom(item.proposed.room),
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
		const context = await loadRuleContext(tx, input);
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
		const context = await loadRuleContext(tx, input);
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
					room: normalizeRoom(item.proposed.room),
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

export type BulkLessonUpdateInput = {
	id: string;
	expectedVersion: number;
	startsAt: Date;
	teacherId: string;
	room: string;
};

export type BulkLessonUpdateItem = {
	id: string;
	expectedVersion: number;
	classGroupId: string;
	campusId: string;
	current: { startsAt: Date; endsAt: Date; teacherId: string; room: string };
	proposed: { startsAt: Date; endsAt: Date; teacherId: string; room: string };
	conflicts: Array<"teacher" | "room" | "time">;
};

async function buildBulkLessonUpdatePreview(
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
		new Set(input.items.map((item) => item.id)).size !== input.items.length
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
		const room = normalizeRoom(requestedItem.room);
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
			},
			proposed: {
				startsAt: requestedItem.startsAt,
				endsAt: new Date(
					requestedItem.startsAt.getTime() + record.durationMinutes * 60_000,
				),
				teacherId: requestedItem.teacherId,
				room,
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
				normalizeRoom(record.room) === item.proposed.room
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
					other.proposed.room === item.proposed.room)
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
					isScheduleOverride:
						item.current.startsAt.getTime() !==
							item.proposed.startsAt.getTime() ||
						item.current.teacherId !== item.proposed.teacherId ||
						normalizeRoom(item.current.room) !== item.proposed.room
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
