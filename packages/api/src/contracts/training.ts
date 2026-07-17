import { z } from "zod";

export type EntityId = string;

export type LeadStage =
	| "new"
	| "contacted"
	| "trialBooked"
	| "enrolled"
	| "lost";

export type LeadRecordStage = Exclude<LeadStage, "enrolled">;

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

const leadStageSchema = z.enum(["new", "contacted", "trialBooked", "lost"]);

const nullableUuidSchema = z.uuid().nullable();

const createLeadDataSchema = z.object({
	name: z.string().trim().min(1).max(50),
	phone: z.string().trim().min(5).max(30),
	source: z.string().trim().min(1).max(50),
	stage: leadStageSchema.default("new"),
	campusId: nullableUuidSchema.default(null),
	interestedCourseId: nullableUuidSchema.default(null),
	nextFollowAt: z.iso.datetime({ offset: true }).nullable().default(null),
	note: z.string().trim().max(1000).nullable().default(null),
});

const updateLeadDataSchema = z
	.object({
		name: z.string().trim().min(1).max(50).optional(),
		phone: z.string().trim().min(5).max(30).optional(),
		source: z.string().trim().min(1).max(50).optional(),
		stage: leadStageSchema.optional(),
		campusId: nullableUuidSchema.optional(),
		interestedCourseId: nullableUuidSchema.optional(),
		nextFollowAt: z.iso.datetime({ offset: true }).nullable().optional(),
		note: z.string().trim().max(1000).nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, {
		message: "至少提供一个待更新字段",
	});

export const leadListInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	stage: z
		.enum(["all", "new", "contacted", "trialBooked", "lost"])
		.default("all"),
});

export const createLeadInputSchema = createLeadDataSchema;

export const updateLeadInputSchema = z.object({
	id: z.uuid(),
	data: updateLeadDataSchema,
});

export type LeadListInput = z.infer<typeof leadListInputSchema>;
export type CreateLeadInput = z.infer<typeof createLeadInputSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadInputSchema>;

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
});

export const convertLeadResultSchema = z.object({
	leadId: z.uuid(),
	studentId: z.uuid(),
	enrollmentId: z.uuid(),
	classGroupId: z.uuid().nullable(),
});

export type LeadConversionOptionsInput = z.infer<
	typeof leadConversionOptionsInputSchema
>;
export type LeadConversionOptions = z.infer<typeof leadConversionOptionsSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadInputSchema>;
export type ConvertLeadResult = z.infer<typeof convertLeadResultSchema>;

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
