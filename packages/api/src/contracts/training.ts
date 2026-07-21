import { z } from "zod";

export type EntityId = string;

export const EXPECTED_ORGANIZATION_HEADER = "X-Expected-Organization-Id";

export const organizationRoleSchema = z.enum([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
	"teacher",
	"finance",
]);

export const organizationSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	role: organizationRoleSchema,
});

export const currentOrganizationSchema = organizationSummarySchema.extend({
	organizations: z.array(organizationSummarySchema).min(1),
});

export const selectOrganizationInputSchema = z.object({
	organizationId: z.uuid(),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type CurrentOrganization = z.infer<typeof currentOrganizationSchema>;
export type SelectOrganizationInput = z.infer<
	typeof selectOrganizationInputSchema
>;

export const campusAccessModeSchema = z.enum(["all", "selected"]);

const campusScopeSchema = z
	.object({
		campusAccessMode: campusAccessModeSchema,
		campusIds: z.array(z.uuid()).max(100).default([]),
	})
	.superRefine((value, context) => {
		if (value.campusAccessMode === "all" && value.campusIds.length > 0) {
			context.addIssue({
				code: "custom",
				path: ["campusIds"],
				message: "全机构访问不应配置校区范围。",
			});
		}
	});

const campusSchema = z.object({
	id: z.uuid(),
	code: z.string(),
	name: z.string(),
	city: z.string(),
	address: z.string(),
	roomCount: z.number().int().nonnegative(),
	capacity: z.number().int().nonnegative(),
	isActive: z.boolean(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});

const campusDataSchema = z.object({
	code: z.string().trim().min(1).max(30),
	name: z.string().trim().min(1).max(100),
	city: z.string().trim().min(1).max(100),
	address: z.string().trim().min(1).max(300),
	roomCount: z.number().int().min(0).max(10_000).default(0),
	capacity: z.number().int().min(0).max(1_000_000).default(0),
});

export const campusListInputSchema = z.object({
	includeInactive: z.boolean().default(true),
});
export const campusListResultSchema = z.object({
	items: z.array(campusSchema),
});
export const createCampusInputSchema = campusDataSchema;
export const updateCampusInputSchema = z.object({
	id: z.uuid(),
	data: campusDataSchema
		.partial()
		.refine((value) => Object.keys(value).length > 0, {
			message: "至少提供一个待更新字段。",
		}),
});
export const setCampusActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});

const memberSchema = z.object({
	id: z.uuid(),
	userId: z.string(),
	name: z.string(),
	email: z.string().email(),
	role: organizationRoleSchema,
	campusAccessMode: campusAccessModeSchema,
	campusIds: z.array(z.uuid()),
	createdAt: z.iso.datetime({ offset: true }),
});

export const memberListResultSchema = z.object({
	items: z.array(memberSchema),
});
export const updateMemberInputSchema = z
	.object({
		memberId: z.uuid(),
		role: organizationRoleSchema,
	})
	.merge(campusScopeSchema);
export const removeMemberInputSchema = z.object({ memberId: z.uuid() });

const invitationSchema = z.object({
	id: z.uuid(),
	emailMasked: z.string(),
	role: organizationRoleSchema,
	campusAccessMode: campusAccessModeSchema,
	campusIds: z.array(z.uuid()),
	expiresAt: z.iso.datetime({ offset: true }),
	revokedAt: z.iso.datetime({ offset: true }).nullable(),
	claimedAt: z.iso.datetime({ offset: true }).nullable(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const invitationListResultSchema = z.object({
	items: z.array(invitationSchema),
});
export const createInvitationInputSchema = z
	.object({
		email: z.string().trim().email().max(254),
		role: organizationRoleSchema.exclude(["owner"]),
		requestId: z.uuid(),
	})
	.merge(campusScopeSchema);
export const createInvitationResultSchema = z.object({
	invitation: invitationSchema,
	token: z.string().min(40),
});
export const revokeInvitationInputSchema = z.object({ id: z.uuid() });
export const resendInvitationInputSchema = z.object({
	id: z.uuid(),
	requestId: z.uuid(),
});
export const claimInvitationInputSchema = z.object({
	token: z.string().min(40),
});
export const claimInvitationResultSchema = z.object({
	organizationId: z.uuid(),
});

export type Campus = z.infer<typeof campusSchema>;
export type CampusListInput = z.infer<typeof campusListInputSchema>;
export type CampusListResult = z.infer<typeof campusListResultSchema>;
export type CreateCampusInput = z.infer<typeof createCampusInputSchema>;
export type UpdateCampusInput = z.infer<typeof updateCampusInputSchema>;
export type SetCampusActiveInput = z.infer<typeof setCampusActiveInputSchema>;

const classroomSchema = z.object({
	id: z.uuid(),
	organizationId: z.uuid(),
	campusId: z.uuid(),
	name: z.string(),
	capacity: z.number().int().positive(),
	isActive: z.boolean(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
export const classroomListInputSchema = z.object({
	campusId: z.uuid().optional(),
	includeInactive: z.boolean().default(true),
});
export const classroomListResultSchema = z.object({
	items: z.array(classroomSchema),
});
export const createClassroomInputSchema = z.object({
	campusId: z.uuid(),
	name: z.string().trim().min(1).max(100),
	capacity: z.number().int().min(1).max(10_000),
});
export const updateClassroomInputSchema = z.object({
	id: z.uuid(),
	data: z.object({
		name: z.string().trim().min(1).max(100),
		capacity: z.number().int().min(1).max(10_000),
	}),
});
export const setClassroomActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});
export type Classroom = z.infer<typeof classroomSchema>;
export type ClassroomListInput = z.infer<typeof classroomListInputSchema>;
export type ClassroomListResult = z.infer<typeof classroomListResultSchema>;
export type CreateClassroomInput = z.infer<typeof createClassroomInputSchema>;
export type UpdateClassroomInput = z.infer<typeof updateClassroomInputSchema>;
export type SetClassroomActiveInput = z.infer<
	typeof setClassroomActiveInputSchema
>;
export type MemberListResult = z.infer<typeof memberListResultSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>;
export type InvitationListResult = z.infer<typeof invitationListResultSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;
export type CreateInvitationResult = z.infer<
	typeof createInvitationResultSchema
>;
export type RevokeInvitationInput = z.infer<typeof revokeInvitationInputSchema>;
export type ResendInvitationInput = z.infer<typeof resendInvitationInputSchema>;
export type ClaimInvitationInput = z.infer<typeof claimInvitationInputSchema>;
export type ClaimInvitationResult = z.infer<typeof claimInvitationResultSchema>;

export type LeadStage =
	| "new"
	| "contacted"
	| "trialBooked"
	| "enrolled"
	| "lost";

export type LeadRecordStage = Exclude<LeadStage, "enrolled">;

export type LeadActivityType =
	| "created"
	| "updated"
	| "followedUp"
	| "converted";

export interface LeadRecord {
	id: EntityId;
	name: string;
	phone: string;
	source: string;
	stage: LeadRecordStage;
	interestedCourse: string;
	owner: string;
	nextFollowAt: string | null;
	note: string;
	campusId: EntityId | null;
	interestedCourseId: EntityId | null;
	ownerUserId: EntityId | null;
	createdAt: string;
	updatedAt: string;
}

export interface LeadActivityRecord {
	id: EntityId;
	type: LeadActivityType;
	content: string;
	stage: LeadRecordStage | "enrolled";
	nextFollowAt: string | null;
	lostReason: string | null;
	operator: string;
	operatorUserId: EntityId | null;
	createdAt: string;
}

const leadStageSchema = z.enum(["new", "contacted", "trialBooked", "lost"]);
const initialLeadStageSchema = z.enum(["new", "contacted", "trialBooked"]);
const leadActivityTypeSchema = z.enum([
	"created",
	"updated",
	"followedUp",
	"converted",
]);

const nullableUuidSchema = z.uuid().nullable();

const createLeadDataSchema = z.object({
	name: z.string().trim().min(1).max(50),
	phone: z.string().trim().min(5).max(30),
	source: z.string().trim().min(1).max(50),
	stage: initialLeadStageSchema.default("new"),
	campusId: nullableUuidSchema.default(null),
	interestedCourseId: nullableUuidSchema.default(null),
	nextFollowAt: z.iso.datetime({ offset: true }).nullable().default(null),
	note: z.string().trim().max(1000).nullable().default(null),
	requestId: z.uuid(),
});

const updateLeadDataSchema = z
	.object({
		name: z.string().trim().min(1).max(50).optional(),
		phone: z.string().trim().min(5).max(30).optional(),
		source: z.string().trim().min(1).max(50).optional(),
		campusId: nullableUuidSchema.optional(),
		interestedCourseId: nullableUuidSchema.optional(),
		note: z.string().trim().max(1000).nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, {
		message: "至少提供一个待更新字段",
	});

const leadListFiltersSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	stage: z
		.enum(["all", "new", "contacted", "trialBooked", "lost"])
		.default("all"),
	campusId: z.uuid().optional(),
	ownerUserId: z.uuid().or(z.string().min(1).max(128)).optional(),
	createdAtFrom: z.iso.datetime({ offset: true }).optional(),
	createdAtTo: z.iso.datetime({ offset: true }).optional(),
});

function validateCreatedAtRange(
	input: z.infer<typeof leadListFiltersSchema>,
	context: z.RefinementCtx,
) {
	if (
		input.createdAtFrom &&
		input.createdAtTo &&
		new Date(input.createdAtFrom) > new Date(input.createdAtTo)
	) {
		context.addIssue({
			code: "custom",
			message: "创建时间范围无效。",
			path: ["createdAtTo"],
		});
	}
}

export const leadListInputSchema = leadListFiltersSchema
	.extend({
		cursor: z.string().min(1).max(256).optional(),
		pageSize: z.number().int().min(1).max(50).default(20),
	})
	.superRefine(validateCreatedAtRange);

const leadRecordSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	phone: z.string(),
	source: z.string(),
	stage: leadStageSchema,
	interestedCourse: z.string(),
	owner: z.string(),
	nextFollowAt: z.string().nullable(),
	note: z.string(),
	campusId: z.uuid().nullable(),
	interestedCourseId: z.uuid().nullable(),
	ownerUserId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const leadListResultSchema = z.object({
	items: z.array(leadRecordSchema),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

export const createLeadResultSchema = z.object({
	lead: leadRecordSchema,
	replayed: z.boolean(),
});

export const leadActivitySchema = z.object({
	id: z.uuid(),
	type: leadActivityTypeSchema,
	content: z.string(),
	stage: z.enum(["new", "contacted", "trialBooked", "lost", "enrolled"]),
	nextFollowAt: z.string().nullable(),
	lostReason: z.string().nullable(),
	operator: z.string(),
	operatorUserId: z.string().nullable(),
	createdAt: z.string(),
});

export const leadHistoryInputSchema = z.object({ leadId: z.uuid() });
export const leadHistoryResultSchema = z.object({
	items: z.array(leadActivitySchema),
});

export const addLeadFollowUpInputSchema = z
	.object({
		leadId: z.uuid(),
		content: z.string().trim().min(1).max(1000),
		stage: leadStageSchema,
		nextFollowAt: z.iso.datetime({ offset: true }).nullable().default(null),
		lostReason: z.string().trim().min(1).max(500).nullable().default(null),
	})
	.superRefine((input, context) => {
		if (input.stage === "lost" && !input.lostReason) {
			context.addIssue({
				code: "custom",
				message: "标记失单时必须填写失单原因。",
				path: ["lostReason"],
			});
		}
		if (input.stage !== "lost" && input.lostReason) {
			context.addIssue({
				code: "custom",
				message: "仅失单线索可以填写失单原因。",
				path: ["lostReason"],
			});
		}
	});

export const leadFilterOptionsSchema = z.object({
	campuses: z.array(z.object({ id: z.uuid(), name: z.string() })),
	owners: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const exportLeadsInputSchema = leadListFiltersSchema
	.extend({
		limit: z.number().int().min(1).max(5000).default(1000),
	})
	.superRefine(validateCreatedAtRange);

export const exportLeadsResultSchema = z.object({
	fileName: z.string(),
	csv: z.string(),
});

const auditActionSchema = z.enum([
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

export const auditEventListInputSchema = z.object({
	action: auditActionSchema.optional(),
	actorUserId: z.string().optional(),
	createdAtFrom: z.iso.datetime({ offset: true }).optional(),
	createdAtTo: z.iso.datetime({ offset: true }).optional(),
	pageSize: z.number().int().min(1).max(100).default(50),
});
export const auditEventListResultSchema = z.object({
	items: z.array(
		z.object({
			id: z.uuid(),
			action: auditActionSchema,
			entityType: z.string(),
			entityId: z.uuid(),
			campusId: z.uuid().nullable(),
			actorUserId: z.string().nullable(),
			actorName: z.string().nullable(),
			createdAt: z.iso.datetime({ offset: true }),
		}),
	),
});

const notificationSchema = z.object({
	id: z.uuid(),
	type: z.enum([
		"lead_import_completed",
		"lead_import_failed",
		"invoice_follow_up",
	]),
	title: z.string(),
	body: z.string(),
	entityType: z.string(),
	entityId: z.uuid(),
	readAt: z.iso.datetime({ offset: true }).nullable(),
	createdAt: z.iso.datetime({ offset: true }),
});
export const notificationListInputSchema = z.object({
	limit: z.number().int().min(1).max(100).default(20),
});
export const notificationListResultSchema = z.object({
	items: z.array(notificationSchema),
	unreadCount: z.number().int().nonnegative(),
});
export const markNotificationReadInputSchema = z.object({ id: z.uuid() });
export const markNotificationsReadResultSchema = z.object({
	count: z.number().int().nonnegative(),
});

const leadImportCampusInputSchema = z.object({
	// campusId 保留给已发布的导入界面；新调用方使用语义更明确的 defaultCampusId。
	campusId: nullableUuidSchema.optional(),
	defaultCampusId: nullableUuidSchema.optional(),
});

export const LEAD_IMPORT_RPC_BODY_LIMIT_BYTES = 256 * 1024;
// Hono 对所有 RPC 请求应用同一限制，因此文案必须保持通用。
export const LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE =
	"请求内容超过 256 KiB 限制。";

/**
 * oRPC fetch transport 将调用 input 包装为 `{ json: input }` 后发送。
 * 此函数必须保持浏览器可用，不能依赖 Buffer 等 Node API。
 */
export function getLeadImportRpcBodyBytes(input: unknown): number {
	return new TextEncoder().encode(JSON.stringify({ json: input })).byteLength;
}

function validateLeadImportDefaultCampus(
	input: z.infer<typeof leadImportCampusInputSchema>,
	context: z.RefinementCtx,
) {
	if (
		input.campusId !== undefined &&
		input.defaultCampusId !== undefined &&
		input.campusId !== input.defaultCampusId
	) {
		context.addIssue({
			code: "custom",
			path: ["defaultCampusId"],
			message: "默认校区参数不一致。",
		});
	}
}

function validateLeadImportRpcBodySize(
	input: { content: string },
	context: z.RefinementCtx,
) {
	if (getLeadImportRpcBodyBytes(input) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES) {
		context.addIssue({
			code: "custom",
			path: ["content"],
			message: LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
		});
	}
}

export const previewLeadImportInputSchema = z
	.object({
		content: z.string(),
	})
	.merge(leadImportCampusInputSchema)
	.superRefine((input, context) => {
		validateLeadImportDefaultCampus(input, context);
		validateLeadImportRpcBodySize(input, context);
	});
export const previewLeadImportResultSchema = z.object({
	totalRows: z.number().int().nonnegative(),
	validRows: z.number().int().nonnegative(),
	errors: z.array(
		z.object({ row: z.number().int().positive(), message: z.string() }),
	),
});
export const confirmLeadImportInputSchema = z
	.object({
		requestId: z.uuid(),
		content: z.string(),
	})
	.merge(leadImportCampusInputSchema)
	.superRefine((input, context) => {
		validateLeadImportDefaultCampus(input, context);
		validateLeadImportRpcBodySize(input, context);
	});
export const confirmLeadImportResultSchema = z.object({
	batchId: z.uuid(),
	importedRows: z.number().int().nonnegative(),
	errorRows: z.number().int().nonnegative(),
	errors: z.array(
		z.object({ row: z.number().int().positive(), message: z.string() }),
	),
	replayed: z.boolean(),
});

export const createLeadInputSchema = createLeadDataSchema;

export const updateLeadInputSchema = z.object({
	id: z.uuid(),
	data: updateLeadDataSchema,
});

export type LeadListInput = z.infer<typeof leadListInputSchema>;
export type LeadListResult = z.infer<typeof leadListResultSchema>;
export type CreateLeadInput = z.infer<typeof createLeadInputSchema>;
export type CreateLeadResult = z.infer<typeof createLeadResultSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadInputSchema>;
export type AddLeadFollowUpInput = z.infer<typeof addLeadFollowUpInputSchema>;
export type LeadHistoryInput = z.infer<typeof leadHistoryInputSchema>;
export type LeadHistoryResult = z.infer<typeof leadHistoryResultSchema>;
export type LeadFilterOptions = z.infer<typeof leadFilterOptionsSchema>;
export type ExportLeadsInput = z.infer<typeof exportLeadsInputSchema>;
export type ExportLeadsResult = z.infer<typeof exportLeadsResultSchema>;
export type AuditEventListInput = z.infer<typeof auditEventListInputSchema>;
export type AuditEventListResult = z.infer<typeof auditEventListResultSchema>;
export type NotificationListInput = z.infer<typeof notificationListInputSchema>;
export type NotificationListResult = z.infer<
	typeof notificationListResultSchema
>;
export type PreviewLeadImportInput = z.infer<
	typeof previewLeadImportInputSchema
>;
export type PreviewLeadImportResult = z.infer<
	typeof previewLeadImportResultSchema
>;
export type ConfirmLeadImportInput = z.infer<
	typeof confirmLeadImportInputSchema
>;
export type ConfirmLeadImportResult = z.infer<
	typeof confirmLeadImportResultSchema
>;

export const leadConversionOptionsInputSchema = z.object({
	leadId: z.uuid(),
});

const conversionLeadSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	phone: z.string(),
	stage: z.enum(["new", "contacted", "trialBooked"]),
	campusId: z.uuid().nullable(),
	interestedCourseId: z.uuid().nullable(),
});

const conversionStudentSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	guardianName: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	status: z.enum(["active", "trial", "paused", "graduated", "atRisk"]),
});

export const conversionCampusSchema = z.object({
	id: z.uuid(),
	name: z.string(),
});

export const conversionCourseSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	listPriceInCents: z.number().int().nonnegative(),
	lessonsPerPackage: z.number().int().positive(),
});

export const conversionClassSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	courseId: z.uuid(),
	campusId: z.uuid(),
	campusName: z.string(),
	status: z.enum(["recruiting", "running"]),
	capacity: z.number().int().nonnegative(),
	enrollmentCount: z.number().int().nonnegative(),
	seatsRemaining: z.number().int().nonnegative(),
	scheduleText: z.string(),
});

export const leadConversionOptionsSchema = z.object({
	lead: conversionLeadSchema,
	permissions: z.object({
		canOverridePackageTerms: z.boolean(),
	}),
	matchingStudents: z.array(conversionStudentSchema),
	campuses: z.array(conversionCampusSchema),
	courses: z.array(conversionCourseSchema),
	classes: z.array(conversionClassSchema),
});

const conversionStudentChoiceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("existing"),
		studentId: z.uuid(),
	}),
	z.object({
		mode: z.literal("new"),
		name: z.string().trim().min(1).max(50),
		guardianName: z.string().trim().min(1).max(50),
		campusId: z.uuid(),
	}),
]);

export const convertLeadInputSchema = z.object({
	leadId: z.uuid(),
	student: conversionStudentChoiceSchema,
	courseId: z.uuid(),
	classGroupId: z.uuid().nullable().default(null),
	purchasedLessons: z.number().int().min(1).max(1000),
	amountInCents: z.number().int().min(0).max(100_000_000),
	invoiceDueDate: z.iso.date(),
});

export const convertLeadResultSchema = z.object({
	leadId: z.uuid(),
	studentId: z.uuid(),
	enrollmentId: z.uuid(),
	invoiceId: z.uuid(),
	classGroupId: z.uuid().nullable(),
});

export type LeadConversionOptionsInput = z.infer<
	typeof leadConversionOptionsInputSchema
>;
export type LeadConversionOptions = z.infer<typeof leadConversionOptionsSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadInputSchema>;
export type ConvertLeadResult = z.infer<typeof convertLeadResultSchema>;

export const independentEnrollmentOptionsInputSchema = z.object({});

const independentStudentChoiceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("existing"),
		studentId: z.uuid(),
	}),
	z.object({
		mode: z.literal("new"),
		name: z.string().trim().min(1).max(50),
		campusId: z.uuid(),
		primaryContact: z.object({
			name: z.string().trim().min(1).max(50),
			phone: z.string().trim().min(1).max(50),
			relationship: z.string().trim().max(30).nullable().default(null),
		}),
	}),
]);

export const independentEnrollmentOptionsSchema = z.object({
	permissions: z.object({
		canOverridePackageTerms: z.boolean(),
	}),
	campuses: z.array(conversionCampusSchema),
	courses: z.array(conversionCourseSchema),
	classes: z.array(conversionClassSchema),
});

export const createIndependentEnrollmentInputSchema = z.object({
	requestId: z.uuid(),
	student: independentStudentChoiceSchema,
	courseId: z.uuid(),
	classGroupId: z.uuid().nullable().default(null),
	purchasedLessons: z.number().int().min(1).max(1000),
	amountInCents: z.number().int().min(0).max(100_000_000),
	invoiceDueDate: z.iso.date(),
});

export const createIndependentEnrollmentResultSchema = z.object({
	studentId: z.uuid(),
	enrollmentId: z.uuid(),
	invoiceId: z.uuid(),
	classGroupId: z.uuid().nullable(),
	replayed: z.boolean(),
});

export type IndependentEnrollmentOptionsInput = z.infer<
	typeof independentEnrollmentOptionsInputSchema
>;
export type IndependentEnrollmentOptions = z.infer<
	typeof independentEnrollmentOptionsSchema
>;
export type CreateIndependentEnrollmentInput = z.infer<
	typeof createIndependentEnrollmentInputSchema
>;
export type CreateIndependentEnrollmentResult = z.infer<
	typeof createIndependentEnrollmentResultSchema
>;

const invoiceSettlementStatusSchema = z.enum([
	"pending",
	"partial",
	"paid",
	"refunded",
]);
export const invoiceSourceSchema = z.enum(["enrollment", "renewal", "manual"]);
export const invoiceBusinessActivityTypeSchema = z.enum([
	"course_enrollment",
	"course_renewal",
	"material_fee",
	"exam_fee",
	"price_difference",
	"other",
]);
export const manualInvoiceBusinessActivityTypeSchema = z.enum([
	"material_fee",
	"exam_fee",
	"price_difference",
	"other",
]);
const paymentMethodSchema = z.enum([
	"cash",
	"wechat",
	"alipay",
	"bankTransfer",
	"pos",
	"other",
]);

export const invoiceListInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	status: z
		.enum(["all", "open", "pending", "partial", "paid", "refunded"])
		.default("open"),
});

const invoiceSummarySchema = z.object({
	id: z.uuid(),
	enrollmentId: z.uuid().nullable(),
	studentId: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	businessActivityType: invoiceBusinessActivityTypeSchema,
	summary: z.string(),
	amountInCents: z.number().int().nonnegative(),
	paidAmountInCents: z.number().int().nonnegative(),
	outstandingAmountInCents: z.number().int().nonnegative(),
	status: invoiceSettlementStatusSchema,
	isOverdue: z.boolean(),
	dueDate: z.iso.date(),
	issuedAt: z.iso.datetime({ offset: true }),
	createdByName: z.string().nullable(),
	version: z.number().int().positive(),
});

const paymentRecordSchema = z.object({
	id: z.uuid(),
	amountInCents: z.number().int().positive(),
	reversedAmountInCents: z.number().int().nonnegative(),
	effectiveAmountInCents: z.number().int().nonnegative(),
	receivedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	referenceNo: z.string().nullable(),
	note: z.string().nullable(),
	operatorName: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
	reversals: z.array(
		z.object({
			id: z.uuid(),
			amountInCents: z.number().int().positive(),
			reason: z.string(),
			reversedAt: z.iso.datetime({ offset: true }),
			operatorName: z.string(),
			createdAt: z.iso.datetime({ offset: true }),
		}),
	),
});

const refundRecordSchema = z.object({
	id: z.uuid(),
	amountInCents: z.number().int().positive(),
	refundedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	reason: z.string(),
	operatorName: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const invoiceListResultSchema = z.object({
	items: z.array(invoiceSummarySchema),
	total: z.number().int().nonnegative(),
});

export const invoiceDetailInputSchema = z.object({ id: z.uuid() });

export const invoiceDetailSchema = z.object({
	invoice: invoiceSummarySchema,
	payments: z.array(paymentRecordSchema),
	refunds: z.array(refundRecordSchema),
	adjustments: z.array(
		z.object({
			id: z.uuid(),
			beforeVersion: z.number().int().positive(),
			afterVersion: z.number().int().positive(),
			before: z.object({
				amountInCents: z.number().int().nonnegative(),
				dueDate: z.iso.date(),
				summary: z.string(),
			}),
			after: z.object({
				amountInCents: z.number().int().nonnegative(),
				dueDate: z.iso.date(),
				summary: z.string(),
			}),
			reason: z.string(),
			operatorName: z.string(),
			createdAt: z.iso.datetime({ offset: true }),
		}),
	),
	capabilities: z.object({
		canAdjustAmount: z.boolean(),
		canAdjustDueDate: z.boolean(),
		canAdjustSummary: z.boolean(),
	}),
	historicalPaidAmountInCents: z.number().int().nonnegative(),
});

export const manualInvoiceOptionsInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

export const manualInvoiceOptionsSchema = z.object({
	students: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			campusId: z.uuid(),
			campusName: z.string(),
			enrollments: z.array(
				z.object({
					id: z.uuid(),
					courseId: z.uuid(),
					courseName: z.string(),
					status: z.enum(["active", "frozen"]),
				}),
			),
		}),
	),
	nextCursor: z.string().nullable(),
});

export const createManualInvoiceInputSchema = z.object({
	studentId: z.uuid(),
	enrollmentId: z.uuid().nullable().default(null),
	businessActivityType: manualInvoiceBusinessActivityTypeSchema,
	summary: z.string().trim().min(1).max(200),
	amountInCents: z.number().int().min(1).max(100_000_000),
	dueDate: z.iso.date(),
	requestId: z.uuid(),
});

export const createManualInvoiceResultSchema = z.object({
	invoiceId: z.uuid(),
	replayed: z.boolean(),
});

export const adjustInvoiceInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000).optional(),
		dueDate: z.iso.date().optional(),
		summary: z.string().trim().min(1).max(200).optional(),
		reason: z.string().trim().min(1).max(500),
		expectedVersion: z.number().int().positive(),
		requestId: z.uuid(),
	})
	.refine(
		(input) =>
			input.amountInCents !== undefined ||
			input.dueDate !== undefined ||
			input.summary !== undefined,
		{ message: "请至少修改一个账单字段" },
	);

const invoiceAdjustmentResultRecordSchema = z.object({
	id: z.uuid(),
	invoiceId: z.uuid(),
	beforeVersion: z.number().int().positive(),
	afterVersion: z.number().int().positive(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const adjustInvoiceResultSchema = z.object({
	adjustment: invoiceAdjustmentResultRecordSchema,
	replayed: z.boolean(),
});

export const createPaymentInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000),
		receivedAt: z.iso.datetime({ offset: true }),
		method: paymentMethodSchema,
		referenceNo: z.string().trim().max(100).nullable().default(null),
		note: z.string().trim().max(500).nullable().default(null),
		requestId: z.uuid(),
	})
	.refine((data) => data.method !== "other" || Boolean(data.note), {
		message: "选择其他收款方式时请填写备注",
		path: ["note"],
	});

export const createPaymentResultSchema = z.object({
	payment: paymentRecordSchema,
});

export const createPaymentReversalInputSchema = z.object({
	paymentId: z.uuid(),
	amountInCents: z.number().int().min(1).max(100_000_000),
	reason: z.string().trim().min(1, "请填写冲正原因").max(500),
	reversedAt: z.iso.datetime({ offset: true }),
	requestId: z.uuid(),
});

export const createPaymentReversalResultSchema = z.object({
	reversal: z.object({
		id: z.uuid(),
		invoiceId: z.uuid(),
		paymentId: z.uuid(),
		amountInCents: z.number().int().positive(),
		reason: z.string(),
		reversedAt: z.iso.datetime({ offset: true }),
		operatorName: z.string(),
		createdAt: z.iso.datetime({ offset: true }),
	}),
	payment: z.object({
		id: z.uuid(),
		originalAmountInCents: z.number().int().positive(),
		reversedAmountInCents: z.number().int().nonnegative(),
		effectiveAmountInCents: z.number().int().nonnegative(),
	}),
	invoice: z.object({
		id: z.uuid(),
		paidAmountInCents: z.number().int().nonnegative(),
		status: invoiceSettlementStatusSchema,
		paidAt: z.iso.datetime({ offset: true }).nullable(),
	}),
	replayed: z.boolean(),
});

const enrollmentAdjustmentSchema = z.object({
	id: z.uuid(),
	studentId: z.uuid(),
	studentName: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	courseId: z.uuid(),
	courseName: z.string(),
	purchasedLessons: z.number().int().nonnegative(),
	remainingLessons: z.number().int().nonnegative(),
	status: z.enum(["active", "frozen", "transferred"]),
});

export const enrollmentAdjustmentListResultSchema = z.object({
	items: z.array(enrollmentAdjustmentSchema),
	courses: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export const renewEnrollmentInputSchema = z.object({
	enrollmentId: z.uuid(),
	addedLessons: z.number().int().min(1).max(10_000),
	amountInCents: z.number().int().min(0).max(100_000_000),
	dueDate: z.iso.date(),
	requestId: z.uuid(),
});

export const renewEnrollmentResultSchema = z.object({
	enrollmentId: z.uuid(),
	invoiceId: z.uuid(),
	addedLessons: z.number().int().positive(),
});

export const transferEnrollmentInputSchema = z.object({
	sourceEnrollmentId: z.uuid(),
	targetCourseId: z.uuid(),
	requestId: z.uuid(),
});

export const transferEnrollmentResultSchema = z.object({
	sourceEnrollmentId: z.uuid(),
	targetEnrollmentId: z.uuid(),
	transferredLessons: z.number().int().positive(),
});

export const createRefundInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000),
		refundedAt: z.iso.datetime({ offset: true }),
		method: paymentMethodSchema,
		reason: z.string().trim().min(1).max(500),
		requestId: z.uuid(),
	})
	.refine((data) => data.method !== "other" || Boolean(data.reason), {
		message: "选择其他退款方式时请填写退款原因",
		path: ["reason"],
	});

export const createRefundResultSchema = z.object({
	refund: refundRecordSchema,
});

export const refundRequestStatusSchema = z.enum([
	"pending",
	"approved",
	"rejected",
	"cancelled",
]);

const refundRequestEventSchema = z.object({
	id: z.uuid(),
	action: z.enum(["submitted", "approved", "rejected", "cancelled"]),
	fromStatus: refundRequestStatusSchema.nullable(),
	toStatus: refundRequestStatusSchema,
	comment: z.string().nullable(),
	operatorUserId: z.string(),
	operatorName: z.string(),
	requestId: z.uuid(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const refundRequestSchema = z.object({
	id: z.uuid(),
	invoiceId: z.uuid(),
	campusId: z.uuid(),
	amountInCents: z.number().int().positive(),
	refundedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	reason: z.string(),
	applicantUserId: z.string(),
	applicantName: z.string(),
	status: refundRequestStatusSchema,
	version: z.number().int().positive(),
	refundId: z.uuid().nullable(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
	events: z.array(refundRequestEventSchema),
});

export const refundRequestListInputSchema = z.object({ invoiceId: z.uuid() });
export const refundRequestListResultSchema = z.object({
	items: z.array(refundRequestSchema),
});

export const createRefundRequestInputSchema = createRefundInputSchema;
export const createRefundRequestResultSchema = z.object({
	request: refundRequestSchema,
	replayed: z.boolean(),
});

export const decideRefundRequestInputSchema = z
	.object({
		refundRequestId: z.uuid(),
		action: z.enum(["approved", "rejected"]),
		comment: z.string().trim().max(500).nullable().default(null),
		expectedVersion: z.number().int().positive(),
		requestId: z.uuid(),
	})
	.refine(
		(input) => input.action !== "rejected" || Boolean(input.comment?.trim()),
		{ message: "拒绝退款申请时必须填写原因", path: ["comment"] },
	);

export const decideRefundRequestResultSchema = createRefundRequestResultSchema;

export const cancelRefundRequestInputSchema = z.object({
	refundRequestId: z.uuid(),
	reason: z.string().trim().max(500).nullable().default(null),
	expectedVersion: z.number().int().positive(),
	requestId: z.uuid(),
});

export const cancelRefundRequestResultSchema = createRefundRequestResultSchema;

const arrearsRecordSchema = z.object({
	invoiceId: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	summary: z.string(),
	amountInCents: z.number().int().nonnegative(),
	paidAmountInCents: z.number().int().nonnegative(),
	outstandingAmountInCents: z.number().int().positive(),
	dueDate: z.iso.date(),
	isOverdue: z.boolean(),
	lastFollowUpAt: z.iso.datetime({ offset: true }).nullable(),
	lastFollowUpNote: z.string().nullable(),
	lastFollowUpOperatorName: z.string().nullable(),
});

export const arrearsListResultSchema = z.object({
	items: z.array(arrearsRecordSchema),
});

export const createInvoiceFollowUpInputSchema = z.object({
	invoiceId: z.uuid(),
	note: z.string().trim().min(1).max(500),
	followedUpAt: z.iso.datetime({ offset: true }),
	requestId: z.uuid(),
});

export const createInvoiceFollowUpResultSchema = z.object({
	invoiceId: z.uuid(),
	note: z.string(),
	followedUpAt: z.iso.datetime({ offset: true }),
	operatorName: z.string(),
});

export type InvoiceListInput = z.infer<typeof invoiceListInputSchema>;
export type InvoiceListResult = z.infer<typeof invoiceListResultSchema>;
export type InvoiceDetailInput = z.infer<typeof invoiceDetailInputSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type ManualInvoiceOptionsInput = z.infer<
	typeof manualInvoiceOptionsInputSchema
>;
export type ManualInvoiceOptions = z.infer<typeof manualInvoiceOptionsSchema>;
export type CreateManualInvoiceInput = z.infer<
	typeof createManualInvoiceInputSchema
>;
export type CreateManualInvoiceResult = z.infer<
	typeof createManualInvoiceResultSchema
>;
export type AdjustInvoiceInput = z.infer<typeof adjustInvoiceInputSchema>;
export type AdjustInvoiceResult = z.infer<typeof adjustInvoiceResultSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
export type CreatePaymentResult = z.infer<typeof createPaymentResultSchema>;
export type CreatePaymentReversalInput = z.infer<
	typeof createPaymentReversalInputSchema
>;
export type CreatePaymentReversalResult = z.infer<
	typeof createPaymentReversalResultSchema
>;
export type EnrollmentAdjustmentListResult = z.infer<
	typeof enrollmentAdjustmentListResultSchema
>;
export type RenewEnrollmentInput = z.infer<typeof renewEnrollmentInputSchema>;
export type RenewEnrollmentResult = z.infer<typeof renewEnrollmentResultSchema>;
export type TransferEnrollmentInput = z.infer<
	typeof transferEnrollmentInputSchema
>;
export type TransferEnrollmentResult = z.infer<
	typeof transferEnrollmentResultSchema
>;
export type CreateRefundInput = z.infer<typeof createRefundInputSchema>;
export type CreateRefundResult = z.infer<typeof createRefundResultSchema>;
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type RefundRequestListInput = z.infer<
	typeof refundRequestListInputSchema
>;
export type RefundRequestListResult = z.infer<
	typeof refundRequestListResultSchema
>;
export type CreateRefundRequestInput = z.infer<
	typeof createRefundRequestInputSchema
>;
export type CreateRefundRequestResult = z.infer<
	typeof createRefundRequestResultSchema
>;
export type DecideRefundRequestInput = z.infer<
	typeof decideRefundRequestInputSchema
>;
export type DecideRefundRequestResult = z.infer<
	typeof decideRefundRequestResultSchema
>;
export type CancelRefundRequestInput = z.infer<
	typeof cancelRefundRequestInputSchema
>;
export type CancelRefundRequestResult = z.infer<
	typeof cancelRefundRequestResultSchema
>;
export type ArrearsListResult = z.infer<typeof arrearsListResultSchema>;
export type CreateInvoiceFollowUpInput = z.infer<
	typeof createInvoiceFollowUpInputSchema
>;
export type CreateInvoiceFollowUpResult = z.infer<
	typeof createInvoiceFollowUpResultSchema
>;

export const studentStatusSchema = z.enum([
	"active",
	"trial",
	"paused",
	"graduated",
	"atRisk",
]);

const studentContactInputSchema = z.object({
	id: z.uuid().optional(),
	name: z.string().trim().min(1).max(50),
	phone: z.string().trim().min(5).max(30),
	relationship: z.string().trim().min(1).max(30).nullable().default(null),
	isPrimary: z.boolean(),
});

const studentContactsSchema = z
	.array(studentContactInputSchema)
	.min(1, "请至少填写一位联系人")
	.max(10, "最多可维护 10 位联系人")
	.superRefine((contacts, context) => {
		if (contacts.filter((contact) => contact.isPrimary).length !== 1) {
			context.addIssue({
				code: "custom",
				message: "请且仅选择一位主要联系人",
				path: ["isPrimary"],
			});
		}
	});

export const studentTagSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	isActive: z.boolean(),
});

const studentSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	status: studentStatusSchema,
	primaryContactName: z.string(),
	primaryContactPhoneMasked: z.string(),
	tags: z.array(studentTagSchema),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});

const studentContactSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	phone: z.string(),
	relationship: z.string().nullable(),
	isPrimary: z.boolean(),
});

export const studentDetailSchema = studentSummarySchema.extend({
	birthDate: z.iso.date().nullable(),
	contacts: z.array(studentContactSchema),
});

export const studentListInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	campusId: z.uuid().optional(),
	status: z
		.enum(["all", "active", "trial", "paused", "graduated", "atRisk"])
		.default("all"),
	tagId: z.uuid().optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

export const studentListResultSchema = z.object({
	items: z.array(studentSummarySchema),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

export const studentDetailInputSchema = z.object({ id: z.uuid() });
export const studentTimelineInputSchema = z.object({
	studentId: z.uuid(),
	cursor: z.string().min(1).max(512).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});
const studentTimelineKindSchema = z.enum([
	"enrollment_created",
	"enrollment_lifecycle",
	"invoice_issued",
	"payment_received",
	"enrollment_renewed",
	"enrollment_transferred",
	"refund_created",
	"attendance_recorded",
	"lesson_consumed",
	"student_status_changed",
]);
const studentTimelineSourceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("none") }),
	z.object({ type: z.literal("invoice"), invoiceId: z.uuid() }),
	z.object({ type: z.literal("lesson"), lessonId: z.uuid() }),
]);
const studentTimelineItemSchema = z.object({
	id: z.string().min(1),
	kind: studentTimelineKindSchema,
	occurredAt: z.iso.datetime({ offset: true }),
	recordedAt: z.iso.datetime({ offset: true }).nullable(),
	actorName: z.string().nullable(),
	courseName: z.string().nullable(),
	className: z.string().nullable(),
	invoiceSummary: z.string().nullable(),
	invoiceSource: invoiceSourceSchema.nullable(),
	amountInCents: z.number().int().nullable(),
	lessonCount: z.number().int().nullable(),
	previousRemainingLessons: z.number().int().nullable(),
	remainingLessons: z.number().int().nullable(),
	status: z.string().nullable(),
	beforeStatus: z.string().nullable(),
	afterStatus: z.string().nullable(),
	source: studentTimelineSourceSchema,
});
export const studentTimelineResultSchema = z.object({
	items: z.array(studentTimelineItemSchema),
	nextCursor: z.string().nullable(),
});
export const duplicateStudentCandidatesInputSchema = z.object({
	phone: z.string().trim().min(5).max(30),
	excludeStudentId: z.uuid().optional(),
});
export const duplicateStudentCandidatesResultSchema = z.object({
	items: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			campusId: z.uuid(),
			campusName: z.string(),
			status: studentStatusSchema,
			phoneMasked: z.string(),
		}),
	),
});
const studentMergeProfileSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	birthDate: z.iso.date().nullable(),
	status: studentStatusSchema,
	updatedAt: z.iso.datetime({ offset: true }),
});
const studentMergeContactSchema = studentContactSchema.extend({
	studentId: z.uuid(),
	duplicateOfContactId: z.uuid().nullable(),
});
export const studentMergePreviewInputSchema = z.object({
	sourceStudentId: z.uuid(),
	targetStudentId: z.uuid(),
});
export const studentMergePreviewResultSchema = z.object({
	source: studentMergeProfileSchema,
	target: studentMergeProfileSchema,
	contacts: z.array(studentMergeContactSchema),
	conflicts: z.array(
		z.enum(["name", "campusId", "birthDate", "status", "primaryContactId"]),
	),
	blockingReasons: z.array(
		z.enum(["ACTIVE_COURSE_ENROLLMENT", "ATTENDANCE_CONFLICT"]),
	),
});
export const mergeStudentsInputSchema = z.object({
	sourceStudentId: z.uuid(),
	targetStudentId: z.uuid(),
	expectedSourceUpdatedAt: z.iso.datetime({ offset: true }),
	expectedTargetUpdatedAt: z.iso.datetime({ offset: true }),
	requestId: z.uuid(),
	fieldSources: z.object({
		name: z.enum(["source", "target"]),
		campusId: z.enum(["source", "target"]),
		birthDate: z.enum(["source", "target"]),
		status: z.enum(["source", "target"]),
		primaryContactId: z.uuid(),
	}),
});
export const mergeStudentsResultSchema = z.object({
	sourceStudentId: z.uuid(),
	targetStudentId: z.uuid(),
	replayed: z.boolean(),
});

export const createStudentInputSchema = z.object({
	name: z.string().trim().min(1).max(50),
	campusId: z.uuid(),
	birthDate: z.iso.date().nullable().default(null),
	status: studentStatusSchema.default("trial"),
	contacts: studentContactsSchema,
	tagIds: z.array(z.uuid()).max(30).default([]),
});

export const updateStudentInputSchema = z.object({
	id: z.uuid(),
	expectedUpdatedAt: z.iso.datetime({ offset: true }),
	data: z.object({
		name: z.string().trim().min(1).max(50),
		birthDate: z.iso.date().nullable(),
		status: studentStatusSchema,
		contacts: studentContactsSchema,
		tagIds: z.array(z.uuid()).max(30),
	}),
});

export const studentTagListInputSchema = z.object({
	includeInactive: z.boolean().default(false),
});

export const studentTagListResultSchema = z.object({
	items: z.array(studentTagSchema),
});

export const createStudentTagInputSchema = z.object({
	name: z.string().trim().min(1).max(30),
});

export const updateStudentTagInputSchema = z.object({
	id: z.uuid(),
	name: z.string().trim().min(1).max(30),
});

export const setStudentTagActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});

export type StudentStatus = z.infer<typeof studentStatusSchema>;
export type StudentTag = z.infer<typeof studentTagSchema>;
export type StudentDetail = z.infer<typeof studentDetailSchema>;
export type StudentTimelineInput = z.infer<typeof studentTimelineInputSchema>;
export type StudentTimelineResult = z.infer<typeof studentTimelineResultSchema>;
export type StudentListInput = z.infer<typeof studentListInputSchema>;
export type DuplicateStudentCandidatesInput = z.infer<
	typeof duplicateStudentCandidatesInputSchema
>;
export type DuplicateStudentCandidatesResult = z.infer<
	typeof duplicateStudentCandidatesResultSchema
>;
export type StudentMergePreviewInput = z.infer<
	typeof studentMergePreviewInputSchema
>;
export type StudentMergePreviewResult = z.infer<
	typeof studentMergePreviewResultSchema
>;
export type MergeStudentsInput = z.infer<typeof mergeStudentsInputSchema>;
export type MergeStudentsResult = z.infer<typeof mergeStudentsResultSchema>;
export type StudentListResult = z.infer<typeof studentListResultSchema>;
export type CreateStudentInput = z.infer<typeof createStudentInputSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentInputSchema>;
export type StudentTagListInput = z.infer<typeof studentTagListInputSchema>;
export type StudentTagListResult = z.infer<typeof studentTagListResultSchema>;
export type CreateStudentTagInput = z.infer<typeof createStudentTagInputSchema>;
export type UpdateStudentTagInput = z.infer<typeof updateStudentTagInputSchema>;
export type SetStudentTagActiveInput = z.infer<
	typeof setStudentTagActiveInputSchema
>;

const courseCategorySchema = z.enum([
	"language",
	"stem",
	"art",
	"exam",
	"sports",
]);
const classStatusSchema = z.enum([
	"recruiting",
	"running",
	"paused",
	"completed",
]);
const lessonStatusSchema = z.enum(["scheduled", "completed", "cancelled"]);

const courseDataSchema = z.object({
	code: z.string().trim().min(1).max(30),
	name: z.string().trim().min(1).max(100),
	category: courseCategorySchema,
	level: z.string().trim().min(1).max(60),
	durationMinutes: z.number().int().min(15).max(480),
	listPriceInCents: z.number().int().min(0).max(100_000_000),
	lessonsPerPackage: z.number().int().min(1).max(1_000),
	tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
});

const courseSchema = courseDataSchema.extend({
	id: z.uuid(),
	organizationId: z.uuid(),
	isActive: z.boolean(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});

export const courseListInputSchema = z.object({
	includeInactive: z.boolean().default(false),
});
export const courseListResultSchema = z.object({
	items: z.array(courseSchema),
});
export const createCourseInputSchema = courseDataSchema;
export const updateCourseInputSchema = z.object({
	id: z.uuid(),
	data: courseDataSchema,
});
export const setCourseActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});

const teacherDataSchema = z.object({
	name: z.string().trim().min(1).max(100),
	phone: z.string().trim().min(1).max(40).nullable().default(null),
	subjects: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
	weeklyCapacityHours: z.number().int().min(1).max(168),
	campusIds: z.array(z.uuid()).min(1).max(100),
});
const teacherSchema = teacherDataSchema.extend({
	id: z.uuid(),
	organizationId: z.uuid(),
	userId: z.string().nullable(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
export const teacherListResultSchema = z.object({
	items: z.array(teacherSchema),
});
const teacherBindingInputSchema = z.object({
	boundUserId: z.string().min(1).max(128).nullable().default(null),
});
export const createTeacherInputSchema = teacherDataSchema.merge(
	teacherBindingInputSchema,
);
export const updateTeacherInputSchema = z.object({
	id: z.uuid(),
	data: teacherDataSchema.merge(teacherBindingInputSchema),
});
export const bindableTeacherMemberListResultSchema = z.object({
	items: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.email(),
			boundTeacherId: z.uuid().nullable(),
		}),
	),
});

const classGroupDataSchema = z.object({
	name: z.string().trim().min(1).max(100),
	campusId: z.uuid(),
	courseId: z.uuid(),
	teacherId: z.uuid(),
	capacity: z.number().int().min(1).max(10_000),
	status: classStatusSchema.default("recruiting"),
	startDate: z.iso.date(),
});
const classGroupSchema = classGroupDataSchema.extend({
	id: z.uuid(),
	campusName: z.string(),
	courseName: z.string(),
	teacherName: z.string(),
	scheduleText: z.string(),
	enrollmentCount: z.number().int().nonnegative(),
});
export const classGroupListInputSchema = z.object({
	campusId: z.uuid().optional(),
	status: classStatusSchema.optional(),
});
export const classGroupListResultSchema = z.object({
	items: z.array(classGroupSchema),
});
export const createClassGroupInputSchema = classGroupDataSchema.omit({
	status: true,
});
export const updateClassGroupInputSchema = z.object({
	id: z.uuid(),
	data: classGroupDataSchema,
});
export const pauseClassGroupInputSchema = z.object({
	id: z.uuid(),
	reason: z.string().trim().min(1).max(500),
	futureLessonPolicy: z.enum(["keep", "cancel"]),
	requestId: z.uuid(),
});
export const pauseClassGroupResultSchema = z.object({
	classGroup: classGroupSchema,
	affectedLessonIds: z.array(z.uuid()),
	replayed: z.boolean(),
});
export const resumeClassGroupInputSchema = z.object({
	id: z.uuid(),
	reason: z.string().trim().min(1).max(500),
	requestId: z.uuid(),
});
export const resumeClassGroupResultSchema = z.object({
	classGroup: classGroupSchema,
	replayed: z.boolean(),
});

const classEnrollmentSchema = z.object({
	enrollmentId: z.uuid(),
	studentId: z.uuid(),
	studentName: z.string(),
	remainingLessons: z.number().int().nonnegative(),
	status: z.enum(["active", "frozen", "transferred"]),
	version: z.number().int().positive(),
	classGroupId: z.uuid().nullable(),
	className: z.string().nullable(),
});
export const classEnrollmentListInputSchema = z.object({ id: z.uuid() });
export const classEnrollmentListResultSchema = z.object({
	items: z.array(classEnrollmentSchema),
});
export const assignEnrollmentClassInputSchema = z.object({
	enrollmentId: z.uuid(),
	classGroupId: z.uuid().nullable(),
});
export const assignEnrollmentClassResultSchema = z.object({
	enrollmentId: z.uuid(),
});

const enrollmentLifecycleActionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("freeze"),
		reason: z.string().trim().min(1).max(500),
	}),
	z.object({
		kind: z.literal("resume"),
		reason: z.string().trim().min(1).max(500),
	}),
	z.object({
		kind: z.literal("withdrawClass"),
		reason: z.string().trim().min(1).max(500),
	}),
	z.object({ kind: z.literal("assignClass"), classGroupId: z.uuid() }),
]);
export const updateEnrollmentLifecycleInputSchema = z.object({
	enrollmentId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	requestId: z.uuid(),
	action: enrollmentLifecycleActionSchema,
});
export const updateEnrollmentLifecycleResultSchema = z.object({
	enrollmentId: z.uuid(),
	status: z.enum(["active", "frozen", "transferred"]),
	classGroupId: z.uuid().nullable(),
	version: z.number().int().positive(),
	replayed: z.boolean(),
});
export type UpdateEnrollmentLifecycleInput = z.infer<
	typeof updateEnrollmentLifecycleInputSchema
>;
export type UpdateEnrollmentLifecycleResult = z.infer<
	typeof updateEnrollmentLifecycleResultSchema
>;

const lessonSchema = z.object({
	id: z.uuid(),
	classGroupId: z.uuid(),
	className: z.string(),
	courseId: z.uuid(),
	courseName: z.string(),
	classStatus: classStatusSchema,
	pausedOverdue: z.boolean(),
	campusId: z.uuid(),
	campusName: z.string(),
	teacherId: z.uuid(),
	teacherName: z.string(),
	room: z.string(),
	roomId: z.uuid().nullable(),
	startsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
	status: lessonStatusSchema,
	cancelledAt: z.iso.datetime({ offset: true }).nullable(),
	cancelledByUserId: z.string().nullable(),
	cancellationReason: z.string().nullable(),
	scheduleRuleId: z.uuid().nullable(),
	scheduleRuleRevision: z.number().int().positive().nullable(),
	scheduleOccurrenceDate: z.iso.date().nullable(),
	isScheduleOverride: z.boolean(),
	version: z.number().int().positive(),
	teachingSummary: z.string().nullable(),
	completedAt: z.iso.datetime({ offset: true }).nullable(),
	completedByUserId: z.string().nullable(),
});
export const lessonListInputSchema = z.object({
	campusId: z.uuid().optional(),
	classGroupId: z.uuid().optional(),
	from: z.iso.datetime({ offset: true }).optional(),
	to: z.iso.datetime({ offset: true }).optional(),
});
export const lessonListResultSchema = z.object({
	items: z.array(lessonSchema),
});
export const createLessonInputSchema = z.object({
	classGroupId: z.uuid(),
	room: z.string().trim().min(1).max(80),
	roomId: z.uuid(),
	startsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
});
export const cancelLessonInputSchema = z.object({
	id: z.uuid(),
	reason: z.string().trim().min(1).max(300).nullable().default(null),
});
export const completeLessonInputSchema = z.object({
	id: z.uuid(),
	attendance: z
		.array(
			z.object({
				enrollmentId: z.uuid(),
				status: z.enum(["present", "absent", "late", "leave"]),
				note: z.string().trim().max(300).nullable().default(null),
			}),
		)
		.max(10_000)
		.nullable()
		.default(null),
	teachingSummary: z.string().trim().max(2000).nullable().default(null),
});
export const saveLessonAttendanceDraftInputSchema = z.object({
	id: z.uuid(),
	attendance: z
		.array(
			z.object({
				enrollmentId: z.uuid(),
				status: z.enum(["present", "absent", "late", "leave"]),
				note: z.string().trim().max(300).nullable().default(null),
			}),
		)
		.max(10_000),
});
const lessonAttendanceMemberSchema = z.object({
	enrollmentId: z.uuid(),
	makeupLessonId: z.uuid().nullable(),
	studentId: z.uuid(),
	studentName: z.string(),
	remainingLessons: z.number().int().nonnegative(),
	status: z.enum(["present", "absent", "late", "leave"]).nullable(),
	note: z.string().nullable(),
});
export const lessonAttendanceInputSchema = z.object({ id: z.uuid() });
export const lessonAttendanceResultSchema = z.object({
	lesson: lessonSchema,
	members: z.array(lessonAttendanceMemberSchema),
});
export const teacherWorkspaceInputSchema = z.object({
	from: z.iso.datetime({ offset: true }),
	to: z.iso.datetime({ offset: true }),
});
export const teacherWorkspaceResultSchema = z.object({
	teacher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
	lessons: z.array(lessonSchema),
});

const makeupLessonStatusSchema = z.enum([
	"scheduled",
	"fulfilled",
	"needs_reschedule",
	"cancelled",
]);
const makeupLessonSchema = z.object({
	id: z.uuid(),
	organizationId: z.uuid(),
	sourceLessonId: z.uuid(),
	sourceEnrollmentId: z.uuid(),
	targetLessonId: z.uuid(),
	studentId: z.uuid(),
	studentName: z.string(),
	courseId: z.uuid(),
	courseName: z.string(),
	campusId: z.uuid(),
	targetClassGroupId: z.uuid(),
	targetClassName: z.string(),
	targetStartsAt: z.iso.datetime({ offset: true }),
	status: makeupLessonStatusSchema,
	requestId: z.uuid(),
	createdByUserId: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
export const makeupLessonListInputSchema = z.object({
	campusId: z.uuid().optional(),
	sourceEnrollmentId: z.uuid().optional(),
	targetLessonId: z.uuid().optional(),
	status: makeupLessonStatusSchema.optional(),
});
export const makeupLessonListResultSchema = z.object({
	items: z.array(makeupLessonSchema),
});
export const createMakeupLessonInputSchema = z.object({
	sourceLessonId: z.uuid(),
	sourceEnrollmentId: z.uuid(),
	targetLessonId: z.uuid(),
	requestId: z.uuid(),
});
export const cancelMakeupLessonInputSchema = z.object({ id: z.uuid() });
export const makeupLessonMutationResultSchema = z.object({
	makeupLesson: makeupLessonSchema,
	replayed: z.boolean(),
});

const scheduleRuleDataSchema = z.object({
	weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
	startMinuteOfDay: z.number().int().min(0).max(1439),
	room: z.string().trim().min(1).max(80),
	roomId: z.uuid(),
	validFrom: z.iso.date(),
	validUntil: z.iso.date(),
});
const scheduleRuleSchema = scheduleRuleDataSchema.extend({
	roomId: z.uuid().nullable(),
	id: z.uuid(),
	organizationId: z.uuid(),
	classGroupId: z.uuid(),
	className: z.string(),
	campusId: z.uuid(),
	teacherId: z.uuid(),
	courseId: z.uuid(),
	durationMinutes: z.number().int().positive(),
	kind: z.literal("weekly"),
	intervalWeeks: z.literal(1),
	timezone: z.literal("Asia/Shanghai"),
	revision: z.number().int().positive(),
	isActive: z.boolean(),
	hasGeneratedLessons: z.boolean(),
	createdByUserId: z.string(),
	updatedByUserId: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
const scheduleCandidateOverrideSchema = z.object({
	occurrenceDate: z.iso.date(),
	startsAt: z.iso.datetime({ offset: true }),
	room: z.string().trim().min(1).max(80),
	roomId: z.uuid(),
});
const scheduleCandidateSchema = scheduleCandidateOverrideSchema.extend({
	roomId: z.uuid().nullable(),
	baselineStartsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
	conflicts: z.array(z.enum(["teacher", "room", "already_generated"])),
});
export const scheduleRuleListInputSchema = z.object({
	classGroupId: z.uuid().optional(),
});
export const scheduleRuleListResultSchema = z.object({
	items: z.array(scheduleRuleSchema),
});
export const createScheduleRuleInputSchema = z.object({
	classGroupId: z.uuid(),
	data: scheduleRuleDataSchema,
});
export const previewScheduleGenerationInputSchema = z.object({
	ruleId: z.uuid(),
	from: z.iso.date(),
	to: z.iso.date(),
	overrides: z.array(scheduleCandidateOverrideSchema).max(200).default([]),
});
export const previewScheduleGenerationResultSchema = z.object({
	rule: scheduleRuleSchema,
	candidates: z.array(scheduleCandidateSchema).max(200),
});
export const generateScheduleLessonsInputSchema =
	previewScheduleGenerationInputSchema.extend({
		expectedRevision: z.number().int().positive(),
		requestId: z.uuid(),
		candidates: z.array(scheduleCandidateOverrideSchema).max(200),
	});
export const generateScheduleLessonsResultSchema = z.object({
	lessonIds: z.array(z.uuid()),
	replayed: z.boolean(),
});
export const previewScheduleRuleUpdateInputSchema = z.object({
	ruleId: z.uuid(),
	expectedRevision: z.number().int().positive(),
	data: scheduleRuleDataSchema,
	effectiveFrom: z.iso.date(),
	reapplyOverrideLessonIds: z.array(z.uuid()).max(200).default([]),
});
const scheduleRuleUpdateItemSchema = z.object({
	lessonId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	occurrenceDate: z.iso.date(),
	isOverride: z.boolean(),
	preserved: z.boolean(),
	current: z.object({
		startsAt: z.iso.datetime({ offset: true }),
		endsAt: z.iso.datetime({ offset: true }),
		room: z.string(),
		roomId: z.uuid().nullable(),
	}),
	proposed: z.object({
		startsAt: z.iso.datetime({ offset: true }),
		endsAt: z.iso.datetime({ offset: true }),
		room: z.string(),
		roomId: z.uuid().nullable(),
	}),
	conflicts: z.array(z.enum(["teacher", "room", "already_generated"])),
});
export const previewScheduleRuleUpdateResultSchema = z.object({
	ruleId: z.uuid(),
	revision: z.number().int().positive(),
	items: z.array(scheduleRuleUpdateItemSchema),
});
export const updateScheduleRuleInputSchema =
	previewScheduleRuleUpdateInputSchema.extend({ requestId: z.uuid() });
export const updateScheduleRuleResultSchema = z.object({
	lessonIds: z.array(z.uuid()),
	revision: z.number().int().positive(),
	replayed: z.boolean(),
});
export const previewScheduleRuleDeactivationInputSchema = z.object({
	ruleId: z.uuid(),
});
export const previewScheduleRuleDeactivationResultSchema = z.object({
	ruleId: z.uuid(),
	revision: z.number().int().positive(),
	futureLessonIds: z.array(z.uuid()),
});
export const deactivateScheduleRuleInputSchema = z.object({
	ruleId: z.uuid(),
	expectedRevision: z.number().int().positive(),
	cancelFuture: z.boolean(),
	reason: z.string().trim().min(1).max(300).nullable().default(null),
	requestId: z.uuid(),
});
export const deactivateScheduleRuleResultSchema = z.object({
	cancelledLessonIds: z.array(z.uuid()),
});
export const deleteScheduleRuleInputSchema = z.object({
	ruleId: z.uuid(),
});
export const deleteScheduleRuleResultSchema = z.object({
	deletedRuleId: z.uuid(),
});
const bulkLessonUpdateItemInputSchema = z.object({
	id: z.uuid(),
	expectedVersion: z.number().int().positive(),
	startsAt: z.iso.datetime({ offset: true }),
	teacherId: z.uuid(),
	room: z.string().trim().min(1).max(80),
	roomId: z.uuid(),
});
const bulkLessonUpdateItemSchema = z.object({
	id: z.uuid(),
	expectedVersion: z.number().int().positive(),
	classGroupId: z.uuid(),
	campusId: z.uuid(),
	current: z.object({
		startsAt: z.iso.datetime({ offset: true }),
		endsAt: z.iso.datetime({ offset: true }),
		teacherId: z.uuid(),
		room: z.string(),
		roomId: z.uuid().nullable(),
	}),
	proposed: z.object({
		startsAt: z.iso.datetime({ offset: true }),
		endsAt: z.iso.datetime({ offset: true }),
		teacherId: z.uuid(),
		room: z.string(),
		roomId: z.uuid().nullable(),
	}),
	conflicts: z.array(z.enum(["teacher", "room", "time"])),
});
export const previewBulkLessonUpdateInputSchema = z.object({
	items: z.array(bulkLessonUpdateItemInputSchema).min(1).max(200),
});
export const previewBulkLessonUpdateResultSchema = z.object({
	items: z.array(bulkLessonUpdateItemSchema),
});
export const bulkUpdateLessonsInputSchema =
	previewBulkLessonUpdateInputSchema.extend({ requestId: z.uuid() });
export const bulkUpdateLessonsResultSchema = z.object({
	lessonIds: z.array(z.uuid()),
	replayed: z.boolean(),
});

export type Course = z.infer<typeof courseSchema>;
export type CourseListInput = z.infer<typeof courseListInputSchema>;
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>;
export type SetCourseActiveInput = z.infer<typeof setCourseActiveInputSchema>;
export type Teacher = z.infer<typeof teacherSchema>;
export type CreateTeacherInput = z.infer<typeof createTeacherInputSchema>;
export type UpdateTeacherInput = z.infer<typeof updateTeacherInputSchema>;
export type BindableTeacherMember = z.infer<
	typeof bindableTeacherMemberListResultSchema.shape.items.element
>;
export type ClassGroup = z.infer<typeof classGroupSchema>;
export type ClassGroupListInput = z.infer<typeof classGroupListInputSchema>;
export type CreateClassGroupInput = z.infer<typeof createClassGroupInputSchema>;
export type UpdateClassGroupInput = z.infer<typeof updateClassGroupInputSchema>;
export type PauseClassGroupInput = z.infer<typeof pauseClassGroupInputSchema>;
export type ResumeClassGroupInput = z.infer<typeof resumeClassGroupInputSchema>;
export type ClassEnrollmentListInput = z.infer<
	typeof classEnrollmentListInputSchema
>;
export type AssignEnrollmentClassInput = z.infer<
	typeof assignEnrollmentClassInputSchema
>;
export type ClassEnrollment = z.infer<typeof classEnrollmentSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonListInput = z.infer<typeof lessonListInputSchema>;
export type CreateLessonInput = z.infer<typeof createLessonInputSchema>;
export type CancelLessonInput = z.infer<typeof cancelLessonInputSchema>;
export type CompleteLessonInput = z.infer<typeof completeLessonInputSchema>;
export type LessonAttendanceInput = z.infer<typeof lessonAttendanceInputSchema>;
export type LessonAttendance = z.infer<typeof lessonAttendanceResultSchema>;
export type SaveLessonAttendanceDraftInput = z.infer<
	typeof saveLessonAttendanceDraftInputSchema
>;
export type MakeupLesson = z.infer<typeof makeupLessonSchema>;
export type MakeupLessonListInput = z.infer<typeof makeupLessonListInputSchema>;
export type CreateMakeupLessonInput = z.infer<
	typeof createMakeupLessonInputSchema
>;
export type CancelMakeupLessonInput = z.infer<
	typeof cancelMakeupLessonInputSchema
>;
export type TeacherWorkspaceInput = z.infer<typeof teacherWorkspaceInputSchema>;
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;
export type ScheduleRuleListInput = z.infer<typeof scheduleRuleListInputSchema>;
export type CreateScheduleRuleInput = z.infer<
	typeof createScheduleRuleInputSchema
>;
export type PreviewScheduleGenerationInput = z.infer<
	typeof previewScheduleGenerationInputSchema
>;
export type GenerateScheduleLessonsInput = z.infer<
	typeof generateScheduleLessonsInputSchema
>;
export type PreviewScheduleRuleDeactivationInput = z.infer<
	typeof previewScheduleRuleDeactivationInputSchema
>;
export type DeactivateScheduleRuleInput = z.infer<
	typeof deactivateScheduleRuleInputSchema
>;
export type DeleteScheduleRuleInput = z.infer<
	typeof deleteScheduleRuleInputSchema
>;
export type PreviewScheduleRuleUpdateInput = z.infer<
	typeof previewScheduleRuleUpdateInputSchema
>;
export type UpdateScheduleRuleInput = z.infer<
	typeof updateScheduleRuleInputSchema
>;
export type PreviewBulkLessonUpdateInput = z.infer<
	typeof previewBulkLessonUpdateInputSchema
>;
export type BulkUpdateLessonsInput = z.infer<
	typeof bulkUpdateLessonsInputSchema
>;

const dashboardFollowUpSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	stage: z.enum(["new", "contacted", "trialBooked"]),
	interestedCourse: z.string().nullable(),
	nextFollowAt: z.iso.datetime({ offset: true }).nullable(),
});

const dashboardTaskSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	module: z.enum(["enrollment", "academic", "finance", "student_service"]),
	owner: z.string().nullable(),
	dueAt: z.iso.datetime({ offset: true }),
	priority: z.enum(["high", "medium", "low"]),
});

const dashboardLessonSchema = z.object({
	id: z.uuid(),
	className: z.string(),
	courseName: z.string(),
	campusName: z.string(),
	teacherName: z.string(),
	room: z.string(),
	startsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
});

const dashboardReceivableSchema = z.object({
	id: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	summary: z.string(),
	outstandingAmountInCents: z.number().int().nonnegative(),
	status: z.enum(["pending", "overdue"]),
	dueDate: z.iso.date(),
});

export const dashboardSnapshotSchema = z.object({
	asOf: z.iso.datetime({ offset: true }),
	permissions: z.object({
		canViewLeads: z.boolean(),
		canViewFinance: z.boolean(),
	}),
	metrics: z.object({
		followUpCount: z.number().int().nonnegative().nullable(),
		studentCount: z.number().int().nonnegative(),
		enrollmentCount: z.number().int().nonnegative(),
		activeClassCount: z.number().int().nonnegative(),
		dueTaskCount: z.number().int().nonnegative(),
		upcomingLessonCount: z.number().int().nonnegative(),
		pendingInvoiceCount: z.number().int().nonnegative().nullable(),
		outstandingAmountInCents: z.number().int().nonnegative().nullable(),
	}),
	followUps: z.array(dashboardFollowUpSchema),
	tasks: z.array(dashboardTaskSchema),
	upcomingLessons: z.array(dashboardLessonSchema),
	receivables: z.array(dashboardReceivableSchema),
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
