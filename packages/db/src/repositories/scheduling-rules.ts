import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { db } from "../index";
import {
	classGroup,
	course,
	lesson,
	lessonScheduleBatch,
	lessonScheduleRule,
	makeupLesson,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { campusAccessCondition, type Transaction } from "./campus-access";
import type { CampusAccess } from "./organization";
import {
	academicWriteRoles,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	markMakeupLessonsNeedsReschedule,
	normalizeRoom,
	resolveActiveClassroom,
	TeachingRepositoryError,
} from "./teaching-foundation";

export const MAX_SCHEDULE_CANDIDATES = 200;
export const SHANGHAI_TIMEZONE = "Asia/Shanghai";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const weekdayLabels = ["", "一", "二", "三", "四", "五", "六", "日"];

export type ScheduleRuleData = {
	weekdays: number[];
	startMinuteOfDay: number;
	room: string;
	roomId: string;
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
	roomId: string | null;
	conflicts: ScheduleConflict[];
};

export type ScheduleCandidateOverride = {
	occurrenceDate: string;
	startsAt: Date;
	room: string;
	roomId: string;
};

export type ScheduleContext = {
	rule: typeof lessonScheduleRule.$inferSelect;
	group: typeof classGroup.$inferSelect;
	course: typeof course.$inferSelect;
};

export function normalizeRuleData(input: ScheduleRuleData): ScheduleRuleData {
	const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
	if (
		weekdays.length === 0 ||
		weekdays.some(
			(value) => !Number.isInteger(value) || value < 1 || value > 7,
		) ||
		!Number.isInteger(input.startMinuteOfDay) ||
		input.startMinuteOfDay < 0 ||
		input.startMinuteOfDay >= 1440 ||
		!input.roomId ||
		!isIsoDate(input.validFrom) ||
		!isIsoDate(input.validUntil) ||
		input.validFrom > input.validUntil
	) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
	return { ...input, weekdays, room: normalizeRoom(input.room) };
}

export function isIsoDate(value: string): boolean {
	return (
		/^\d{4}-\d{2}-\d{2}$/u.test(value) &&
		!Number.isNaN(Date.parse(`${value}T00:00:00Z`))
	);
}

export function isoWeekday(value: string): number {
	const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
	return weekday === 0 ? 7 : weekday;
}

export function addIsoDate(value: string, days: number): string {
	return new Date(Date.parse(`${value}T12:00:00Z`) + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

export function shanghaiDateTime(date: string, minuteOfDay: number): Date {
	const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
	const minutes = String(minuteOfDay % 60).padStart(2, "0");
	return new Date(`${date}T${hours}:${minutes}:00+08:00`);
}

export function formatRuleScheduleText(
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

export async function syncClassScheduleText(
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

export function overlaps(
	left: Pick<ScheduleCandidate, "startsAt" | "endsAt">,
	right: Pick<ScheduleCandidate, "startsAt" | "endsAt">,
): boolean {
	return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
}

export function shanghaiDate(now: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: SHANGHAI_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = new Map(parts.map((part) => [part.type, part.value]));
	return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function hasFutureRuleTimeConflict(
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

export async function assertNoFutureRuleConflict(
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

export function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function getScheduledMakeupCountByLessonId(
	tx: Transaction,
	input: { organizationId: string; lessonIds: string[] },
): Promise<Map<string, number>> {
	if (input.lessonIds.length === 0) return new Map();
	const rows = await tx
		.select({
			lessonId: makeupLesson.targetLessonId,
			value: sql<number>`count(*)::int`,
		})
		.from(makeupLesson)
		.where(
			and(
				eq(makeupLesson.organizationId, input.organizationId),
				eq(makeupLesson.status, "scheduled"),
				inArray(makeupLesson.targetLessonId, input.lessonIds),
			),
		)
		.groupBy(makeupLesson.targetLessonId);
	return new Map(rows.map((item) => [item.lessonId, item.value]));
}

export async function loadRuleContext(
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

export function expandCandidates(
	rule: Pick<
		typeof lessonScheduleRule.$inferSelect,
		| "weekdays"
		| "startMinuteOfDay"
		| "room"
		| "roomId"
		| "validFrom"
		| "validUntil"
	>,
	durationMinutes: number,
	range: { from: string; to: string },
	overrides: ScheduleCandidateOverride[],
): ScheduleCandidate[] {
	if (overrides.some((item) => !item.roomId)) {
		throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
	}
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
			roomId: override?.roomId ?? rule.roomId,
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

export async function resolveCandidateClassrooms(
	tx: Transaction,
	context: ScheduleContext,
	candidates: ScheduleCandidate[],
): Promise<void> {
	const resolved = new Map<
		string,
		Awaited<ReturnType<typeof resolveActiveClassroom>>
	>();
	for (const candidate of candidates) {
		if (!candidate.roomId) {
			throw new TeachingRepositoryError("SCHEDULE_CANDIDATE_INVALID");
		}
		let roomRecord = resolved.get(candidate.roomId);
		if (!roomRecord) {
			roomRecord = await resolveActiveClassroom(tx, {
				organizationId: context.rule.organizationId,
				campusId: context.group.campusId,
				roomId: candidate.roomId,
				classGroupId: context.group.id,
			});
			resolved.set(candidate.roomId, roomRecord);
		}
		candidate.room = roomRecord.name;
		candidate.roomId = roomRecord.id;
	}
}

export async function markConflicts(
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
			roomId: lesson.roomId,
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
				((record.roomId && record.roomId === candidate.roomId) ||
					normalizeRoom(record.room) === normalizeRoom(candidate.room))
			) {
				conflicts.add("room");
			}
		}
		for (let otherIndex = 0; otherIndex < candidates.length; otherIndex += 1) {
			if (index === otherIndex) continue;
			const other = candidates[otherIndex];
			if (!other || !overlaps(candidate, other)) continue;
			conflicts.add("teacher");
			if (
				(candidate.roomId && candidate.roomId === other.roomId) ||
				normalizeRoom(candidate.room) === normalizeRoom(other.room)
			)
				conflicts.add("room");
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
	const filters = [
		eq(lessonScheduleRule.organizationId, input.organizationId),
		campusAccessCondition(classGroup.campusId, input.campusAccess),
	];
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
	return rows.map(({ rule, ...context }) => ({
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
		const roomRecord = await resolveActiveClassroom(tx, {
			organizationId: input.organizationId,
			campusId: group.campusId,
			roomId: data.roomId,
			classGroupId: group.id,
		});
		data.room = roomRecord.name;
		data.roomId = roomRecord.id;
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
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
		if (!context.rule.isActive)
			throw new TeachingRepositoryError("SCHEDULE_RULE_INACTIVE");
		const candidates = expandCandidates(
			context.rule,
			context.course.durationMinutes,
			input,
			input.overrides,
		);
		await resolveCandidateClassrooms(tx, context, candidates);
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
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
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
		await resolveCandidateClassrooms(tx, context, candidates);
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
					roomId: candidate.roomId,
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
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
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
		const context = await loadRuleContext(tx, input, {
			requireSchedulable: true,
		});
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
			await markMakeupLessonsNeedsReschedule(tx, {
				organizationId: input.organizationId,
				actorUserId: input.userId,
				campusId: context.group.campusId,
				targetLessonIds: cancelledLessonIds,
				reason: "schedule_rule_deactivated",
				occurredAt: now,
			});
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
			requireSchedulable: true,
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
