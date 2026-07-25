import { z } from "zod";

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
	targetId: z.uuid().optional(),
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
	capacityEffectiveFrom: z.iso.date().optional(),
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
	capacityEffectiveFrom: z.iso.date().optional(),
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
	targetId: z.uuid().optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});
export const classGroupListResultSchema = z.object({
	items: z.array(classGroupSchema),
	nextCursor: z.string().nullable(),
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
	targetId: z.uuid().optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});
export const lessonListResultSchema = z.object({
	items: z.array(lessonSchema),
	nextCursor: z.string().nullable(),
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
	targetId: z.uuid().optional(),
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
