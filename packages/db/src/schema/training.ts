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
	"lead_imported",
	"lead_exported",
	"notification_read",
	"notifications_marked_read",
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
export const attendanceStatus = pgEnum("attendance_status", [
	"present",
	"absent",
	"late",
	"leave",
]);
export const enrollmentStatus = pgEnum("enrollment_status", [
	"active",
	"transferred",
]);
export const invoiceStatus = pgEnum("invoice_status", [
	"paid",
	"pending",
	"partial",
	"overdue",
	"refunded",
]);
export const paymentMethod = pgEnum("payment_method", [
	"cash",
	"wechat",
	"alipay",
	"bank_transfer",
	"pos",
	"other",
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
	(table) => [index("teacher_org_idx").on(table.organizationId)],
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
		birthDate: date("birth_date"),
		status: studentStatus("status").default("trial").notNull(),
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
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		status: lessonStatus("status").default("scheduled").notNull(),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelledByUserId: text("cancelled_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		cancellationReason: text("cancellation_reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
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
		amountInCents: integer("amount_in_cents").notNull(),
		paidAmountInCents: integer("paid_amount_in_cents").default(0).notNull(),
		status: invoiceStatus("status").default("pending").notNull(),
		dueDate: date("due_date").notNull(),
		issuedAt: timestamp("issued_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		paidAt: timestamp("paid_at", { withTimezone: true }),
	},
	(table) => [
		index("invoice_org_status_due_idx").on(
			table.organizationId,
			table.status,
			table.dueDate,
		),
		index("invoice_student_idx").on(table.studentId),
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
	refunds: many(refund),
	followUps: many(invoiceFollowUp),
}));

export const paymentRelations = relations(payment, ({ one }) => ({
	invoice: one(invoice, {
		fields: [payment.invoiceId],
		references: [invoice.id],
	}),
}));

export const refundRelations = relations(refund, ({ one }) => ({
	invoice: one(invoice, {
		fields: [refund.invoiceId],
		references: [invoice.id],
	}),
}));

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
	enrollments: many(enrollment),
}));

export const enrollmentRelations = relations(enrollment, ({ many }) => ({
	lessonConsumptions: many(lessonConsumption),
	renewals: many(enrollmentRenewal),
}));

export const lessonRelations = relations(lesson, ({ many }) => ({
	attendances: many(attendance),
	consumptions: many(lessonConsumption),
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
