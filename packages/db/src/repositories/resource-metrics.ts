import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	attendance,
	classGroup,
	classGroupCapacityHistory,
	enrollment,
	lesson,
	teacher,
	teacherCampus,
	teacherCapacityHistory,
} from "../schema";
import type { CampusAccess } from "./organization";

type ResourceMetricScope = {
	organizationId: string;
	campusAccess: CampusAccess;
	teacherUserId?: string;
};

type CapacityHistory = { effectiveFrom: string; value: number };

function campusFilter(access: CampusAccess, campusId: AnyPgColumn) {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "selected") return inArray(campusId, access.campusIds);
	return sql`true`;
}

function shanghaiDate(value: Date): string {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(value);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

function daysBetween(from: string, to: string): number {
	return Math.max(
		0,
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			(24 * 60 * 60 * 1000),
	);
}

function capacityMinutes(
	history: CapacityHistory[],
	from: string,
	to: string,
): { minutes: number; coveredDays: number } {
	let minutes = 0;
	let coveredDays = 0;
	for (const [index, item] of history.entries()) {
		const next = history[index + 1]?.effectiveFrom ?? to;
		const startsAt = item.effectiveFrom > from ? item.effectiveFrom : from;
		const endsAt = next < to ? next : to;
		const days = daysBetween(startsAt, endsAt);
		if (days === 0) continue;
		minutes += (item.value * days) / 7;
		coveredDays += days;
	}
	return { minutes, coveredDays };
}

function valueAt(history: CapacityHistory[], at: string): number | null {
	for (const item of [...history].reverse()) {
		if (item.effectiveFrom <= at) return item.value;
	}
	return null;
}

export async function getResourceUtilizationRecord(input: {
	scope: ResourceMetricScope;
	from: Date;
	to: Date;
	asOf: Date;
}) {
	const actualTo = input.to < input.asOf ? input.to : input.asOf;
	const [teacherRows, classRows, lessonRows] = await Promise.all([
		db
			.select({ id: teacher.id })
			.from(teacher)
			.leftJoin(teacherCampus, eq(teacherCampus.teacherId, teacher.id))
			.where(
				and(
					eq(teacher.organizationId, input.scope.organizationId),
					input.scope.teacherUserId
						? eq(teacher.userId, input.scope.teacherUserId)
						: input.scope.campusAccess.kind === "selected"
							? inArray(
									teacherCampus.campusId,
									input.scope.campusAccess.campusIds,
								)
							: input.scope.campusAccess.kind === "none"
								? sql`false`
								: sql`true`,
				),
			),
		db
			.select({
				id: classGroup.id,
				capacity: classGroup.capacity,
				activeSeats: sql<number>`count(distinct ${enrollment.studentId})::int`,
			})
			.from(classGroup)
			.leftJoin(
				enrollment,
				and(
					eq(enrollment.classGroupId, classGroup.id),
					eq(enrollment.organizationId, input.scope.organizationId),
					eq(enrollment.status, "active"),
				),
			)
			.where(
				and(
					eq(classGroup.organizationId, input.scope.organizationId),
					inArray(classGroup.status, ["recruiting", "running"]),
					campusFilter(input.scope.campusAccess, classGroup.campusId),
				),
			)
			.groupBy(classGroup.id),
		db
			.select({
				teacherId: lesson.teacherId,
				classGroupId: lesson.classGroupId,
				startsAt: lesson.startsAt,
				endsAt: lesson.endsAt,
				status: lesson.status,
				attendeeCount: sql<number>`count(distinct ${attendance.studentId})::int`,
			})
			.from(lesson)
			.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
			.leftJoin(attendance, eq(attendance.lessonId, lesson.id))
			.where(
				and(
					eq(lesson.organizationId, input.scope.organizationId),
					gte(lesson.startsAt, input.from),
					lt(lesson.startsAt, input.to),
					campusFilter(input.scope.campusAccess, lesson.campusId),
					input.scope.teacherUserId
						? eq(teacher.userId, input.scope.teacherUserId)
						: sql`true`,
				),
			)
			.groupBy(lesson.id),
	]);
	const teacherIds = [...new Set(teacherRows.map((row) => row.id))];
	const classGroupIds = [...new Set(classRows.map((row) => row.id))];
	const [teacherHistoryRows, classHistoryRows] = await Promise.all([
		teacherIds.length === 0
			? []
			: db
					.select({
						teacherId: teacherCapacityHistory.teacherId,
						effectiveFrom: teacherCapacityHistory.effectiveFrom,
						value: teacherCapacityHistory.weeklyCapacityMinutes,
					})
					.from(teacherCapacityHistory)
					.where(
						and(
							eq(
								teacherCapacityHistory.organizationId,
								input.scope.organizationId,
							),
							inArray(teacherCapacityHistory.teacherId, teacherIds),
						),
					)
					.orderBy(teacherCapacityHistory.effectiveFrom),
		classGroupIds.length === 0
			? []
			: db
					.select({
						classGroupId: classGroupCapacityHistory.classGroupId,
						effectiveFrom: classGroupCapacityHistory.effectiveFrom,
						value: classGroupCapacityHistory.capacity,
					})
					.from(classGroupCapacityHistory)
					.where(
						and(
							eq(
								classGroupCapacityHistory.organizationId,
								input.scope.organizationId,
							),
							inArray(classGroupCapacityHistory.classGroupId, classGroupIds),
						),
					)
					.orderBy(classGroupCapacityHistory.effectiveFrom),
	]);
	const teacherHistory = new Map<string, CapacityHistory[]>();
	for (const row of teacherHistoryRows) {
		const items = teacherHistory.get(row.teacherId) ?? [];
		items.push({ effectiveFrom: row.effectiveFrom, value: row.value });
		teacherHistory.set(row.teacherId, items);
	}
	const classHistory = new Map<string, CapacityHistory[]>();
	for (const row of classHistoryRows) {
		const items = classHistory.get(row.classGroupId) ?? [];
		items.push({ effectiveFrom: row.effectiveFrom, value: row.value });
		classHistory.set(row.classGroupId, items);
	}
	const fromDay = shanghaiDate(input.from);
	const toDay = shanghaiDate(input.to);
	const actualToDay = shanghaiDate(actualTo);
	let actualCapacityMinutes = 0;
	let plannedCapacityMinutes = 0;
	let capacityCoverageMissingTeacherCount = 0;
	let capacityCoveragePartialTeacherCount = 0;
	for (const row of teacherRows) {
		const history = teacherHistory.get(row.id) ?? [];
		const actual = capacityMinutes(history, fromDay, actualToDay);
		const planned = capacityMinutes(history, fromDay, toDay);
		actualCapacityMinutes += actual.minutes;
		plannedCapacityMinutes += planned.minutes;
		if (planned.coveredDays === 0) capacityCoverageMissingTeacherCount += 1;
		else if (planned.coveredDays < daysBetween(fromDay, toDay))
			capacityCoveragePartialTeacherCount += 1;
	}
	let completedMinutes = 0;
	let plannedMinutes = 0;
	let cancelledMinutes = 0;
	let lessonOccupancyNumerator = 0;
	let lessonOccupancyDenominator = 0;
	let capacityCoverageMissingLessonCount = 0;
	for (const row of lessonRows) {
		const minutes = Math.max(
			0,
			(row.endsAt.getTime() - row.startsAt.getTime()) / 60_000,
		);
		if (row.status === "completed") completedMinutes += minutes;
		if (row.status === "cancelled") cancelledMinutes += minutes;
		else plannedMinutes += minutes;
		if (row.status === "completed") {
			const capacity = valueAt(
				classHistory.get(row.classGroupId) ?? [],
				shanghaiDate(row.startsAt),
			);
			if (capacity === null) capacityCoverageMissingLessonCount += 1;
			else {
				lessonOccupancyNumerator += row.attendeeCount;
				lessonOccupancyDenominator += capacity;
			}
		}
	}
	let activeSeatCount = 0;
	let classCapacity = 0;
	let fullClassCount = 0;
	let nearFullClassCount = 0;
	for (const row of classRows) {
		activeSeatCount += row.activeSeats;
		classCapacity += row.capacity;
		if (row.activeSeats >= row.capacity) fullClassCount += 1;
		else if (row.activeSeats / row.capacity >= 0.9) nearFullClassCount += 1;
	}
	return {
		completedMinutes,
		plannedMinutes,
		cancelledMinutes,
		actualCapacityMinutes,
		plannedCapacityMinutes,
		activeSeatCount,
		classCapacity,
		fullClassCount,
		nearFullClassCount,
		eligibleClassCount: classRows.length,
		lessonOccupancyNumerator,
		lessonOccupancyDenominator,
		capacityCoverageMissingTeacherCount,
		capacityCoveragePartialTeacherCount,
		capacityCoverageMissingLessonCount,
	};
}
