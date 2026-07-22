import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	attendance,
	enrollment,
	enrollmentLifecycleEvent,
	enrollmentPurchaseCycle,
	enrollmentRegistration,
	enrollmentRenewal,
	lead,
	leadMilestoneEvent,
	lesson,
	lessonConsumption,
	makeupLesson,
	renewalOpportunity,
	renewalOpportunityConversion,
	teacher,
} from "../schema";
import type { CampusAccess } from "./organization";

export type BusinessMetricSalesScope = {
	organizationId: string;
	campusAccess: CampusAccess;
	consultantUserId?: string;
};

export type BusinessMetricSalesRecord = {
	convertedCycleCount: number;
	lostCycleCount: number;
	openCycleCount: number;
	createdLeadCount: number;
	contactedLeadCount: number;
	trialBookedLeadCount: number;
	convertedLeadCount: number;
	lostLeadCount: number;
	directEnrollmentCount: number;
	directEnrollmentAmountInCents: number;
	missingAttributionCount: number;
	missingMilestoneHistoryCount: number;
	immatureCohortCount: number;
};

function campusFilter(
	access: CampusAccess,
	column: typeof leadMilestoneEvent.campusId,
) {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "selected") return inArray(column, access.campusIds);
	return sql`true`;
}

export async function getBusinessMetricSalesRecord(input: {
	scope: BusinessMetricSalesScope;
	from: Date;
	to: Date;
	asOf: Date;
}): Promise<BusinessMetricSalesRecord> {
	const closedFilters = [
		eq(leadMilestoneEvent.organizationId, input.scope.organizationId),
		gte(leadMilestoneEvent.occurredAt, input.from),
		lt(leadMilestoneEvent.occurredAt, input.to),
		inArray(leadMilestoneEvent.kind, ["converted", "lost"]),
		campusFilter(input.scope.campusAccess, leadMilestoneEvent.campusId),
	];
	if (input.scope.consultantUserId) {
		closedFilters.push(
			eq(leadMilestoneEvent.attributionUserId, input.scope.consultantUserId),
		);
	}
	const [closed] = await db
		.select({
			converted: sql<number>`count(*) filter (where ${leadMilestoneEvent.kind} = 'converted')::int`,
			lost: sql<number>`count(*) filter (where ${leadMilestoneEvent.kind} = 'lost')::int`,
			missingAttribution: sql<number>`count(*) filter (where ${leadMilestoneEvent.attributionUserId} is null)::int`,
		})
		.from(leadMilestoneEvent)
		.where(and(...closedFilters));

	const cohortFilters = [
		eq(lead.organizationId, input.scope.organizationId),
		gte(lead.createdAt, input.from),
		lt(lead.createdAt, input.to),
		input.scope.campusAccess.kind === "none"
			? sql`false`
			: input.scope.campusAccess.kind === "selected"
				? inArray(lead.createdCampusId, input.scope.campusAccess.campusIds)
				: sql`true`,
	];
	if (input.scope.consultantUserId) {
		cohortFilters.push(eq(lead.providerUserId, input.scope.consultantUserId));
	}
	const milestoneExists = (
		kind: "contacted" | "trial_booked" | "converted" | "lost",
	) => sql<boolean>`exists (
		select 1 from lead_milestone_event metric_milestone
		where metric_milestone.organization_id = ${lead.organizationId}
			and metric_milestone.lead_id = ${lead.id}
			and metric_milestone.kind = ${kind}
			and metric_milestone.occurred_at >= ${lead.createdAt}
			and metric_milestone.occurred_at < least(${lead.createdAt} + interval '30 days', ${input.asOf})
	)`;
	const [cohort] = await db
		.select({
			created: sql<number>`count(*)::int`,
			contacted: sql<number>`count(*) filter (where ${milestoneExists("contacted")})::int`,
			trialBooked: sql<number>`count(*) filter (where ${milestoneExists("trial_booked")})::int`,
			converted: sql<number>`count(*) filter (where ${milestoneExists("converted")})::int`,
			lost: sql<number>`count(*) filter (where ${milestoneExists("lost")})::int`,
			immature: sql<number>`count(*) filter (where ${lead.createdAt} + interval '30 days' > ${input.asOf})::int`,
			missingHistory: sql<number>`count(*) filter (where ${lead.createdAt} < ${input.asOf} and not exists (
				select 1 from lead_milestone_event coverage_milestone
				where coverage_milestone.organization_id = ${lead.organizationId}
					and coverage_milestone.lead_id = ${lead.id}
			))::int`,
		})
		.from(lead)
		.where(and(...cohortFilters));

	const openFilters = [
		eq(lead.organizationId, input.scope.organizationId),
		inArray(lead.stage, ["new", "contacted", "trial_booked"]),
		input.scope.campusAccess.kind === "none"
			? sql`false`
			: input.scope.campusAccess.kind === "selected"
				? inArray(lead.campusId, input.scope.campusAccess.campusIds)
				: sql`true`,
	];
	if (input.scope.consultantUserId) {
		openFilters.push(eq(lead.ownerUserId, input.scope.consultantUserId));
	}
	const [open] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(lead)
		.where(and(...openFilters));

	const directFilters = [
		eq(enrollmentRegistration.organizationId, input.scope.organizationId),
		gte(enrollmentRegistration.createdAt, input.from),
		lt(enrollmentRegistration.createdAt, input.to),
		input.scope.campusAccess.kind === "none"
			? sql`false`
			: input.scope.campusAccess.kind === "selected"
				? inArray(
						enrollmentRegistration.campusId,
						input.scope.campusAccess.campusIds,
					)
				: sql`true`,
	];
	if (input.scope.consultantUserId) {
		directFilters.push(
			eq(enrollment.conversionOwnerUserId, input.scope.consultantUserId),
		);
	}
	const [direct] = await db
		.select({
			count: sql<number>`count(*)::int`,
			amountInCents: sql<number>`coalesce(sum(${enrollment.amountInCents}), 0)::int`,
		})
		.from(enrollmentRegistration)
		.innerJoin(
			enrollment,
			and(
				eq(enrollment.id, enrollmentRegistration.enrollmentId),
				eq(enrollment.organizationId, input.scope.organizationId),
			),
		)
		.where(and(...directFilters));

	return {
		convertedCycleCount: closed?.converted ?? 0,
		lostCycleCount: closed?.lost ?? 0,
		openCycleCount: open?.count ?? 0,
		createdLeadCount: cohort?.created ?? 0,
		contactedLeadCount: cohort?.contacted ?? 0,
		trialBookedLeadCount: cohort?.trialBooked ?? 0,
		convertedLeadCount: cohort?.converted ?? 0,
		lostLeadCount: cohort?.lost ?? 0,
		directEnrollmentCount: direct?.count ?? 0,
		directEnrollmentAmountInCents: direct?.amountInCents ?? 0,
		missingAttributionCount: closed?.missingAttribution ?? 0,
		missingMilestoneHistoryCount: cohort?.missingHistory ?? 0,
		immatureCohortCount: cohort?.immature ?? 0,
	};
}

export type BusinessMetricTeachingScope = {
	organizationId: string;
	campusAccess: CampusAccess;
	teacherUserId?: string;
};

function teachingCampusFilter(
	access: CampusAccess,
	column: typeof lesson.campusId,
) {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "selected") return inArray(column, access.campusIds);
	return sql`true`;
}

function lessonScopeFilters(
	input: {
		scope: BusinessMetricTeachingScope;
		from: Date;
		to: Date;
	},
	completedOnly = true,
) {
	const filters = [
		eq(lesson.organizationId, input.scope.organizationId),
		eq(teacher.organizationId, input.scope.organizationId),
		gte(lesson.startsAt, input.from),
		lt(lesson.startsAt, input.to),
		teachingCampusFilter(input.scope.campusAccess, lesson.campusId),
	];
	if (completedOnly) filters.push(eq(lesson.status, "completed" as const));
	if (input.scope.teacherUserId) {
		filters.push(eq(teacher.userId, input.scope.teacherUserId));
	}
	return filters;
}

export async function getBusinessMetricAttendanceRecord(input: {
	scope: BusinessMetricTeachingScope;
	from: Date;
	to: Date;
}) {
	const [main] = await db
		.select({
			present: sql<number>`count(*) filter (where ${attendance.status} = 'present')::int`,
			late: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
			absent: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
			leave: sql<number>`count(*) filter (where ${attendance.status} = 'leave')::int`,
		})
		.from(attendance)
		.innerJoin(lesson, eq(lesson.id, attendance.lessonId))
		.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
		.where(
			and(
				...lessonScopeFilters(input),
				sql`not exists (
					select 1 from makeup_lesson metric_makeup
					join enrollment metric_makeup_enrollment
						on metric_makeup_enrollment.id = metric_makeup.source_enrollment_id
						and metric_makeup_enrollment.organization_id = ${input.scope.organizationId}
					where metric_makeup.organization_id = ${input.scope.organizationId}
						and metric_makeup.target_lesson_id = ${lesson.id}
						and metric_makeup_enrollment.student_id = ${attendance.studentId}
				)`,
			),
		);

	const [makeup] = await db
		.select({
			fulfilled: sql<number>`count(*) filter (where ${makeupLesson.status} = 'fulfilled')::int`,
			pending: sql<number>`count(*) filter (where ${makeupLesson.status} = 'scheduled')::int`,
			needsReschedule: sql<number>`count(*) filter (where ${makeupLesson.status} = 'needs_reschedule')::int`,
		})
		.from(makeupLesson)
		.innerJoin(lesson, eq(lesson.id, makeupLesson.targetLessonId))
		.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
		.where(
			and(
				eq(makeupLesson.organizationId, input.scope.organizationId),
				...lessonScopeFilters(input, false),
			),
		);
	return {
		present: main?.present ?? 0,
		late: main?.late ?? 0,
		absent: main?.absent ?? 0,
		leave: main?.leave ?? 0,
		fulfilledMakeup: makeup?.fulfilled ?? 0,
		pendingMakeup: makeup?.pending ?? 0,
		needsRescheduleMakeup: makeup?.needsReschedule ?? 0,
	};
}

export async function getBusinessMetricConsumptionRecord(input: {
	scope: BusinessMetricTeachingScope;
	from: Date;
	to: Date;
	granularity: "day" | "week" | "month";
}) {
	const bucket =
		input.granularity === "day"
			? sql<Date>`date_trunc('day', ${lesson.startsAt} at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`
			: input.granularity === "week"
				? sql<Date>`date_trunc('week', ${lesson.startsAt} at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`
				: sql<Date>`date_trunc('month', ${lesson.startsAt} at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`;
	const rows = await db
		.select({
			bucketStart: bucket,
			value: sql<number>`count(*)::int`,
			lateCount: sql<number>`count(*) filter (where ${lessonConsumption.consumedAt} > ${lesson.endsAt} + interval '24 hours')::int`,
		})
		.from(lessonConsumption)
		.innerJoin(lesson, eq(lesson.id, lessonConsumption.lessonId))
		.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
		.where(
			and(
				eq(lessonConsumption.organizationId, input.scope.organizationId),
				...lessonScopeFilters(input),
			),
		)
		.groupBy(bucket)
		.orderBy(bucket);
	return {
		consumedLessonCount: rows.reduce((sum, row) => sum + row.value, 0),
		lateConsumptionCount: rows.reduce((sum, row) => sum + row.lateCount, 0),
		trend: rows.map((row) => ({
			bucketStart: row.bucketStart,
			value: row.value,
		})),
	};
}

const RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function getFrozenDurationMs(input: {
	triggeredAt: Date;
	evaluationAt: Date;
	events: Array<{
		kind: string;
		effectiveAt: Date;
	}>;
}) {
	let frozenAt: Date | null = null;
	let frozenMs = 0;
	for (const event of input.events) {
		if (
			event.effectiveAt <= input.triggeredAt ||
			event.effectiveAt > input.evaluationAt
		) {
			continue;
		}
		if (event.kind === "frozen" && frozenAt === null) {
			frozenAt = event.effectiveAt;
		}
		if (event.kind === "resumed" && frozenAt !== null) {
			frozenMs += event.effectiveAt.getTime() - frozenAt.getTime();
			frozenAt = null;
		}
	}
	if (frozenAt) {
		frozenMs += input.evaluationAt.getTime() - frozenAt.getTime();
	}
	return frozenMs;
}

function evaluateRenewalOpportunity(input: {
	triggeredAt: Date;
	convertedAt: Date | null;
	asOf: Date;
	events: Array<{ kind: string; effectiveAt: Date }>;
}) {
	const convertedAt =
		input.convertedAt !== null && input.convertedAt <= input.asOf
			? input.convertedAt
			: null;
	const evaluationAt = convertedAt ?? input.asOf;
	const frozenMs = getFrozenDurationMs({
		triggeredAt: input.triggeredAt,
		evaluationAt,
		events: input.events,
	});
	const effectiveMs = Math.max(
		0,
		evaluationAt.getTime() - input.triggeredAt.getTime() - frozenMs,
	);
	if (convertedAt && effectiveMs <= RENEWAL_WINDOW_MS) {
		return {
			status: "succeeded" as const,
			remainingObservationDays: null,
		};
	}
	if (effectiveMs >= RENEWAL_WINDOW_MS) {
		return {
			status: "unsucceeded" as const,
			remainingObservationDays: null,
		};
	}
	return {
		status: "immature" as const,
		remainingObservationDays: Math.ceil(
			(RENEWAL_WINDOW_MS - effectiveMs) / (24 * 60 * 60 * 1000),
		),
	};
}

export async function getBusinessMetricRenewalRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	from: Date;
	to: Date;
	asOf: Date;
}) {
	const opportunities = await db
		.select({
			id: renewalOpportunity.id,
			enrollmentId: renewalOpportunity.enrollmentId,
			triggeredAt: renewalOpportunity.triggeredAt,
			conversionId: renewalOpportunityConversion.id,
			convertedAt: renewalOpportunityConversion.convertedAt,
			renewalAmountInCents: enrollmentRenewal.amountInCents,
			renewalLessons: enrollmentRenewal.addedLessons,
		})
		.from(renewalOpportunity)
		.leftJoin(
			renewalOpportunityConversion,
			and(
				eq(renewalOpportunityConversion.opportunityId, renewalOpportunity.id),
				eq(renewalOpportunityConversion.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			enrollmentRenewal,
			and(
				eq(enrollmentRenewal.id, renewalOpportunityConversion.renewalId),
				eq(enrollmentRenewal.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(renewalOpportunity.organizationId, input.organizationId),
				gte(renewalOpportunity.triggeredAt, input.from),
				lt(renewalOpportunity.triggeredAt, input.to),
				input.campusAccess.kind === "none"
					? sql`false`
					: input.campusAccess.kind === "selected"
						? inArray(renewalOpportunity.campusId, input.campusAccess.campusIds)
						: sql`true`,
			),
		);
	const enrollmentIds = [
		...new Set(opportunities.map((row) => row.enrollmentId)),
	];
	const lifecycleEvents =
		enrollmentIds.length === 0
			? []
			: await db
					.select({
						enrollmentId: enrollmentLifecycleEvent.enrollmentId,
						kind: enrollmentLifecycleEvent.kind,
						effectiveAt: enrollmentLifecycleEvent.effectiveAt,
					})
					.from(enrollmentLifecycleEvent)
					.where(
						and(
							eq(enrollmentLifecycleEvent.organizationId, input.organizationId),
							inArray(enrollmentLifecycleEvent.enrollmentId, enrollmentIds),
							inArray(enrollmentLifecycleEvent.kind, ["frozen", "resumed"]),
						),
					)
					.orderBy(
						asc(enrollmentLifecycleEvent.effectiveAt),
						asc(enrollmentLifecycleEvent.id),
					);
	const eventsByEnrollment = new Map<string, typeof lifecycleEvents>();
	for (const event of lifecycleEvents) {
		const current = eventsByEnrollment.get(event.enrollmentId) ?? [];
		current.push(event);
		eventsByEnrollment.set(event.enrollmentId, current);
	}
	let succeeded = 0;
	let immature = 0;
	let renewalAmountInCents = 0;
	let renewalLessonCount = 0;
	let minimumRemainingObservationDays: number | null = null;
	for (const opportunity of opportunities) {
		const evaluation = evaluateRenewalOpportunity({
			triggeredAt: opportunity.triggeredAt,
			convertedAt:
				opportunity.conversionId === null ? null : opportunity.convertedAt,
			asOf: input.asOf,
			events: eventsByEnrollment.get(opportunity.enrollmentId) ?? [],
		});
		if (evaluation.status === "succeeded") {
			succeeded += 1;
			renewalAmountInCents += opportunity.renewalAmountInCents ?? 0;
			renewalLessonCount += opportunity.renewalLessons ?? 0;
			continue;
		}
		if (evaluation.status === "immature") {
			immature += 1;
			const remainingDays = evaluation.remainingObservationDays;
			minimumRemainingObservationDays =
				minimumRemainingObservationDays === null
					? remainingDays
					: Math.min(minimumRemainingObservationDays, remainingDays);
		}
	}

	const [coverage] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				inArray(enrollment.status, ["active", "frozen"]),
				lt(enrollment.enrolledAt, input.asOf),
				input.campusAccess.kind === "none"
					? sql`false`
					: input.campusAccess.kind === "selected"
						? inArray(
								enrollment.conversionCampusId,
								input.campusAccess.campusIds,
							)
						: sql`true`,
				sql`not exists (
					select 1 from enrollment_purchase_cycle coverage_cycle
					where coverage_cycle.organization_id = ${enrollment.organizationId}
						and coverage_cycle.enrollment_id = ${enrollment.id}
				)`,
			),
		);

	const [early] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(enrollmentPurchaseCycle)
		.where(
			and(
				eq(enrollmentPurchaseCycle.organizationId, input.organizationId),
				eq(enrollmentPurchaseCycle.source, "renewal"),
				gte(enrollmentPurchaseCycle.startedAt, input.from),
				lt(enrollmentPurchaseCycle.startedAt, input.to),
				sql`${enrollmentPurchaseCycle.sequence} > 1`,
				input.campusAccess.kind === "none"
					? sql`false`
					: input.campusAccess.kind === "selected"
						? inArray(
								enrollmentPurchaseCycle.campusId,
								input.campusAccess.campusIds,
							)
						: sql`true`,
				sql`not exists (
					select 1 from renewal_opportunity_conversion early_conversion
					where early_conversion.renewal_id = ${enrollmentPurchaseCycle.sourceRenewalId}
				)`,
				sql`not exists (
					select 1 from enrollment_purchase_cycle previous_cycle
					join renewal_opportunity previous_opportunity
						on previous_opportunity.purchase_cycle_id = previous_cycle.id
					where previous_cycle.enrollment_id = ${enrollmentPurchaseCycle.enrollmentId}
						and previous_cycle.sequence = ${enrollmentPurchaseCycle.sequence} - 1
				)`,
			),
		);
	return {
		opportunityCount: opportunities.length,
		succeededOpportunityCount: succeeded,
		unsucceededOpportunityCount: opportunities.length - succeeded - immature,
		immatureOpportunityCount: immature,
		minimumRemainingObservationDays,
		earlyRenewalCount: early?.count ?? 0,
		renewalAmountInCents,
		renewalLessonCount,
		missingPurchaseCycleCount: coverage?.count ?? 0,
	};
}

export type BusinessMetricDrilldownRecord =
	| {
			kind: "salesCycle";
			id: string;
			occurredAt: Date;
			outcome: "converted" | "lost";
			attributionLabel: string;
	  }
	| {
			kind: "attendanceLesson";
			id: string;
			occurredAt: Date;
			present: number;
			late: number;
			absent: number;
			leave: number;
	  }
	| {
			kind: "consumptionLesson";
			id: string;
			occurredAt: Date;
			consumedLessonCount: number;
			lateConsumptionCount: number;
	  }
	| {
			kind: "renewalOpportunity";
			id: string;
			occurredAt: Date;
			status: "succeeded" | "unsucceeded" | "immature";
			remainingObservationDays: number | null;
			renewalAmountInCents: number;
			renewalLessonCount: number;
	  };

type BusinessMetricDrilldownInput = {
	kind:
		| "salesCycles"
		| "attendanceLessons"
		| "consumptionLessons"
		| "renewalOpportunities";
	organizationId: string;
	campusAccess: CampusAccess;
	consultantUserId?: string;
	teacherUserId?: string;
	includeAttributionNames: boolean;
	from: Date;
	to: Date;
	asOf: Date;
	limit: number;
	cursor?: { occurredAt: Date; id: string };
};

function drilldownCursorFilter(
	occurredAt: AnyPgColumn,
	id: AnyPgColumn,
	cursor: BusinessMetricDrilldownInput["cursor"],
) {
	return cursor
		? sql`(${occurredAt}, ${id}) < (${cursor.occurredAt}, ${cursor.id})`
		: sql`true`;
}

function drilldownCampusFilter(access: CampusAccess, campusId: AnyPgColumn) {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "selected") return inArray(campusId, access.campusIds);
	return sql`true`;
}

export async function getBusinessMetricDrilldownRecords(
	input: BusinessMetricDrilldownInput,
): Promise<{
	items: BusinessMetricDrilldownRecord[];
	nextCursor: { occurredAt: Date; id: string } | null;
}> {
	const pageSize = input.limit + 1;
	let items: BusinessMetricDrilldownRecord[];

	if (input.kind === "salesCycles") {
		const rows = await db
			.select({
				id: leadMilestoneEvent.id,
				occurredAt: leadMilestoneEvent.occurredAt,
				outcome: leadMilestoneEvent.kind,
				attributionName: leadMilestoneEvent.attributionNameSnapshot,
			})
			.from(leadMilestoneEvent)
			.where(
				and(
					eq(leadMilestoneEvent.organizationId, input.organizationId),
					gte(leadMilestoneEvent.occurredAt, input.from),
					lt(leadMilestoneEvent.occurredAt, input.to),
					inArray(leadMilestoneEvent.kind, ["converted", "lost"]),
					drilldownCampusFilter(
						input.campusAccess,
						leadMilestoneEvent.campusId,
					),
					input.consultantUserId
						? eq(leadMilestoneEvent.attributionUserId, input.consultantUserId)
						: sql`true`,
					drilldownCursorFilter(
						leadMilestoneEvent.occurredAt,
						leadMilestoneEvent.id,
						input.cursor,
					),
				),
			)
			.orderBy(desc(leadMilestoneEvent.occurredAt), desc(leadMilestoneEvent.id))
			.limit(pageSize);
		items = rows.map((row) => ({
			kind: "salesCycle",
			id: row.id,
			occurredAt: row.occurredAt,
			outcome: row.outcome === "converted" ? "converted" : "lost",
			attributionLabel: input.includeAttributionNames
				? (row.attributionName ?? "未分配")
				: "本人",
		}));
	} else if (input.kind === "attendanceLessons") {
		const rows = await db
			.select({
				id: lesson.id,
				occurredAt: lesson.startsAt,
				present: sql<number>`count(*) filter (where ${attendance.status} = 'present')::int`,
				late: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
				absent: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
				leave: sql<number>`count(*) filter (where ${attendance.status} = 'leave')::int`,
			})
			.from(attendance)
			.innerJoin(lesson, eq(lesson.id, attendance.lessonId))
			.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
			.where(
				and(
					eq(lesson.organizationId, input.organizationId),
					eq(teacher.organizationId, input.organizationId),
					eq(lesson.status, "completed"),
					gte(lesson.startsAt, input.from),
					lt(lesson.startsAt, input.to),
					drilldownCampusFilter(input.campusAccess, lesson.campusId),
					input.teacherUserId
						? eq(teacher.userId, input.teacherUserId)
						: sql`true`,
					drilldownCursorFilter(lesson.startsAt, lesson.id, input.cursor),
					sql`not exists (
						select 1 from makeup_lesson drill_makeup
						join enrollment drill_enrollment
							on drill_enrollment.id = drill_makeup.source_enrollment_id
							and drill_enrollment.organization_id = ${input.organizationId}
						where drill_makeup.organization_id = ${input.organizationId}
							and drill_makeup.target_lesson_id = ${lesson.id}
							and drill_enrollment.student_id = ${attendance.studentId}
					)`,
				),
			)
			.groupBy(lesson.id, lesson.startsAt)
			.orderBy(desc(lesson.startsAt), desc(lesson.id))
			.limit(pageSize);
		items = rows.map((row) => ({
			kind: "attendanceLesson",
			...row,
		}));
	} else if (input.kind === "consumptionLessons") {
		const rows = await db
			.select({
				id: lesson.id,
				occurredAt: lesson.startsAt,
				consumedLessonCount: sql<number>`count(*)::int`,
				lateConsumptionCount: sql<number>`count(*) filter (where ${lessonConsumption.consumedAt} > ${lesson.endsAt} + interval '24 hours')::int`,
			})
			.from(lessonConsumption)
			.innerJoin(lesson, eq(lesson.id, lessonConsumption.lessonId))
			.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
			.where(
				and(
					eq(lessonConsumption.organizationId, input.organizationId),
					eq(lesson.organizationId, input.organizationId),
					eq(teacher.organizationId, input.organizationId),
					eq(lesson.status, "completed"),
					gte(lesson.startsAt, input.from),
					lt(lesson.startsAt, input.to),
					drilldownCampusFilter(input.campusAccess, lesson.campusId),
					input.teacherUserId
						? eq(teacher.userId, input.teacherUserId)
						: sql`true`,
					drilldownCursorFilter(lesson.startsAt, lesson.id, input.cursor),
				),
			)
			.groupBy(lesson.id, lesson.startsAt)
			.orderBy(desc(lesson.startsAt), desc(lesson.id))
			.limit(pageSize);
		items = rows.map((row) => ({
			kind: "consumptionLesson",
			...row,
		}));
	} else {
		const rows = await db
			.select({
				id: renewalOpportunity.id,
				enrollmentId: renewalOpportunity.enrollmentId,
				occurredAt: renewalOpportunity.triggeredAt,
				conversionId: renewalOpportunityConversion.id,
				convertedAt: renewalOpportunityConversion.convertedAt,
				renewalAmountInCents: enrollmentRenewal.amountInCents,
				renewalLessonCount: enrollmentRenewal.addedLessons,
			})
			.from(renewalOpportunity)
			.leftJoin(
				renewalOpportunityConversion,
				and(
					eq(renewalOpportunityConversion.opportunityId, renewalOpportunity.id),
					eq(renewalOpportunityConversion.organizationId, input.organizationId),
				),
			)
			.leftJoin(
				enrollmentRenewal,
				and(
					eq(enrollmentRenewal.id, renewalOpportunityConversion.renewalId),
					eq(enrollmentRenewal.organizationId, input.organizationId),
				),
			)
			.where(
				and(
					eq(renewalOpportunity.organizationId, input.organizationId),
					gte(renewalOpportunity.triggeredAt, input.from),
					lt(renewalOpportunity.triggeredAt, input.to),
					drilldownCampusFilter(
						input.campusAccess,
						renewalOpportunity.campusId,
					),
					drilldownCursorFilter(
						renewalOpportunity.triggeredAt,
						renewalOpportunity.id,
						input.cursor,
					),
				),
			)
			.orderBy(
				desc(renewalOpportunity.triggeredAt),
				desc(renewalOpportunity.id),
			)
			.limit(pageSize);
		const enrollmentIds = [...new Set(rows.map((row) => row.enrollmentId))];
		const lifecycleEvents =
			enrollmentIds.length === 0
				? []
				: await db
						.select({
							enrollmentId: enrollmentLifecycleEvent.enrollmentId,
							kind: enrollmentLifecycleEvent.kind,
							effectiveAt: enrollmentLifecycleEvent.effectiveAt,
						})
						.from(enrollmentLifecycleEvent)
						.where(
							and(
								eq(
									enrollmentLifecycleEvent.organizationId,
									input.organizationId,
								),
								inArray(enrollmentLifecycleEvent.enrollmentId, enrollmentIds),
								inArray(enrollmentLifecycleEvent.kind, ["frozen", "resumed"]),
							),
						)
						.orderBy(
							asc(enrollmentLifecycleEvent.effectiveAt),
							asc(enrollmentLifecycleEvent.id),
						);
		const eventsByEnrollment = new Map<string, typeof lifecycleEvents>();
		for (const event of lifecycleEvents) {
			const current = eventsByEnrollment.get(event.enrollmentId) ?? [];
			current.push(event);
			eventsByEnrollment.set(event.enrollmentId, current);
		}
		items = rows.map((row) => {
			const evaluation = evaluateRenewalOpportunity({
				triggeredAt: row.occurredAt,
				convertedAt: row.conversionId === null ? null : row.convertedAt,
				asOf: input.asOf,
				events: eventsByEnrollment.get(row.enrollmentId) ?? [],
			});
			return {
				kind: "renewalOpportunity" as const,
				id: row.id,
				occurredAt: row.occurredAt,
				status: evaluation.status,
				remainingObservationDays: evaluation.remainingObservationDays,
				renewalAmountInCents:
					evaluation.status === "succeeded"
						? (row.renewalAmountInCents ?? 0)
						: 0,
				renewalLessonCount:
					evaluation.status === "succeeded" ? (row.renewalLessonCount ?? 0) : 0,
			};
		});
	}

	const hasNextPage = items.length > input.limit;
	const pageItems = hasNextPage ? items.slice(0, input.limit) : items;
	const lastItem = pageItems.at(-1);
	return {
		items: pageItems,
		nextCursor:
			hasNextPage && lastItem
				? { occurredAt: lastItem.occurredAt, id: lastItem.id }
				: null,
	};
}
