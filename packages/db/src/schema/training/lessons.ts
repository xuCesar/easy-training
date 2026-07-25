import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { teacher } from "./catalog";
import { classGroup, classroom, lessonScheduleRule } from "./classes";
import {
	enrollmentRegistration,
	enrollmentRenewal,
	enrollmentTransfer,
} from "./enrollment-transactions";
import { enrollment } from "./enrollments";
import {
	attendanceStatus,
	enrollmentPurchaseCycleSource,
	lessonScheduleBatchKind,
	lessonStatus,
	makeupLessonStatus,
	metricFactProvenance,
} from "./enums";
import { lead } from "./leads";
import { campus, organization } from "./organization";
import { student } from "./students";

export const lesson = pgTable(
	"lesson",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		classGroupId: uuid("class_group_id")
			.notNull()
			.references(() => classGroup.id, { onDelete: "cascade" }),
		teacherId: uuid("teacher_id")
			.notNull()
			.references(() => teacher.id),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		room: text("room").notNull(),
		roomId: uuid("room_id").references(() => classroom.id, {
			onDelete: "set null",
		}),
		scheduleRuleId: uuid("schedule_rule_id").references(
			() => lessonScheduleRule.id,
		),
		scheduleRuleRevision: integer("schedule_rule_revision"),
		scheduleOccurrenceDate: date("schedule_occurrence_date"),
		isScheduleOverride: boolean("is_schedule_override")
			.default(false)
			.notNull(),
		version: integer("version").default(1).notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		status: lessonStatus("status").default("scheduled").notNull(),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelledByUserId: text("cancelled_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		cancellationReason: text("cancellation_reason"),
		teachingSummary: text("teaching_summary"),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		completedByUserId: text("completed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("lesson_schedule_rule_occurrence_uidx")
			.on(table.scheduleRuleId, table.scheduleOccurrenceDate)
			.where(sql`${table.scheduleRuleId} is not null`),
		index("lesson_schedule_rule_starts_idx").on(
			table.scheduleRuleId,
			table.startsAt,
		),
		index("lesson_campus_starts_idx").on(table.campusId, table.startsAt),
		index("lesson_teacher_starts_idx").on(table.teacherId, table.startsAt),
		index("lesson_org_teacher_starts_idx").on(
			table.organizationId,
			table.teacherId,
			table.startsAt,
		),
		index("lesson_org_campus_room_starts_idx").on(
			table.organizationId,
			table.campusId,
			table.room,
			table.startsAt,
		),
	],
);

export const makeupLesson = pgTable(
	"makeup_lesson",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sourceLessonId: uuid("source_lesson_id")
			.notNull()
			.references(() => lesson.id),
		sourceEnrollmentId: uuid("source_enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		targetLessonId: uuid("target_lesson_id")
			.notNull()
			.references(() => lesson.id),
		status: makeupLessonStatus("status").default("scheduled").notNull(),
		requestId: uuid("request_id").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("makeup_lesson_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		uniqueIndex("makeup_lesson_source_active_uidx")
			.on(table.sourceLessonId, table.sourceEnrollmentId)
			.where(sql`${table.status} = 'scheduled'`),
		index("makeup_lesson_target_status_idx").on(
			table.targetLessonId,
			table.status,
		),
		index("makeup_lesson_org_updated_idx").on(
			table.organizationId,
			table.updatedAt,
			table.id,
		),
	],
);

export const lessonScheduleBatch = pgTable(
	"lesson_schedule_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		kind: lessonScheduleBatchKind("kind").notNull(),
		scheduleRuleId: uuid("schedule_rule_id").references(
			() => lessonScheduleRule.id,
		),
		actorUserId: text("actor_user_id")
			.notNull()
			.references(() => user.id),
		requestFingerprint: text("request_fingerprint").notNull(),
		affectedLessonIds: uuid("affected_lesson_ids").array().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("lesson_schedule_batch_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("lesson_schedule_batch_org_created_idx").on(
			table.organizationId,
			table.createdAt,
		),
	],
);

export const attendance = pgTable(
	"attendance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		lessonId: uuid("lesson_id")
			.notNull()
			.references(() => lesson.id, { onDelete: "cascade" }),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		status: attendanceStatus("status").notNull(),
		checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
		note: text("note"),
		recordedByUserId: text("recorded_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("attendance_lesson_student_uidx").on(
			table.lessonId,
			table.studentId,
		),
		index("attendance_lesson_status_idx").on(table.lessonId, table.status),
		index("attendance_student_idx").on(table.studentId),
	],
);

export const lessonConsumption = pgTable(
	"lesson_consumption",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		lessonId: uuid("lesson_id")
			.notNull()
			.references(() => lesson.id),
		attendanceStatus: attendanceStatus("attendance_status").notNull(),
		previousRemainingLessons: integer("previous_remaining_lessons").notNull(),
		remainingLessons: integer("remaining_lessons").notNull(),
		consumedByUserId: text("consumed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		consumedAt: timestamp("consumed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("lesson_consumption_enrollment_lesson_uidx").on(
			table.enrollmentId,
			table.lessonId,
		),
		index("lesson_consumption_org_lesson_idx").on(
			table.organizationId,
			table.lessonId,
		),
	],
);

export const enrollmentPurchaseCycle = pgTable(
	"enrollment_purchase_cycle",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		source: enrollmentPurchaseCycleSource("source").notNull(),
		sourceLeadId: uuid("source_lead_id").references(() => lead.id, {
			onDelete: "set null",
		}),
		sourceRegistrationId: uuid("source_registration_id").references(
			() => enrollmentRegistration.id,
			{ onDelete: "set null" },
		),
		sourceRenewalId: uuid("source_renewal_id").references(
			() => enrollmentRenewal.id,
			{ onDelete: "set null" },
		),
		sourceTransferId: uuid("source_transfer_id").references(
			() => enrollmentTransfer.id,
			{ onDelete: "set null" },
		),
		purchasedLessons: integer("purchased_lessons").notNull(),
		startingRemainingLessons: integer("starting_remaining_lessons").notNull(),
		amountInCents: integer("amount_in_cents").notNull(),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		provenance: metricFactProvenance("provenance").default("native").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check("purchase_cycle_sequence_positive_check", sql`${table.sequence} > 0`),
		check(
			"purchase_cycle_lessons_positive_check",
			sql`${table.purchasedLessons} > 0`,
		),
		check(
			"purchase_cycle_starting_remaining_check",
			sql`${table.startingRemainingLessons} >= 0`,
		),
		check("purchase_cycle_amount_check", sql`${table.amountInCents} >= 0`),
		check(
			"purchase_cycle_source_consistency_check",
			sql`
				(
					${table.source} = 'initial'
					and ${table.sourceRenewalId} is null
					and ${table.sourceTransferId} is null
					and num_nonnulls(${table.sourceLeadId}, ${table.sourceRegistrationId}) = 1
				)
				or (
					${table.source} = 'renewal'
					and ${table.sourceLeadId} is null
					and ${table.sourceRegistrationId} is null
					and ${table.sourceRenewalId} is not null
					and ${table.sourceTransferId} is null
				)
				or (
					${table.source} = 'transfer'
					and ${table.sourceLeadId} is null
					and ${table.sourceRegistrationId} is null
					and ${table.sourceRenewalId} is null
					and ${table.sourceTransferId} is not null
				)
			`,
		),
		uniqueIndex("purchase_cycle_enrollment_sequence_uidx").on(
			table.enrollmentId,
			table.sequence,
		),
		uniqueIndex("purchase_cycle_registration_uidx")
			.on(table.sourceRegistrationId)
			.where(sql`${table.sourceRegistrationId} is not null`),
		uniqueIndex("purchase_cycle_renewal_uidx")
			.on(table.sourceRenewalId)
			.where(sql`${table.sourceRenewalId} is not null`),
		uniqueIndex("purchase_cycle_transfer_uidx")
			.on(table.sourceTransferId)
			.where(sql`${table.sourceTransferId} is not null`),
		index("purchase_cycle_org_campus_started_idx").on(
			table.organizationId,
			table.campusId,
			table.startedAt,
		),
	],
);

export const renewalOpportunity = pgTable(
	"renewal_opportunity",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id, { onDelete: "cascade" }),
		purchaseCycleId: uuid("purchase_cycle_id")
			.notNull()
			.references(() => enrollmentPurchaseCycle.id, { onDelete: "cascade" }),
		triggeringLessonConsumptionId: uuid("triggering_lesson_consumption_id")
			.notNull()
			.references(() => lessonConsumption.id),
		thresholdLessons: integer("threshold_lessons").notNull(),
		remainingLessons: integer("remaining_lessons").notNull(),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		provenance: metricFactProvenance("provenance").default("native").notNull(),
		triggeredAt: timestamp("triggered_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"renewal_opportunity_threshold_positive_check",
			sql`${table.thresholdLessons} > 0`,
		),
		check(
			"renewal_opportunity_remaining_check",
			sql`${table.remainingLessons} >= 0`,
		),
		check(
			"renewal_opportunity_reached_threshold_check",
			sql`${table.remainingLessons} <= ${table.thresholdLessons}`,
		),
		uniqueIndex("renewal_opportunity_cycle_uidx").on(table.purchaseCycleId),
		uniqueIndex("renewal_opportunity_consumption_uidx").on(
			table.triggeringLessonConsumptionId,
		),
		index("renewal_opportunity_org_campus_triggered_idx").on(
			table.organizationId,
			table.campusId,
			table.triggeredAt,
		),
	],
);

export const renewalOpportunityConversion = pgTable(
	"renewal_opportunity_conversion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => renewalOpportunity.id, { onDelete: "cascade" }),
		renewalId: uuid("renewal_id")
			.notNull()
			.references(() => enrollmentRenewal.id),
		convertedAt: timestamp("converted_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("renewal_opportunity_conversion_opportunity_uidx").on(
			table.opportunityId,
		),
		uniqueIndex("renewal_opportunity_conversion_renewal_uidx").on(
			table.renewalId,
		),
		index("renewal_opportunity_conversion_org_time_idx").on(
			table.organizationId,
			table.convertedAt,
		),
	],
);
