import { sql } from "drizzle-orm";
import {
	boolean,
	date,
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
import {
	studentBulkOperationKind,
	studentOwnerAssignmentSource,
	studentStatus,
} from "./enums";
import { campus, organization } from "./organization";

export const student = pgTable(
	"student",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		guardianName: text("guardian_name").notNull(),
		guardianPhone: text("guardian_phone").notNull(),
		guardianPhoneNormalized: text("guardian_phone_normalized")
			.default("")
			.notNull(),
		birthDate: date("birth_date"),
		status: studentStatus("status").default("trial").notNull(),
		version: integer("version").default(1).notNull(),
		mergedIntoStudentId: uuid("merged_into_student_id"),
		mergedAt: timestamp("merged_at", { withTimezone: true }),
		anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("student_org_idx").on(table.organizationId),
		index("student_campus_idx").on(table.campusId),
		index("student_org_campus_owner_idx").on(
			table.organizationId,
			table.campusId,
			table.ownerUserId,
		),
		index("student_org_guardian_phone_idx").on(
			table.organizationId,
			table.guardianPhone,
		),
		index("student_org_guardian_phone_normalized_idx").on(
			table.organizationId,
			table.guardianPhoneNormalized,
		),
		index("student_merged_into_idx").on(table.mergedIntoStudentId),
	],
);

export const studentOwnerAssignmentEvent = pgTable(
	"student_owner_assignment_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		beforeOwnerUserId: text("before_owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		afterOwnerUserId: text("after_owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		operatorUserId: text("operator_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		source: studentOwnerAssignmentSource("source").notNull(),
		batchId: uuid("batch_id"),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("student_owner_event_org_student_occurred_idx").on(
			table.organizationId,
			table.studentId,
			table.occurredAt,
			table.id,
		),
		index("student_owner_event_batch_idx").on(table.batchId),
	],
);

export const studentImportBatch = pgTable(
	"student_import_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		totalRows: integer("total_rows").notNull(),
		importedRows: integer("imported_rows").notNull(),
		errorRows: integer("error_rows").notNull(),
		errors: jsonb("errors").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("student_import_batch_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("student_import_batch_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
	],
);

export const studentBulkOperationBatch = pgTable(
	"student_bulk_operation_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		kind: studentBulkOperationKind("kind").notNull(),
		targetCount: integer("target_count").notNull(),
		changedCount: integer("changed_count").notNull(),
		unchangedCount: integer("unchanged_count").notNull(),
		targetIds: uuid("target_ids").array().notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("student_bulk_operation_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("student_bulk_operation_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
	],
);

export const studentStatusEvent = pgTable(
	"student_status_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		beforeStatus: studentStatus("before_status").notNull(),
		afterStatus: studentStatus("after_status").notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("student_status_event_org_student_occurred_idx").on(
			table.organizationId,
			table.studentId,
			table.occurredAt,
			table.id,
		),
	],
);

export const studentContact = pgTable(
	"student_contact",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		phone: text("phone").notNull(),
		phoneNormalized: text("phone_normalized").default("").notNull(),
		relationship: text("relationship"),
		isPrimary: boolean("is_primary").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("student_contact_primary_uidx")
			.on(table.studentId)
			.where(sql`${table.isPrimary} = true`),
		index("student_contact_student_idx").on(table.studentId),
		index("student_contact_student_phone_idx").on(
			table.studentId,
			table.phoneNormalized,
		),
		index("student_contact_phone_normalized_idx").on(table.phoneNormalized),
	],
);

export const studentTag = pgTable(
	"student_tag",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		nameNormalized: text("name_normalized").notNull(),
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
		uniqueIndex("student_tag_org_name_normalized_uidx").on(
			table.organizationId,
			table.nameNormalized,
		),
		index("student_tag_org_active_name_idx").on(
			table.organizationId,
			table.isActive,
			table.name,
		),
	],
);

export const studentTagAssignment = pgTable(
	"student_tag_assignment",
	{
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id, { onDelete: "cascade" }),
		studentTagId: uuid("student_tag_id")
			.notNull()
			.references(() => studentTag.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("student_tag_assignment_uidx").on(
			table.studentId,
			table.studentTagId,
		),
		index("student_tag_assignment_tag_idx").on(table.studentTagId),
	],
);

export const studentMerge = pgTable(
	"student_merge",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sourceStudentId: uuid("source_student_id")
			.notNull()
			.references(() => student.id),
		targetStudentId: uuid("target_student_id")
			.notNull()
			.references(() => student.id),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		selection: jsonb("selection").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("student_merge_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		uniqueIndex("student_merge_source_uidx").on(table.sourceStudentId),
		index("student_merge_org_target_idx").on(
			table.organizationId,
			table.targetStudentId,
		),
	],
);
