import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { course } from "./catalog";
import {
	leadActivityType,
	leadImportBatchStatus,
	leadMilestoneKind,
	leadOwnerAssignmentSource,
	leadStage,
	metricFactProvenance,
} from "./enums";
import { campus, organization } from "./organization";

export const lead = pgTable(
	"lead",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		interestedCourseId: uuid("interested_course_id").references(
			() => course.id,
			{
				onDelete: "set null",
			},
		),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		providerUserId: text("provider_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		providerNameSnapshot: text("provider_name_snapshot"),
		createdCampusId: uuid("created_campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		currentCycleNumber: integer("current_cycle_number").default(1).notNull(),
		name: text("name").notNull(),
		phone: text("phone").notNull(),
		source: text("source").notNull(),
		stage: leadStage("stage").default("new").notNull(),
		nextFollowAt: timestamp("next_follow_at", { withTimezone: true }),
		note: text("note"),
		requestId: uuid("request_id"),
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
			"lead_current_cycle_positive_check",
			sql`${table.currentCycleNumber} > 0`,
		),
		index("lead_org_stage_idx").on(table.organizationId, table.stage),
		index("lead_owner_follow_idx").on(table.ownerUserId, table.nextFollowAt),
		index("lead_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
		index("lead_org_campus_created_idx").on(
			table.organizationId,
			table.campusId,
			table.createdAt,
		),
		index("lead_org_owner_created_idx").on(
			table.organizationId,
			table.ownerUserId,
			table.createdAt,
		),
		index("lead_org_provider_created_idx").on(
			table.organizationId,
			table.providerUserId,
			table.createdAt,
		),
		uniqueIndex("lead_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
	],
);

export const leadOwnerAssignmentEvent = pgTable(
	"lead_owner_assignment_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => lead.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		previousOwnerUserId: text("previous_owner_user_id").references(
			() => user.id,
			{ onDelete: "set null" },
		),
		previousOwnerNameSnapshot: text("previous_owner_name_snapshot"),
		nextOwnerUserId: text("next_owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		nextOwnerNameSnapshot: text("next_owner_name_snapshot"),
		operatorUserId: text("operator_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		source: leadOwnerAssignmentSource("source").notNull(),
		requestId: uuid("request_id"),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("lead_owner_event_org_request_uidx")
			.on(table.organizationId, table.requestId)
			.where(sql`${table.requestId} is not null`),
		index("lead_owner_event_lead_occurred_idx").on(
			table.leadId,
			table.occurredAt,
			table.id,
		),
	],
);

export const leadMilestoneEvent = pgTable(
	"lead_milestone_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => lead.id, { onDelete: "cascade" }),
		cycleNumber: integer("cycle_number").notNull(),
		kind: leadMilestoneKind("kind").notNull(),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		providerUserId: text("provider_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		providerNameSnapshot: text("provider_name_snapshot"),
		attributionUserId: text("attribution_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		attributionNameSnapshot: text("attribution_name_snapshot"),
		operatorUserId: text("operator_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id"),
		provenance: metricFactProvenance("provenance").default("native").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check("lead_milestone_cycle_positive_check", sql`${table.cycleNumber} > 0`),
		uniqueIndex("lead_milestone_cycle_kind_uidx").on(
			table.organizationId,
			table.leadId,
			table.cycleNumber,
			table.kind,
		),
		uniqueIndex("lead_milestone_cycle_outcome_uidx")
			.on(table.organizationId, table.leadId, table.cycleNumber)
			.where(sql`${table.kind} in ('lost', 'converted')`),
		index("lead_milestone_org_campus_time_idx").on(
			table.organizationId,
			table.campusId,
			table.occurredAt,
		),
		index("lead_milestone_org_attr_time_idx").on(
			table.organizationId,
			table.attributionUserId,
			table.occurredAt,
		),
		index("lead_milestone_org_provider_time_idx").on(
			table.organizationId,
			table.providerUserId,
			table.occurredAt,
		),
	],
);

export const leadActivity = pgTable(
	"lead_activity",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => lead.id, { onDelete: "cascade" }),
		type: leadActivityType("type").notNull(),
		content: text("content").notNull(),
		stage: leadStage("stage").notNull(),
		nextFollowAt: timestamp("next_follow_at", { withTimezone: true }),
		lostReason: text("lost_reason"),
		operatorUserId: text("operator_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		operatorName: text("operator_name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("lead_activity_org_lead_created_idx").on(
			table.organizationId,
			table.leadId,
			table.createdAt,
			table.id,
		),
	],
);

export const leadImportBatch = pgTable(
	"lead_import_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		// 旧批次没有输入哈希；新导入用它识别同一 requestId 的内容冲突。
		inputHash: text("input_hash"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		status: leadImportBatchStatus("status").notNull(),
		totalRows: integer("total_rows").notNull(),
		importedRows: integer("imported_rows").notNull(),
		errorRows: integer("error_rows").notNull(),
		errors: jsonb("errors").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("lead_import_batch_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("lead_import_batch_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
	],
);
