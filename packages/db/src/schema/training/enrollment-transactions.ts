import {
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
import { course } from "./catalog";
import { classGroup } from "./classes";
import { enrollment } from "./enrollments";
import { invoice } from "./finance";
import { campus, organization } from "./organization";
import { student } from "./students";

export const enrollmentRegistration = pgTable(
	"enrollment_registration",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		classGroupId: uuid("class_group_id").references(() => classGroup.id, {
			onDelete: "set null",
		}),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		source: text("source"),
		providerUserId: text("provider_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		providerNameSnapshot: text("provider_name_snapshot"),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enrollment_registration_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("enrollment_registration_org_student_idx").on(
			table.organizationId,
			table.studentId,
			table.createdAt,
		),
	],
);

export const enrollmentRenewal = pgTable(
	"enrollment_renewal",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enrollmentId: uuid("enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		addedLessons: integer("added_lessons").notNull(),
		amountInCents: integer("amount_in_cents").notNull(),
		dueDate: date("due_date").notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enrollment_renewal_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("enrollment_renewal_org_enrollment_idx").on(
			table.organizationId,
			table.enrollmentId,
		),
	],
);

export const enrollmentTransfer = pgTable(
	"enrollment_transfer",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sourceEnrollmentId: uuid("source_enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		targetEnrollmentId: uuid("target_enrollment_id")
			.notNull()
			.references(() => enrollment.id),
		targetCourseId: uuid("target_course_id")
			.notNull()
			.references(() => course.id),
		transferredLessons: integer("transferred_lessons").notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enrollment_transfer_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		uniqueIndex("enrollment_transfer_source_uidx").on(table.sourceEnrollmentId),
		index("enrollment_transfer_org_target_idx").on(
			table.organizationId,
			table.targetEnrollmentId,
		),
	],
);
