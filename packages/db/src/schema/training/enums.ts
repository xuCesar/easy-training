import { pgEnum } from "drizzle-orm/pg-core";

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
	"arrears_status_changed",
	"receipt_generated",
	"receipt_voided",
	"receipt_reissued",
	"operation_task_created",
	"operation_task_updated",
	"operation_task_claimed",
	"operation_task_completed",
	"operation_task_reopened",
	"operation_task_cancelled",
	"student_imported",
	"student_exported",
	"students_bulk_updated",
	"analytics_filter_saved",
	"analytics_filter_updated",
	"analytics_filter_deleted",
	"analytics_exported",
	"student_erased",
]);

export const organizationNotificationType = pgEnum(
	"organization_notification_type",
	[
		"lead_import_completed",
		"lead_import_failed",
		"invoice_follow_up",
		"operation_task_assigned",
		"operation_task_completed",
		"operation_task_reminder",
	],
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

export const leadOwnerAssignmentSource = pgEnum(
	"lead_owner_assignment_source",
	["creation", "import", "manual", "conversion"],
);

export const leadMilestoneKind = pgEnum("lead_milestone_kind", [
	"contacted",
	"trial_booked",
	"lost",
	"reopened",
	"converted",
]);

export const metricFactProvenance = pgEnum("metric_fact_provenance", [
	"native",
	"migrated",
]);

export const invoiceMetricCampusAttributionKind = pgEnum(
	"invoice_metric_campus_attribution_kind",
	["linked", "unknown"],
);

export const invoiceMetricCourseAttributionKind = pgEnum(
	"invoice_metric_course_attribution_kind",
	["linked", "not_applicable", "unknown"],
);

export const invoiceMetricProvenance = pgEnum("invoice_metric_provenance", [
	"native",
	"derived",
]);

export const invoiceMetricSource = pgEnum("invoice_metric_source", [
	"lead_conversion",
	"independent_enrollment",
	"renewal",
	"manual",
]);

export const studentStatus = pgEnum("student_status", [
	"active",
	"trial",
	"paused",
	"graduated",
	"at_risk",
]);

export const studentOwnerAssignmentSource = pgEnum(
	"student_owner_assignment_source",
	[
		"manual",
		"import",
		"lead_conversion",
		"direct_enrollment",
		"bulk",
		"merge",
		"authorization_revoked",
	],
);

export const studentBulkOperationKind = pgEnum("student_bulk_operation_kind", [
	"set_owner",
	"clear_owner",
	"add_tag",
	"remove_tag",
	"assign_class",
	"withdraw_class",
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

export const enrollmentPurchaseCycleSource = pgEnum(
	"enrollment_purchase_cycle_source",
	["initial", "renewal", "transfer"],
);

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

export const arrearsStatus = pgEnum("arrears_status", [
	"pending",
	"following_up",
	"promised",
	"paused",
	"resolved",
]);

export const arrearsEventType = pgEnum("arrears_event_type", [
	"cycle_started",
	"status_changed",
	"note_added",
	"auto_resolved",
]);

export const receiptStatus = pgEnum("receipt_status", ["active", "voided"]);

export const taskPriority = pgEnum("task_priority", ["high", "medium", "low"]);

export const operationTaskStatus = pgEnum("operation_task_status", [
	"pending",
	"completed",
	"cancelled",
]);

export const operationTaskHistoryAction = pgEnum(
	"operation_task_history_action",
	[
		"created",
		"updated",
		"claimed",
		"rescheduled",
		"reassigned",
		"completed",
		"reopened",
		"cancelled",
	],
);

export const operationTaskReminderType = pgEnum(
	"operation_task_reminder_type",
	["before_due", "due", "overdue"],
);

export const operationTaskReminderStatus = pgEnum(
	"operation_task_reminder_status",
	["pending", "leased", "delivered", "cancelled", "dead"],
);

export const taskModule = pgEnum("task_module", [
	"enrollment",
	"academic",
	"finance",
	"student_service",
]);
