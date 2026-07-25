import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { course } from "./catalog";
import { classGroup } from "./classes";
import { enrollmentLifecycleKind, enrollmentStatus } from "./enums";
import { lead } from "./leads";
import { campus, organization } from "./organization";
import { student, studentBulkOperationBatch } from "./students";

export const enrollment = pgTable(
	"enrollment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		leadId: uuid("lead_id").references(() => lead.id, {
			onDelete: "set null",
		}),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		conversionOwnerUserId: text("conversion_owner_user_id").references(
			() => user.id,
			{ onDelete: "set null" },
		),
		conversionOwnerNameSnapshot: text("conversion_owner_name_snapshot"),
		conversionCampusId: uuid("conversion_campus_id").references(
			() => campus.id,
			{ onDelete: "set null" },
		),
		courseId: uuid("course_id")
			.notNull()
			.references(() => course.id),
		classGroupId: uuid("class_group_id").references(() => classGroup.id, {
			onDelete: "set null",
		}),
		purchasedLessons: integer("purchased_lessons").notNull(),
		remainingLessons: integer("remaining_lessons").notNull(),
		version: integer("version").default(1).notNull(),
		amountInCents: integer("amount_in_cents").default(0).notNull(),
		paidAmountInCents: integer("paid_amount_in_cents").default(0).notNull(),
		status: enrollmentStatus("status").default("active").notNull(),
		enrolledAt: timestamp("enrolled_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enrollment_org_lead_uidx").on(
			table.organizationId,
			table.leadId,
		),
		index("enrollment_org_idx").on(table.organizationId),
		index("enrollment_student_idx").on(table.studentId),
		index("enrollment_class_idx").on(table.classGroupId),
	],
);

export const enrollmentLifecycleEvent = pgTable(
	"enrollment_lifecycle_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		kind: enrollmentLifecycleKind("kind").notNull(),
		beforeStatus: enrollmentStatus("before_status").notNull(),
		afterStatus: enrollmentStatus("after_status").notNull(),
		fromClassGroupId: uuid("from_class_group_id").references(
			() => classGroup.id,
		),
		toClassGroupId: uuid("to_class_group_id").references(() => classGroup.id),
		effectiveAt: timestamp("effective_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		reason: text("reason"),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		bulkOperationBatchId: uuid("bulk_operation_batch_id").references(
			() => studentBulkOperationBatch.id,
			{ onDelete: "set null" },
		),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enrollment_lifecycle_event_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("enrollment_lifecycle_event_enrollment_effective_idx").on(
			table.enrollmentId,
			table.effectiveAt,
			table.id,
		),
	],
);
