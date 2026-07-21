import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const memberRole = pgEnum("member_role", [
	"owner",
	"admin",
	"campus_manager",
	"consultant",
	"teacher",
	"finance",
]);
export const campusAccessMode = pgEnum("campus_access_mode", [
	"all",
	"selected",
]);
export const organizationAuditAction = pgEnum("organization_audit_action", [
	"campus_created",
	"campus_updated",
	"campus_activated",
	"campus_deactivated",
	"invitation_created",
	"invitation_revoked",
	"invitation_claimed",
	"member_role_changed",
	"member_access_changed",
	"member_removed",
	"payment_created",
	"payment_reversed",
	"refund_created",
	"enrollment_renewed",
	"enrollment_transferred",
	"lesson_completed",
	"schedule_rule_created",
	"schedule_rule_updated",
	"schedule_rule_deactivated",
	"schedule_rule_deleted",
	"lessons_generated",
	"lessons_bulk_rescheduled",
	"lessons_bulk_cancelled",
	"teacher_binding_changed",
	"class_paused",
	"class_resumed",
	"classroom_created",
	"classroom_updated",
	"classroom_activated",
	"classroom_deactivated",
	"makeup_lesson_created",
	"makeup_lesson_cancelled",
	"makeup_lesson_needs_reschedule",
	"enrollment_created",
	"enrollment_frozen",
	"enrollment_resumed",
	"enrollment_class_transferred",
	"enrollment_class_withdrawn",
	"student_merged",
	"lead_imported",
	"lead_exported",
	"notification_read",
	"notifications_marked_read",
	"manual_invoice_created",
	"invoice_adjusted",
	"refund_request_submitted",
	"refund_request_approved",
	"refund_request_rejected",
	"refund_request_cancelled",
]);
export const organizationNotificationType = pgEnum(
	"organization_notification_type",
	["lead_import_completed", "lead_import_failed", "invoice_follow_up"],
);
export const leadImportBatchStatus = pgEnum("lead_import_batch_status", [
	"processing",
	"completed",
	"completed_with_errors",
]);
export const leadStage = pgEnum("lead_stage", [
	"new",
	"contacted",
	"trial_booked",
	"enrolled",
	"lost",
]);
export const leadActivityType = pgEnum("lead_activity_type", [
	"created",
	"updated",
	"followed_up",
	"converted",
]);
export const studentStatus = pgEnum("student_status", [
	"active",
	"trial",
	"paused",
	"graduated",
	"at_risk",
]);
export const courseCategory = pgEnum("course_category", [
	"language",
	"stem",
	"art",
	"exam",
	"sports",
]);
export const classStatus = pgEnum("class_status", [
	"recruiting",
	"running",
	"paused",
	"completed",
]);
export const lessonStatus = pgEnum("lesson_status", [
	"scheduled",
	"completed",
	"cancelled",
]);
export const lessonScheduleKind = pgEnum("lesson_schedule_kind", ["weekly"]);
export const lessonScheduleBatchKind = pgEnum("lesson_schedule_batch_kind", [
	"generate",
	"rule_sync",
	"bulk_reschedule",
	"rule_cancel_future",
]);
export const attendanceStatus = pgEnum("attendance_status", [
	"present",
	"absent",
	"late",
	"leave",
]);
export const makeupLessonStatus = pgEnum("makeup_lesson_status", [
	"scheduled",
	"fulfilled",
	"needs_reschedule",
	"cancelled",
]);
export const classStatusEventKind = pgEnum("class_status_event_kind", [
	"paused",
	"resumed",
]);
export const classPauseFutureLessonPolicy = pgEnum(
	"class_pause_future_lesson_policy",
	["keep", "cancel"],
);
export const enrollmentStatus = pgEnum("enrollment_status", [
	"active",
	"frozen",
	"transferred",
]);
export const enrollmentLifecycleKind = pgEnum("enrollment_lifecycle_kind", [
	"frozen",
	"resumed",
	"class_transferred",
	"class_withdrawn",
	"class_assigned",
]);
export const invoiceStatus = pgEnum("invoice_status", [
	"paid",
	"pending",
	"partial",
	"overdue",
	"refunded",
]);
export const invoiceSource = pgEnum("invoice_source", [
	"enrollment",
	"renewal",
	"manual",
]);
export const invoiceBusinessActivityType = pgEnum(
	"invoice_business_activity_type",
	[
		"course_enrollment",
		"course_renewal",
		"material_fee",
		"exam_fee",
		"price_difference",
		"other",
	],
);
export const paymentMethod = pgEnum("payment_method", [
	"cash",
	"wechat",
	"alipay",
	"bank_transfer",
	"pos",
	"other",
]);
export const refundRequestStatus = pgEnum("refund_request_status", [
	"pending",
	"approved",
	"rejected",
	"cancelled",
]);
export const refundRequestAction = pgEnum("refund_request_action", [
	"submitted",
	"approved",
	"rejected",
	"cancelled",
]);
export const taskPriority = pgEnum("task_priority", ["high", "medium", "low"]);
export const taskModule = pgEnum("task_module", [
	"enrollment",
	"academic",
	"finance",
	"student_service",
]);

export const organization = pgTable("organization", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const organizationMember = pgTable(
	"organization_member",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: memberRole("role").notNull(),
		campusAccessMode: campusAccessMode("campus_access_mode")
			.default("all")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_member_org_user_uidx").on(
			table.organizationId,
			table.userId,
		),
		index("organization_member_user_idx").on(table.userId),
	],
);

export const campus = pgTable(
	"campus",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		code: text("code").notNull(),
		name: text("name").notNull(),
		city: text("city").notNull(),
		address: text("address").notNull(),
		roomCount: integer("room_count").default(0).notNull(),
		capacity: integer("capacity").default(0).notNull(),
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
		uniqueIndex("campus_org_code_uidx").on(table.organizationId, table.code),
		index("campus_org_idx").on(table.organizationId),
	],
);

export const organizationMemberCampus = pgTable(
	"organization_member_campus",
	{
		organizationMemberId: uuid("organization_member_id")
			.notNull()
			.references(() => organizationMember.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("organization_member_campus_uidx").on(
			table.organizationMemberId,
			table.campusId,
		),
		index("organization_member_campus_campus_idx").on(table.campusId),
	],
);

export const organizationInvitation = pgTable(
	"organization_invitation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		emailNormalized: text("email_normalized").notNull(),
		tokenHash: text("token_hash").notNull(),
		role: memberRole("role").notNull(),
		campusAccessMode: campusAccessMode("campus_access_mode")
			.default("all")
			.notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		claimedByUserId: text("claimed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		requestId: uuid("request_id").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_invitation_token_hash_uidx").on(table.tokenHash),
		uniqueIndex("organization_invitation_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("organization_invitation_org_email_idx").on(
			table.organizationId,
			table.emailNormalized,
		),
		index("organization_invitation_org_expires_idx").on(
			table.organizationId,
			table.expiresAt,
		),
	],
);

export const organizationInvitationCampus = pgTable(
	"organization_invitation_campus",
	{
		organizationInvitationId: uuid("organization_invitation_id")
			.notNull()
			.references(() => organizationInvitation.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("organization_invitation_campus_uidx").on(
			table.organizationInvitationId,
			table.campusId,
		),
	],
);

export const organizationAuditEvent = pgTable(
	"organization_audit_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		action: organizationAuditAction("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		targetUserId: text("target_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		before: jsonb("before"),
		after: jsonb("after"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("organization_audit_event_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
		index("organization_audit_event_org_entity_idx").on(
			table.organizationId,
			table.entityType,
			table.entityId,
		),
		index("organization_audit_event_org_campus_created_idx").on(
			table.organizationId,
			table.campusId,
			table.createdAt,
			table.id,
		),
	],
);

export const organizationNotification = pgTable(
	"organization_notification",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		type: organizationNotificationType("type").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		readAt: timestamp("read_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_notification_recipient_key_uidx").on(
			table.organizationId,
			table.recipientUserId,
			table.idempotencyKey,
		),
		index("organization_notification_recipient_read_created_idx").on(
			table.organizationId,
			table.recipientUserId,
			table.readAt,
			table.createdAt,
			table.id,
		),
	],
);

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
		index("course_org_idx").on(table.organizationId),
		index("course_org_active_name_idx").on(
			table.organizationId,
			table.isActive,
			table.name,
		),
	],
);

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
		name: text("name").notNull(),
		guardianName: text("guardian_name").notNull(),
		guardianPhone: text("guardian_phone").notNull(),
		guardianPhoneNormalized: text("guardian_phone_normalized")
			.default("")
			.notNull(),
		birthDate: date("birth_date"),
		status: studentStatus("status").default("trial").notNull(),
		mergedIntoStudentId: uuid("merged_into_student_id"),
		mergedAt: timestamp("merged_at", { withTimezone: true }),
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
		uniqueIndex("lead_org_request_uidx").on(
			table.organizationId,
			table.requestId,
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
		index("invoice_org_status_due_idx").on(
			table.organizationId,
			table.status,
			table.dueDate,
		),
		index("invoice_student_idx").on(table.studentId),
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
		title: text("title").notNull(),
		module: taskModule("module").notNull(),
		priority: taskPriority("priority").default("medium").notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		relatedEntityType: text("related_entity_type"),
		relatedEntityId: text("related_entity_id"),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("operation_task_owner_due_idx").on(table.ownerUserId, table.dueAt),
	],
);

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(organizationMember),
	campuses: many(campus),
	courses: many(course),
	students: many(student),
	studentTags: many(studentTag),
	leadActivities: many(leadActivity),
}));

export const leadRelations = relations(lead, ({ many }) => ({
	activities: many(leadActivity),
}));

export const leadActivityRelations = relations(leadActivity, ({ one }) => ({
	lead: one(lead, {
		fields: [leadActivity.leadId],
		references: [lead.id],
	}),
}));

export const campusRelations = relations(campus, ({ one, many }) => ({
	organization: one(organization, {
		fields: [campus.organizationId],
		references: [organization.id],
	}),
	students: many(student),
	classes: many(classGroup),
	classrooms: many(classroom),
}));

export const classroomRelations = relations(classroom, ({ one, many }) => ({
	campus: one(campus, {
		fields: [classroom.campusId],
		references: [campus.id],
	}),
	lessons: many(lesson),
}));

export const studentRelations = relations(student, ({ one, many }) => ({
	campus: one(campus, { fields: [student.campusId], references: [campus.id] }),
	contacts: many(studentContact),
	tagAssignments: many(studentTagAssignment),
	enrollments: many(enrollment),
	attendances: many(attendance),
	lessonConsumptions: many(lessonConsumption),
	invoices: many(invoice),
}));

export const studentContactRelations = relations(studentContact, ({ one }) => ({
	student: one(student, {
		fields: [studentContact.studentId],
		references: [student.id],
	}),
}));

export const studentTagRelations = relations(studentTag, ({ one, many }) => ({
	organization: one(organization, {
		fields: [studentTag.organizationId],
		references: [organization.id],
	}),
	assignments: many(studentTagAssignment),
}));

export const studentTagAssignmentRelations = relations(
	studentTagAssignment,
	({ one }) => ({
		student: one(student, {
			fields: [studentTagAssignment.studentId],
			references: [student.id],
		}),
		tag: one(studentTag, {
			fields: [studentTagAssignment.studentTagId],
			references: [studentTag.id],
		}),
	}),
);

export const invoiceRelations = relations(invoice, ({ many }) => ({
	payments: many(payment),
	paymentReversals: many(paymentReversal),
	refunds: many(refund),
	refundRequests: many(refundRequest),
	followUps: many(invoiceFollowUp),
	manualCreations: many(manualInvoiceCreation),
	adjustments: many(invoiceAdjustment),
}));

export const manualInvoiceCreationRelations = relations(
	manualInvoiceCreation,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [manualInvoiceCreation.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const invoiceAdjustmentRelations = relations(
	invoiceAdjustment,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [invoiceAdjustment.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const paymentRelations = relations(payment, ({ one, many }) => ({
	invoice: one(invoice, {
		fields: [payment.invoiceId],
		references: [invoice.id],
	}),
	reversals: many(paymentReversal),
}));

export const paymentReversalRelations = relations(
	paymentReversal,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [paymentReversal.invoiceId],
			references: [invoice.id],
		}),
		payment: one(payment, {
			fields: [paymentReversal.paymentId],
			references: [payment.id],
		}),
	}),
);

export const refundRelations = relations(refund, ({ one }) => ({
	invoice: one(invoice, {
		fields: [refund.invoiceId],
		references: [invoice.id],
	}),
}));

export const refundRequestRelations = relations(
	refundRequest,
	({ one, many }) => ({
		invoice: one(invoice, {
			fields: [refundRequest.invoiceId],
			references: [invoice.id],
		}),
		refund: one(refund, {
			fields: [refundRequest.refundId],
			references: [refund.id],
		}),
		events: many(refundRequestEvent),
	}),
);

export const refundRequestEventRelations = relations(
	refundRequestEvent,
	({ one }) => ({
		request: one(refundRequest, {
			fields: [refundRequestEvent.refundRequestId],
			references: [refundRequest.id],
		}),
	}),
);

export const invoiceFollowUpRelations = relations(
	invoiceFollowUp,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [invoiceFollowUp.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const classGroupRelations = relations(classGroup, ({ one, many }) => ({
	campus: one(campus, {
		fields: [classGroup.campusId],
		references: [campus.id],
	}),
	course: one(course, {
		fields: [classGroup.courseId],
		references: [course.id],
	}),
	teacher: one(teacher, {
		fields: [classGroup.teacherId],
		references: [teacher.id],
	}),
	lessons: many(lesson),
	scheduleRules: many(lessonScheduleRule),
	enrollments: many(enrollment),
	statusEvents: many(classStatusEvent),
}));

export const classStatusEventRelations = relations(
	classStatusEvent,
	({ one }) => ({
		classGroup: one(classGroup, {
			fields: [classStatusEvent.classGroupId],
			references: [classGroup.id],
		}),
	}),
);

export const enrollmentRelations = relations(enrollment, ({ many }) => ({
	lessonConsumptions: many(lessonConsumption),
	renewals: many(enrollmentRenewal),
}));

export const lessonScheduleRuleRelations = relations(
	lessonScheduleRule,
	({ one, many }) => ({
		classGroup: one(classGroup, {
			fields: [lessonScheduleRule.classGroupId],
			references: [classGroup.id],
		}),
		lessons: many(lesson),
	}),
);

export const lessonRelations = relations(lesson, ({ one, many }) => ({
	classroom: one(classroom, {
		fields: [lesson.roomId],
		references: [classroom.id],
	}),
	scheduleRule: one(lessonScheduleRule, {
		fields: [lesson.scheduleRuleId],
		references: [lessonScheduleRule.id],
	}),
	attendances: many(attendance),
	consumptions: many(lessonConsumption),
	makeupSources: many(makeupLesson, { relationName: "sourceLesson" }),
	makeupTargets: many(makeupLesson, { relationName: "targetLesson" }),
}));

export const makeupLessonRelations = relations(makeupLesson, ({ one }) => ({
	sourceLesson: one(lesson, {
		fields: [makeupLesson.sourceLessonId],
		references: [lesson.id],
		relationName: "sourceLesson",
	}),
	targetLesson: one(lesson, {
		fields: [makeupLesson.targetLessonId],
		references: [lesson.id],
		relationName: "targetLesson",
	}),
	sourceEnrollment: one(enrollment, {
		fields: [makeupLesson.sourceEnrollmentId],
		references: [enrollment.id],
	}),
}));

export const lessonConsumptionRelations = relations(
	lessonConsumption,
	({ one }) => ({
		enrollment: one(enrollment, {
			fields: [lessonConsumption.enrollmentId],
			references: [enrollment.id],
		}),
		lesson: one(lesson, {
			fields: [lessonConsumption.lessonId],
			references: [lesson.id],
		}),
		consumedByUser: one(user, {
			fields: [lessonConsumption.consumedByUserId],
			references: [user.id],
		}),
	}),
);
