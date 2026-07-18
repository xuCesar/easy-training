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

const conversionCampusSchema = z.object({
	id: z.uuid(),
	name: z.string(),
});

const conversionCourseSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	listPriceInCents: z.number().int().nonnegative(),
	lessonsPerPackage: z.number().int().positive(),
});

const conversionClassSchema = z.object({
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

const invoiceSettlementStatusSchema = z.enum(["pending", "partial", "paid"]);
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
	status: z.enum(["all", "open", "pending", "partial", "paid"]).default("open"),
});

const invoiceSummarySchema = z.object({
	id: z.uuid(),
	studentId: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	amountInCents: z.number().int().nonnegative(),
	paidAmountInCents: z.number().int().nonnegative(),
	outstandingAmountInCents: z.number().int().nonnegative(),
	status: invoiceSettlementStatusSchema,
	isOverdue: z.boolean(),
	dueDate: z.iso.date(),
	issuedAt: z.iso.datetime({ offset: true }),
});

const paymentRecordSchema = z.object({
	id: z.uuid(),
	amountInCents: z.number().int().positive(),
	receivedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	referenceNo: z.string().nullable(),
	note: z.string().nullable(),
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
	historicalPaidAmountInCents: z.number().int().nonnegative(),
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

export type InvoiceListInput = z.infer<typeof invoiceListInputSchema>;
export type InvoiceListResult = z.infer<typeof invoiceListResultSchema>;
export type InvoiceDetailInput = z.infer<typeof invoiceDetailInputSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
export type CreatePaymentResult = z.infer<typeof createPaymentResultSchema>;

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
