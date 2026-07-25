import { sql } from "drizzle-orm";
import {
	boolean,
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
import { courseCategory } from "./enums";
import { campus, organization } from "./organization";

export const teacher = pgTable(
	"teacher",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		name: text("name").notNull(),
		phone: text("phone"),
		subjects: text("subjects").array().notNull(),
		weeklyCapacityHours: integer("weekly_capacity_hours").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("teacher_org_idx").on(table.organizationId),
		uniqueIndex("teacher_org_user_uidx")
			.on(table.organizationId, table.userId)
			.where(sql`${table.userId} is not null`),
	],
);

export const teacherCapacityHistory = pgTable(
	"teacher_capacity_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teacherId: uuid("teacher_id")
			.notNull()
			.references(() => teacher.id, { onDelete: "cascade" }),
		weeklyCapacityMinutes: integer("weekly_capacity_minutes").notNull(),
		effectiveFrom: date("effective_from").notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("teacher_capacity_history_teacher_effective_uidx").on(
			table.teacherId,
			table.effectiveFrom,
		),
		index("teacher_capacity_history_org_teacher_effective_idx").on(
			table.organizationId,
			table.teacherId,
			table.effectiveFrom,
		),
	],
);

export const teacherCampus = pgTable(
	"teacher_campus",
	{
		teacherId: uuid("teacher_id")
			.notNull()
			.references(() => teacher.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("teacher_campus_uidx").on(table.teacherId, table.campusId),
		index("teacher_campus_campus_teacher_idx").on(
			table.campusId,
			table.teacherId,
		),
	],
);

export const course = pgTable(
	"course",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		code: text("code").notNull(),
		name: text("name").notNull(),
		category: courseCategory("category").notNull(),
		level: text("level").notNull(),
		durationMinutes: integer("duration_minutes").notNull(),
		listPriceInCents: integer("list_price_in_cents").notNull(),
		lessonsPerPackage: integer("lessons_per_package").notNull(),
		tags: text("tags").array().notNull(),
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
		uniqueIndex("course_org_code_uidx").on(table.organizationId, table.code),
		uniqueIndex("course_org_id_uidx").on(table.organizationId, table.id),
		index("course_org_idx").on(table.organizationId),
		index("course_org_active_name_idx").on(
			table.organizationId,
			table.isActive,
			table.name,
		),
	],
);
