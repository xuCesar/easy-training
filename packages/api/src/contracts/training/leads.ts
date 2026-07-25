import { z } from "zod";

import type { EntityId } from "./shared";
import { validateLeadImportRpcBodySize } from "./shared";

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
	providerUserId: EntityId | null;
	providerName: string;
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
	providerUserId: z.string().min(1).max(255).nullable().optional(),
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

export const leadRecordSchema = z.object({
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
	providerUserId: z.string().nullable(),
	providerName: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const leadListResultSchema = z.object({
	items: z.array(leadRecordSchema),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

export const leadDetailInputSchema = z.object({ id: z.uuid() });

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
const leadImportCampusInputSchema = z.object({
	// campusId 保留给已发布的导入界面；新调用方使用语义更明确的 defaultCampusId。
	campusId: nullableUuidSchema.optional(),
	defaultCampusId: nullableUuidSchema.optional(),
});
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
export type LeadDetailInput = z.infer<typeof leadDetailInputSchema>;
export type CreateLeadInput = z.infer<typeof createLeadInputSchema>;
export type CreateLeadResult = z.infer<typeof createLeadResultSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadInputSchema>;
export type AddLeadFollowUpInput = z.infer<typeof addLeadFollowUpInputSchema>;
export type LeadHistoryInput = z.infer<typeof leadHistoryInputSchema>;
export type LeadHistoryResult = z.infer<typeof leadHistoryResultSchema>;
export type LeadFilterOptions = z.infer<typeof leadFilterOptionsSchema>;
export type ExportLeadsInput = z.infer<typeof exportLeadsInputSchema>;
export type ExportLeadsResult = z.infer<typeof exportLeadsResultSchema>;
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
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
});

const conversionStudentSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	guardianName: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	status: z.enum(["active", "trial", "paused", "graduated", "atRisk"]),
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
	version: z.number().int().positive(),
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
		canAdjustStudentOwner: z.boolean(),
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
		expectedVersion: z.number().int().positive(),
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
	conversionOwnerUserId: z.string().min(1).max(255).nullable().default(null),
	adjustStudentOwner: z.boolean().default(false),
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
