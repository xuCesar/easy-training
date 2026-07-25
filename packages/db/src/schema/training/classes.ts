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
import { course, teacher } from "./catalog";
import {
	classPauseFutureLessonPolicy,
	classStatus,
	classStatusEventKind,
	lessonScheduleKind,
} from "./enums";
import { campus, organization } from "./organization";

export const classGroup = pgTable(
	"class_group",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		courseId: uuid("course_id")
			.notNull()
			.references(() => course.id),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		teacherId: uuid("teacher_id")
			.notNull()
			.references(() => teacher.id),
		name: text("name").notNull(),
		status: classStatus("status").default("recruiting").notNull(),
		capacity: integer("capacity").notNull(),
		scheduleText: text("schedule_text").notNull(),
		startDate: date("start_date").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("class_group_org_idx").on(table.organizationId),
		index("class_group_org_course_status_idx").on(
			table.organizationId,
			table.courseId,
			table.status,
		),
		index("class_group_campus_status_idx").on(table.campusId, table.status),
	],
);

export const classGroupCapacityHistory = pgTable(
	"class_group_capacity_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		classGroupId: uuid("class_group_id")
			.notNull()
			.references(() => classGroup.id, { onDelete: "cascade" }),
		capacity: integer("capacity").notNull(),
		effectiveFrom: date("effective_from").notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("class_group_capacity_history_group_effective_uidx").on(
			table.classGroupId,
			table.effectiveFrom,
		),
		index("class_group_capacity_history_org_group_effective_idx").on(
			table.organizationId,
			table.classGroupId,
			table.effectiveFrom,
		),
	],
);

export const classroom = pgTable(
	"classroom",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		nameNormalized: text("name_normalized").notNull(),
		capacity: integer("capacity").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("classroom_org_campus_name_uidx").on(
			table.organizationId,
			table.campusId,
			table.nameNormalized,
		),
		index("classroom_org_campus_active_idx").on(
			table.organizationId,
			table.campusId,
			table.isActive,
		),
	],
);

export const classStatusEvent = pgTable(
	"class_status_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		classGroupId: uuid("class_group_id")
			.notNull()
			.references(() => classGroup.id, { onDelete: "cascade" }),
		kind: classStatusEventKind("kind").notNull(),
		futureLessonPolicy: classPauseFutureLessonPolicy("future_lesson_policy"),
		reason: text("reason").notNull(),
		affectedLessonIds: uuid("affected_lesson_ids")
			.array()
			.default([])
			.notNull(),
		requestId: uuid("request_id").notNull(),
		actorUserId: text("actor_user_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("class_status_event_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("class_status_event_class_created_idx").on(
			table.classGroupId,
			table.createdAt,
		),
	],
);

export const lessonScheduleRule = pgTable(
	"lesson_schedule_rule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		classGroupId: uuid("class_group_id")
			.notNull()
			.references(() => classGroup.id),
		kind: lessonScheduleKind("kind").default("weekly").notNull(),
		intervalWeeks: integer("interval_weeks").default(1).notNull(),
		weekdays: integer("weekdays").array().notNull(),
		startMinuteOfDay: integer("start_minute_of_day").notNull(),
		room: text("room").notNull(),
		roomId: uuid("room_id").references(() => classroom.id, {
			onDelete: "set null",
		}),
		timezone: text("timezone").default("Asia/Shanghai").notNull(),
		validFrom: date("valid_from").notNull(),
		validUntil: date("valid_until").notNull(),
		revision: integer("revision").default(1).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		updatedByUserId: text("updated_by_user_id")
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
		check(
			"lesson_schedule_rule_interval_check",
			sql`${table.intervalWeeks} > 0`,
		),
		check(
			"lesson_schedule_rule_start_minute_check",
			sql`${table.startMinuteOfDay} >= 0 and ${table.startMinuteOfDay} < 1440`,
		),
		check(
			"lesson_schedule_rule_date_range_check",
			sql`${table.validUntil} >= ${table.validFrom}`,
		),
		index("lesson_schedule_rule_org_class_active_idx").on(
			table.organizationId,
			table.classGroupId,
			table.isActive,
		),
	],
);
