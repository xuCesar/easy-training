import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { course } from "./catalog";
import { enrollment } from "./enrollments";
import {
	arrearsEventType,
	arrearsStatus,
	invoiceBusinessActivityType,
	invoiceMetricCampusAttributionKind,
	invoiceMetricCourseAttributionKind,
	invoiceMetricProvenance,
	invoiceMetricSource,
	invoiceSource,
	invoiceStatus,
	paymentMethod,
	receiptStatus,
	refundRequestAction,
	refundRequestStatus,
} from "./enums";
import { campus, organization } from "./organization";
import { student } from "./students";

export const invoice = pgTable(
	"invoice",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		enrollmentId: uuid("enrollment_id").references(() => enrollment.id, {
			onDelete: "set null",
		}),
		source: invoiceSource("source").default("enrollment").notNull(),
		businessActivityType: invoiceBusinessActivityType("business_activity_type")
			.default("course_enrollment")
			.notNull(),
		summary: text("summary").default("课程报名费用").notNull(),
		amountInCents: integer("amount_in_cents").notNull(),
		paidAmountInCents: integer("paid_amount_in_cents").default(0).notNull(),
		status: invoiceStatus("status").default("pending").notNull(),
		dueDate: date("due_date").notNull(),
		issuedAt: timestamp("issued_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		paidAt: timestamp("paid_at", { withTimezone: true }),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdByName: text("created_by_name"),
		version: integer("version").default(1).notNull(),
	},
	(table) => [
		check("invoice_version_positive_check", sql`${table.version} > 0`),
		uniqueIndex("invoice_org_id_uidx").on(table.organizationId, table.id),
		index("invoice_org_status_due_idx").on(
			table.organizationId,
			table.status,
			table.dueDate,
		),
		index("invoice_student_idx").on(table.studentId),
	],
);

/**
 * 财务分析读取的账单发生时归属事实。该事实只在开单事务中创建，后续
 * 学员转校、课程更名或账单投影更新均不得改写它。
 */

export const invoiceMetricFact = pgTable(
	"invoice_metric_fact",
	{
		invoiceId: uuid("invoice_id").primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id"),
		campusAttributionKind: invoiceMetricCampusAttributionKind(
			"campus_attribution_kind",
		).notNull(),
		campusNameSnapshot: text("campus_name_snapshot"),
		courseId: uuid("course_id"),
		courseAttributionKind: invoiceMetricCourseAttributionKind(
			"course_attribution_kind",
		).notNull(),
		courseNameSnapshot: text("course_name_snapshot"),
		source: invoiceMetricSource("source").notNull(),
		provenance: invoiceMetricProvenance("provenance").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.organizationId, table.invoiceId],
			foreignColumns: [invoice.organizationId, invoice.id],
			name: "invoice_metric_fact_org_invoice_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId, table.campusId],
			foreignColumns: [campus.organizationId, campus.id],
			name: "invoice_metric_fact_org_campus_fk",
		}),
		foreignKey({
			columns: [table.organizationId, table.courseId],
			foreignColumns: [course.organizationId, course.id],
			name: "invoice_metric_fact_org_course_fk",
		}),
		check(
			"invoice_metric_fact_campus_attribution_check",
			sql`
				(${table.campusAttributionKind} = 'linked'
					and ${table.campusId} is not null)
				or (${table.campusAttributionKind} = 'unknown'
					and ${table.campusId} is null
					and ${table.campusNameSnapshot} is null)
			`,
		),
		check(
			"invoice_metric_fact_course_attribution_check",
			sql`
				(${table.courseAttributionKind} = 'linked'
					and ${table.courseId} is not null)
				or (${table.courseAttributionKind} in ('not_applicable', 'unknown')
					and ${table.courseId} is null
					and ${table.courseNameSnapshot} is null)
			`,
		),
		check(
			"invoice_metric_fact_native_attribution_check",
			sql`
				${table.provenance} <> 'native'
				or (${table.campusAttributionKind} = 'linked'
					and ${table.campusNameSnapshot} is not null
					and (
						${table.courseAttributionKind} = 'not_applicable'
						or ${table.courseNameSnapshot} is not null
					)
					and ${table.courseAttributionKind} in ('linked', 'not_applicable'))
			`,
		),
		uniqueIndex("invoice_metric_fact_org_invoice_uidx").on(
			table.organizationId,
			table.invoiceId,
		),
		index("invoice_metric_fact_org_campus_occurred_idx").on(
			table.organizationId,
			table.campusId,
			table.occurredAt,
			table.invoiceId,
		),
	],
);

export const manualInvoiceCreation = pgTable(
	"manual_invoice_creation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		enrollmentId: uuid("enrollment_id").references(() => enrollment.id, {
			onDelete: "set null",
		}),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("manual_invoice_creation_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("manual_invoice_creation_org_invoice_idx").on(
			table.organizationId,
			table.invoiceId,
		),
	],
);

export const invoiceAdjustment = pgTable(
	"invoice_adjustment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		beforeVersion: integer("before_version").notNull(),
		afterVersion: integer("after_version").notNull(),
		beforeAmountInCents: integer("before_amount_in_cents").notNull(),
		afterAmountInCents: integer("after_amount_in_cents").notNull(),
		beforeDueDate: date("before_due_date").notNull(),
		afterDueDate: date("after_due_date").notNull(),
		beforeSummary: text("before_summary").notNull(),
		afterSummary: text("after_summary").notNull(),
		reason: text("reason").notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"invoice_adjustment_version_order_check",
			sql`${table.afterVersion} = ${table.beforeVersion} + 1`,
		),
		uniqueIndex("invoice_adjustment_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("invoice_adjustment_org_invoice_created_idx").on(
			table.organizationId,
			table.invoiceId,
			table.createdAt,
		),
	],
);

export const payment = pgTable(
	"payment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		amountInCents: integer("amount_in_cents").notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
		method: paymentMethod("method").notNull(),
		referenceNo: text("reference_no"),
		note: text("note"),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check("payment_amount_positive_check", sql`${table.amountInCents} > 0`),
		uniqueIndex("payment_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("payment_org_invoice_received_idx").on(
			table.organizationId,
			table.invoiceId,
			table.receivedAt,
		),
		// 财务事件下钻按发生时间稳定分页，避免先扫描整机构收款再排序。
		index("payment_org_received_id_invoice_idx").on(
			table.organizationId,
			table.receivedAt,
			table.id,
			table.invoiceId,
		),
	],
);

export const paymentReversal = pgTable(
	"payment_reversal",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		paymentId: uuid("payment_id")
			.notNull()
			.references(() => payment.id),
		amountInCents: integer("amount_in_cents").notNull(),
		reason: text("reason").notNull(),
		reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"payment_reversal_amount_positive_check",
			sql`${table.amountInCents} > 0`,
		),
		uniqueIndex("payment_reversal_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("payment_reversal_org_payment_reversed_idx").on(
			table.organizationId,
			table.paymentId,
			table.reversedAt,
			table.id,
		),
	],
);

export const receiptNumberCounter = pgTable(
	"receipt_number_counter",
	{
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		yearMonth: text("year_month").notNull(),
		lastSequence: integer("last_sequence").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.yearMonth] }),
		check(
			"receipt_number_counter_sequence_positive_check",
			sql`${table.lastSequence} > 0`,
		),
		check(
			"receipt_number_counter_year_month_check",
			sql`${table.yearMonth} ~ '^[0-9]{6}$'`,
		),
	],
);

export const receiptDocument = pgTable(
	"receipt_document",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		number: text("number").notNull(),
		yearMonth: text("year_month").notNull(),
		sequence: integer("sequence").notNull(),
		status: receiptStatus("status").default("active").notNull(),
		generationRequestId: uuid("generation_request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		snapshotVersion: integer("snapshot_version").default(1).notNull(),
		organizationName: text("organization_name").notNull(),
		campusName: text("campus_name").notNull(),
		studentId: uuid("student_id")
			.notNull()
			.references(() => student.id),
		studentName: text("student_name").notNull(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		invoiceSummary: text("invoice_summary").notNull(),
		invoiceAmountInCents: integer("invoice_amount_in_cents").notNull(),
		title: text("title").notNull(),
		note: text("note"),
		replacesReceiptId: uuid("replaces_receipt_id").references(
			(): AnyPgColumn => receiptDocument.id,
		),
		generatedByUserId: text("generated_by_user_id")
			.notNull()
			.references(() => user.id),
		generatedByName: text("generated_by_name").notNull(),
		generatedAt: timestamp("generated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		voidReason: text("void_reason"),
		voidedByUserId: text("voided_by_user_id").references(() => user.id),
		voidedByName: text("voided_by_name"),
		voidedAt: timestamp("voided_at", { withTimezone: true }),
		voidRequestId: uuid("void_request_id"),
	},
	(table) => [
		check(
			"receipt_document_sequence_positive_check",
			sql`${table.sequence} > 0`,
		),
		check(
			"receipt_document_snapshot_version_positive_check",
			sql`${table.snapshotVersion} > 0`,
		),
		check(
			"receipt_document_void_state_check",
			sql`(${table.status} = 'active' AND ${table.voidReason} IS NULL AND ${table.voidedByUserId} IS NULL AND ${table.voidedByName} IS NULL AND ${table.voidedAt} IS NULL AND ${table.voidRequestId} IS NULL) OR (${table.status} = 'voided' AND ${table.voidReason} IS NOT NULL AND ${table.voidedByUserId} IS NOT NULL AND ${table.voidedByName} IS NOT NULL AND ${table.voidedAt} IS NOT NULL AND ${table.voidRequestId} IS NOT NULL)`,
		),
		uniqueIndex("receipt_document_org_number_uidx").on(
			table.organizationId,
			table.number,
		),
		uniqueIndex("receipt_document_org_month_sequence_uidx").on(
			table.organizationId,
			table.yearMonth,
			table.sequence,
		),
		uniqueIndex("receipt_document_org_generation_request_uidx").on(
			table.organizationId,
			table.generationRequestId,
		),
		uniqueIndex("receipt_document_org_void_request_uidx")
			.on(table.organizationId, table.voidRequestId)
			.where(sql`${table.voidRequestId} IS NOT NULL`),
		index("receipt_document_org_invoice_generated_idx").on(
			table.organizationId,
			table.invoiceId,
			table.generatedAt,
		),
	],
);

export const receiptDocumentPayment = pgTable(
	"receipt_document_payment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		receiptId: uuid("receipt_id")
			.notNull()
			.references(() => receiptDocument.id, { onDelete: "cascade" }),
		paymentId: uuid("payment_id")
			.notNull()
			.references(() => payment.id),
		amountInCents: integer("amount_in_cents").notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
		method: paymentMethod("method").notNull(),
		referenceNo: text("reference_no"),
		isActive: boolean("is_active").default(true).notNull(),
	},
	(table) => [
		check(
			"receipt_document_payment_amount_positive_check",
			sql`${table.amountInCents} > 0`,
		),
		uniqueIndex("receipt_document_payment_receipt_payment_uidx").on(
			table.receiptId,
			table.paymentId,
		),
		uniqueIndex("receipt_document_payment_org_payment_active_uidx")
			.on(table.organizationId, table.paymentId)
			.where(sql`${table.isActive} = true`),
		index("receipt_document_payment_org_receipt_idx").on(
			table.organizationId,
			table.receiptId,
		),
	],
);

export const refund = pgTable(
	"refund",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		amountInCents: integer("amount_in_cents").notNull(),
		refundedAt: timestamp("refunded_at", { withTimezone: true }).notNull(),
		method: paymentMethod("method").notNull(),
		reason: text("reason").notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check("refund_amount_positive_check", sql`${table.amountInCents} > 0`),
		uniqueIndex("refund_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("refund_org_invoice_refunded_idx").on(
			table.organizationId,
			table.invoiceId,
			table.refundedAt,
		),
	],
);

export const refundRequest = pgTable(
	"refund_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		amountInCents: integer("amount_in_cents").notNull(),
		refundedAt: timestamp("refunded_at", { withTimezone: true }).notNull(),
		method: paymentMethod("method").notNull(),
		reason: text("reason").notNull(),
		applicantUserId: text("applicant_user_id")
			.notNull()
			.references(() => user.id),
		applicantName: text("applicant_name").notNull(),
		status: refundRequestStatus("status").default("pending").notNull(),
		version: integer("version").default(1).notNull(),
		refundId: uuid("refund_id").references(() => refund.id),
		submissionRequestId: uuid("submission_request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"refund_request_amount_positive_check",
			sql`${table.amountInCents} > 0`,
		),
		check("refund_request_version_positive_check", sql`${table.version} > 0`),
		uniqueIndex("refund_request_org_submission_request_uidx").on(
			table.organizationId,
			table.submissionRequestId,
		),
		uniqueIndex("refund_request_org_refund_uidx").on(
			table.organizationId,
			table.refundId,
		),
		uniqueIndex("refund_request_org_invoice_pending_uidx")
			.on(table.organizationId, table.invoiceId)
			.where(sql`${table.status} = 'pending'`),
		index("refund_request_org_invoice_created_idx").on(
			table.organizationId,
			table.invoiceId,
			table.createdAt,
		),
	],
);

export const refundRequestEvent = pgTable(
	"refund_request_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		refundRequestId: uuid("refund_request_id")
			.notNull()
			.references(() => refundRequest.id),
		action: refundRequestAction("action").notNull(),
		fromStatus: refundRequestStatus("from_status"),
		toStatus: refundRequestStatus("to_status").notNull(),
		comment: text("comment"),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		requestId: uuid("request_id").notNull(),
		inputHash: text("input_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("refund_request_event_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("refund_request_event_org_refund_request_created_idx").on(
			table.organizationId,
			table.refundRequestId,
			table.createdAt,
		),
	],
);

export const invoiceFollowUp = pgTable(
	"invoice_follow_up",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id),
		note: text("note").notNull(),
		followedUpAt: timestamp("followed_up_at", { withTimezone: true }).notNull(),
		operatorUserId: text("operator_user_id")
			.notNull()
			.references(() => user.id),
		operatorName: text("operator_name").notNull(),
		requestId: uuid("request_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("invoice_follow_up_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("invoice_follow_up_org_invoice_followed_idx").on(
			table.organizationId,
			table.invoiceId,
			table.followedUpAt,
		),
	],
);

export const invoiceArrearsCycle = pgTable(
	"invoice_arrears_cycle",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoice.id, { onDelete: "cascade" }),
		cycleNumber: integer("cycle_number").notNull(),
		status: arrearsStatus("status").default("pending").notNull(),
		version: integer("version").default(1).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		promisedPaymentDate: date("promised_payment_date"),
		resumeDate: date("resume_date"),
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
			"invoice_arrears_cycle_number_positive_check",
			sql`${table.cycleNumber} > 0`,
		),
		check(
			"invoice_arrears_cycle_version_positive_check",
			sql`${table.version} > 0`,
		),
		check(
			"invoice_arrears_cycle_resolved_state_check",
			sql`(${table.status} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
		),
		uniqueIndex("invoice_arrears_cycle_org_invoice_number_uidx").on(
			table.organizationId,
			table.invoiceId,
			table.cycleNumber,
		),
		uniqueIndex("invoice_arrears_cycle_org_invoice_open_uidx")
			.on(table.organizationId, table.invoiceId)
			.where(sql`${table.resolvedAt} IS NULL`),
		index("invoice_arrears_cycle_org_campus_status_idx").on(
			table.organizationId,
			table.campusId,
			table.status,
			table.updatedAt,
		),
	],
);

export const invoiceArrearsEvent = pgTable(
	"invoice_arrears_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cycleId: uuid("cycle_id")
			.notNull()
			.references(() => invoiceArrearsCycle.id, { onDelete: "cascade" }),
		eventType: arrearsEventType("event_type").notNull(),
		fromStatus: arrearsStatus("from_status"),
		toStatus: arrearsStatus("to_status"),
		promisedPaymentDate: date("promised_payment_date"),
		resumeDate: date("resume_date"),
		reason: text("reason"),
		note: text("note"),
		operatorUserId: text("operator_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		operatorName: text("operator_name"),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id"),
		requestId: uuid("request_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("invoice_arrears_event_org_request_uidx")
			.on(table.organizationId, table.requestId)
			.where(sql`${table.requestId} IS NOT NULL`),
		uniqueIndex("invoice_arrears_event_org_source_uidx")
			.on(
				table.organizationId,
				table.sourceType,
				table.sourceId,
				table.eventType,
			)
			.where(sql`${table.sourceId} IS NOT NULL`),
		index("invoice_arrears_event_org_cycle_created_idx").on(
			table.organizationId,
			table.cycleId,
			table.createdAt,
		),
	],
);
