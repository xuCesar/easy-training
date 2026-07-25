import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import {
	operationTaskHistoryAction,
	operationTaskReminderStatus,
	operationTaskReminderType,
	operationTaskStatus,
	taskModule,
	taskPriority,
} from "./enums";
import { campus, organization } from "./organization";

export const operationTask = pgTable(
	"operation_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull(),
		description: text("description"),
		module: taskModule("module").notNull(),
		priority: taskPriority("priority").default("medium").notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		remindBeforeMinutes: integer("remind_before_minutes"),
		relatedEntityType: text("related_entity_type"),
		relatedEntityId: text("related_entity_id"),
		status: operationTaskStatus("status").default("pending").notNull(),
		version: integer("version").default(1).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		completedByUserId: text("completed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelledByUserId: text("cancelled_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("operation_task_owner_due_idx").on(table.ownerUserId, table.dueAt),
		index("operation_task_org_status_due_idx").on(
			table.organizationId,
			table.status,
			table.dueAt,
		),
		index("operation_task_org_campus_status_due_idx").on(
			table.organizationId,
			table.campusId,
			table.status,
			table.dueAt,
		),
		check("operation_task_version_positive_check", sql`${table.version} > 0`),
		check(
			"operation_task_remind_before_range_check",
			sql`${table.remindBeforeMinutes} is null or (${table.remindBeforeMinutes} >= 5 and ${table.remindBeforeMinutes} <= 10080)`,
		),
		check(
			"operation_task_related_entity_pair_check",
			sql`(${table.relatedEntityType} is null) = (${table.relatedEntityId} is null)`,
		),
	],
);

export const operationTaskHistory = pgTable(
	"operation_task_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => operationTask.id, { onDelete: "cascade" }),
		taskVersion: integer("task_version").notNull(),
		action: operationTaskHistoryAction("action").notNull(),
		fromStatus: operationTaskStatus("from_status"),
		toStatus: operationTaskStatus("to_status"),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		dueAt: timestamp("due_at", { withTimezone: true }),
		remindBeforeMinutes: integer("remind_before_minutes"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("operation_task_history_task_version_uidx").on(
			table.taskId,
			table.taskVersion,
		),
		index("operation_task_history_org_task_created_idx").on(
			table.organizationId,
			table.taskId,
			table.createdAt,
		),
		check(
			"operation_task_history_version_positive_check",
			sql`${table.taskVersion} > 0`,
		),
	],
);

export const operationTaskReminder = pgTable(
	"operation_task_reminder",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => operationTask.id, { onDelete: "cascade" }),
		taskVersion: integer("task_version").notNull(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: operationTaskReminderType("type").notNull(),
		scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
		dueAtSnapshot: timestamp("due_at_snapshot", {
			withTimezone: true,
		}).notNull(),
		status: operationTaskReminderStatus("status").default("pending").notNull(),
		availableAt: timestamp("available_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		leaseToken: uuid("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("operation_task_reminder_task_version_type_uidx").on(
			table.taskId,
			table.taskVersion,
			table.type,
		),
		index("operation_task_reminder_pending_claim_idx")
			.on(table.availableAt, table.scheduledAt, table.id)
			.where(sql`${table.status} = 'pending'`),
		index("operation_task_reminder_leased_expiry_idx")
			.on(table.leaseExpiresAt, table.id)
			.where(sql`${table.status} = 'leased'`),
		index("operation_task_reminder_task_status_idx").on(
			table.taskId,
			table.status,
		),
		check(
			"operation_task_reminder_version_positive_check",
			sql`${table.taskVersion} > 0`,
		),
		check(
			"operation_task_reminder_attempt_count_nonnegative_check",
			sql`${table.attemptCount} >= 0`,
		),
	],
);
