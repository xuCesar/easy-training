import { z } from "zod";

import { invoiceSourceSchema } from "./finance";
import { organizationRoleSchema } from "./organization";
import { validateLeadImportRpcBodySize } from "./shared";

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
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
	version: z.number().int().positive(),
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
	ownerUserId: z
		.union([z.string().min(1).max(255), z.literal("unassigned")])
		.optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

export const studentListResultSchema = z.object({
	items: z.array(studentSummarySchema),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

export const studentDetailInputSchema = z.object({ id: z.uuid() });
export const studentOwnerCandidateListInputSchema = z.object({
	campusId: z.uuid(),
});
export const studentOwnerCandidateListResultSchema = z.object({
	items: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.email(),
			role: organizationRoleSchema.extract([
				"owner",
				"admin",
				"campus_manager",
				"consultant",
			]),
		}),
	),
});
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
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
	version: z.number().int().positive(),
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
		z.enum([
			"name",
			"campusId",
			"birthDate",
			"status",
			"ownerUserId",
			"primaryContactId",
		]),
	),
	blockingReasons: z.array(
		z.enum(["ACTIVE_COURSE_ENROLLMENT", "ATTENDANCE_CONFLICT"]),
	),
});
export const mergeStudentsInputSchema = z.object({
	sourceStudentId: z.uuid(),
	targetStudentId: z.uuid(),
	expectedSourceVersion: z.number().int().positive(),
	expectedTargetVersion: z.number().int().positive(),
	requestId: z.uuid(),
	fieldSources: z.object({
		name: z.enum(["source", "target"]),
		campusId: z.enum(["source", "target"]),
		birthDate: z.enum(["source", "target"]),
		status: z.enum(["source", "target"]),
		ownerUserId: z.enum(["source", "target"]),
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
	ownerUserId: z.string().min(1).max(255).nullable().default(null),
	contacts: studentContactsSchema,
	tagIds: z.array(z.uuid()).max(30).default([]),
});

export const updateStudentInputSchema = z.object({
	id: z.uuid(),
	expectedVersion: z.number().int().positive(),
	data: z.object({
		name: z.string().trim().min(1).max(50),
		birthDate: z.iso.date().nullable(),
		status: studentStatusSchema,
		ownerUserId: z.string().min(1).max(255).nullable(),
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

const studentImportErrorSchema = z.object({
	row: z.number().int().positive(),
	code: z.enum([
		"INVALID_ROW",
		"FORMULA_VALUE",
		"DUPLICATE_IN_FILE",
		"DUPLICATE_EXISTING",
		"DUPLICATE_RESTRICTED",
		"CAMPUS_INVALID",
		"OWNER_INVALID",
		"TAG_INVALID",
	]),
	message: z.string(),
	duplicateCandidate: z
		.object({
			id: z.uuid(),
			name: z.string(),
			phoneMasked: z.string(),
		})
		.nullable()
		.optional(),
});

export const studentImportTemplateResultSchema = z.object({
	fileName: z.string(),
	csv: z.string(),
});
export const previewStudentImportInputSchema = z
	.object({ content: z.string() })
	.superRefine(validateLeadImportRpcBodySize);
export const previewStudentImportResultSchema = z.object({
	totalRows: z.number().int().nonnegative(),
	validRows: z.number().int().nonnegative(),
	errors: z.array(studentImportErrorSchema),
});
export const confirmStudentImportInputSchema = z
	.object({ requestId: z.uuid(), content: z.string() })
	.superRefine(validateLeadImportRpcBodySize);
export const confirmStudentImportResultSchema = z.object({
	batchId: z.uuid(),
	importedRows: z.number().int().nonnegative(),
	errorRows: z.number().int().nonnegative(),
	errors: z.array(studentImportErrorSchema),
	replayed: z.boolean(),
});
export const exportStudentsInputSchema = studentListInputSchema
	.omit({ cursor: true, pageSize: true })
	.extend({ limit: z.number().int().min(1).max(5_000).default(5_000) });
export const exportStudentsResultSchema = z.object({
	fileName: z.string(),
	csv: z.string(),
});

const studentBulkTargetsSchema = z
	.array(
		z.object({
			studentId: z.uuid(),
			expectedVersion: z.number().int().positive(),
		}),
	)
	.min(1)
	.max(200)
	.refine(
		(targets) =>
			new Set(targets.map((target) => target.studentId)).size ===
			targets.length,
		"批量目标不能重复",
	);
export const studentBulkOperationKindSchema = z.enum([
	"setStudentOwner",
	"clearStudentOwner",
	"addStudentTag",
	"removeStudentTag",
]);
const studentBulkPreviewVariantSchemas = [
	z.object({
		kind: z.literal("setStudentOwner"),
		targets: studentBulkTargetsSchema,
		ownerUserId: z.string().min(1).max(255),
	}),
	z.object({
		kind: z.literal("clearStudentOwner"),
		targets: studentBulkTargetsSchema,
	}),
	z.object({
		kind: z.literal("addStudentTag"),
		targets: studentBulkTargetsSchema,
		tagId: z.uuid(),
	}),
	z.object({
		kind: z.literal("removeStudentTag"),
		targets: studentBulkTargetsSchema,
		tagId: z.uuid(),
	}),
] as const;
export const previewStudentBulkOperationInputSchema = z.discriminatedUnion(
	"kind",
	studentBulkPreviewVariantSchemas,
);
const studentBulkBlockerCodeSchema = z.enum([
	"STUDENT_NOT_FOUND",
	"CAMPUS_OUT_OF_SCOPE",
	"STUDENT_VERSION_CONFLICT",
	"STUDENT_OWNER_NOT_ELIGIBLE",
	"STUDENT_TAG_NOT_FOUND",
	"STUDENT_TAG_INACTIVE",
]);
const studentBulkPreviewItemSchema = z.object({
	studentId: z.uuid(),
	studentName: z.string().nullable(),
	status: z.enum(["change", "no_change", "blocked"]),
	blockerCode: studentBulkBlockerCodeSchema.nullable(),
	before: z.string().nullable(),
	after: z.string().nullable(),
});
export const previewStudentBulkOperationResultSchema = z.object({
	items: z.array(studentBulkPreviewItemSchema),
	changeCount: z.number().int().nonnegative(),
	noChangeCount: z.number().int().nonnegative(),
	blockedCount: z.number().int().nonnegative(),
});
export const commitStudentBulkOperationInputSchema = z.discriminatedUnion(
	"kind",
	[
		studentBulkPreviewVariantSchemas[0].extend({ requestId: z.uuid() }),
		studentBulkPreviewVariantSchemas[1].extend({ requestId: z.uuid() }),
		studentBulkPreviewVariantSchemas[2].extend({ requestId: z.uuid() }),
		studentBulkPreviewVariantSchemas[3].extend({ requestId: z.uuid() }),
	],
);
export const commitStudentBulkOperationResultSchema = z.object({
	batchId: z.uuid(),
	changedCount: z.number().int().nonnegative(),
	unchangedCount: z.number().int().nonnegative(),
	replayed: z.boolean(),
});

export const studentActiveEnrollmentOptionsInputSchema = z.object({
	studentIds: z
		.array(z.uuid())
		.min(1)
		.max(200)
		.refine(
			(studentIds) => new Set(studentIds).size === studentIds.length,
			"学员目标不能重复",
		),
});
export const studentActiveEnrollmentOptionsResultSchema = z.object({
	items: z.array(
		z.object({
			enrollmentId: z.uuid(),
			studentId: z.uuid(),
			studentName: z.string(),
			studentCampusId: z.uuid(),
			courseId: z.uuid(),
			courseName: z.string(),
			classGroupId: z.uuid().nullable(),
			className: z.string().nullable(),
			version: z.number().int().positive(),
		}),
	),
});
const enrollmentBulkTargetsSchema = z
	.array(
		z.object({
			enrollmentId: z.uuid(),
			expectedVersion: z.number().int().positive(),
		}),
	)
	.min(1)
	.max(200)
	.refine(
		(targets) =>
			new Set(targets.map((target) => target.enrollmentId)).size ===
			targets.length,
		"报名目标不能重复",
	);
const enrollmentBulkPreviewVariantSchemas = [
	z.object({
		kind: z.literal("assignEnrollmentClass"),
		targets: enrollmentBulkTargetsSchema,
		classGroupId: z.uuid(),
	}),
	z.object({
		kind: z.literal("withdrawEnrollmentClass"),
		targets: enrollmentBulkTargetsSchema,
	}),
] as const;
export const previewEnrollmentBulkOperationInputSchema = z.discriminatedUnion(
	"kind",
	enrollmentBulkPreviewVariantSchemas,
);
const enrollmentBulkBlockerCodeSchema = z.enum([
	"ENROLLMENT_NOT_FOUND",
	"CAMPUS_OUT_OF_SCOPE",
	"ENROLLMENT_VERSION_CONFLICT",
	"ENROLLMENT_NOT_ACTIVE",
	"CLASS_NOT_FOUND",
	"CLASS_COURSE_MISMATCH",
	"CLASS_CAMPUS_MISMATCH",
	"CLASS_NOT_AVAILABLE",
	"CLASS_FULL",
	"CLASS_STUDENT_DUPLICATE",
]);
const enrollmentBulkPreviewItemSchema = z.object({
	enrollmentId: z.uuid(),
	studentId: z.uuid().nullable(),
	studentName: z.string().nullable(),
	courseName: z.string().nullable(),
	status: z.enum(["change", "no_change", "blocked"]),
	blockerCode: enrollmentBulkBlockerCodeSchema.nullable(),
	beforeClassGroupId: z.uuid().nullable(),
	beforeClassName: z.string().nullable(),
	afterClassGroupId: z.uuid().nullable(),
	afterClassName: z.string().nullable(),
});
export const previewEnrollmentBulkOperationResultSchema = z.object({
	items: z.array(enrollmentBulkPreviewItemSchema),
	changeCount: z.number().int().nonnegative(),
	noChangeCount: z.number().int().nonnegative(),
	blockedCount: z.number().int().nonnegative(),
});
export const commitEnrollmentBulkOperationInputSchema = z.discriminatedUnion(
	"kind",
	[
		enrollmentBulkPreviewVariantSchemas[0].extend({ requestId: z.uuid() }),
		enrollmentBulkPreviewVariantSchemas[1].extend({ requestId: z.uuid() }),
	],
);
export const commitEnrollmentBulkOperationResultSchema = z.object({
	batchId: z.uuid(),
	changedCount: z.number().int().nonnegative(),
	unchangedCount: z.number().int().nonnegative(),
	replayed: z.boolean(),
});

export type StudentStatus = z.infer<typeof studentStatusSchema>;
export type StudentTag = z.infer<typeof studentTagSchema>;
export type StudentDetail = z.infer<typeof studentDetailSchema>;
export type StudentTimelineInput = z.infer<typeof studentTimelineInputSchema>;
export type StudentTimelineResult = z.infer<typeof studentTimelineResultSchema>;
export type StudentListInput = z.infer<typeof studentListInputSchema>;
export type StudentOwnerCandidateListInput = z.infer<
	typeof studentOwnerCandidateListInputSchema
>;
export type StudentOwnerCandidateListResult = z.infer<
	typeof studentOwnerCandidateListResultSchema
>;
export type PreviewStudentImportInput = z.infer<
	typeof previewStudentImportInputSchema
>;
export type PreviewStudentImportResult = z.infer<
	typeof previewStudentImportResultSchema
>;
export type ConfirmStudentImportInput = z.infer<
	typeof confirmStudentImportInputSchema
>;
export type ConfirmStudentImportResult = z.infer<
	typeof confirmStudentImportResultSchema
>;
export type ExportStudentsInput = z.infer<typeof exportStudentsInputSchema>;
export type ExportStudentsResult = z.infer<typeof exportStudentsResultSchema>;
export type PreviewStudentBulkOperationInput = z.infer<
	typeof previewStudentBulkOperationInputSchema
>;
export type PreviewStudentBulkOperationResult = z.infer<
	typeof previewStudentBulkOperationResultSchema
>;
export type CommitStudentBulkOperationInput = z.infer<
	typeof commitStudentBulkOperationInputSchema
>;
export type CommitStudentBulkOperationResult = z.infer<
	typeof commitStudentBulkOperationResultSchema
>;
export type StudentActiveEnrollmentOptionsInput = z.infer<
	typeof studentActiveEnrollmentOptionsInputSchema
>;
export type StudentActiveEnrollmentOptionsResult = z.infer<
	typeof studentActiveEnrollmentOptionsResultSchema
>;
export type PreviewEnrollmentBulkOperationInput = z.infer<
	typeof previewEnrollmentBulkOperationInputSchema
>;
export type PreviewEnrollmentBulkOperationResult = z.infer<
	typeof previewEnrollmentBulkOperationResultSchema
>;
export type CommitEnrollmentBulkOperationInput = z.infer<
	typeof commitEnrollmentBulkOperationInputSchema
>;
export type CommitEnrollmentBulkOperationResult = z.infer<
	typeof commitEnrollmentBulkOperationResultSchema
>;
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
