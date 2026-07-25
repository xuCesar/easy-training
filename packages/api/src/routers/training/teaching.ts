import {
	assignEnrollmentClassInputSchema,
	assignEnrollmentClassResultSchema,
	bindableTeacherMemberListResultSchema,
	bulkUpdateLessonsInputSchema,
	bulkUpdateLessonsResultSchema,
	cancelLessonInputSchema,
	cancelMakeupLessonInputSchema,
	classEnrollmentListInputSchema,
	classEnrollmentListResultSchema,
	classGroupListInputSchema,
	classGroupListResultSchema,
	classroomListInputSchema,
	classroomListResultSchema,
	completeLessonInputSchema,
	courseListInputSchema,
	courseListResultSchema,
	createClassGroupInputSchema,
	createClassroomInputSchema,
	createCourseInputSchema,
	createLessonInputSchema,
	createMakeupLessonInputSchema,
	createScheduleRuleInputSchema,
	createTeacherInputSchema,
	deactivateScheduleRuleInputSchema,
	deactivateScheduleRuleResultSchema,
	deleteScheduleRuleInputSchema,
	deleteScheduleRuleResultSchema,
	generateScheduleLessonsInputSchema,
	generateScheduleLessonsResultSchema,
	lessonAttendanceInputSchema,
	lessonAttendanceResultSchema,
	lessonListInputSchema,
	lessonListResultSchema,
	makeupLessonListInputSchema,
	makeupLessonListResultSchema,
	makeupLessonMutationResultSchema,
	pauseClassGroupInputSchema,
	pauseClassGroupResultSchema,
	previewBulkLessonUpdateInputSchema,
	previewBulkLessonUpdateResultSchema,
	previewScheduleGenerationInputSchema,
	previewScheduleGenerationResultSchema,
	previewScheduleRuleDeactivationInputSchema,
	previewScheduleRuleDeactivationResultSchema,
	previewScheduleRuleUpdateInputSchema,
	previewScheduleRuleUpdateResultSchema,
	resumeClassGroupInputSchema,
	resumeClassGroupResultSchema,
	saveLessonAttendanceDraftInputSchema,
	scheduleRuleListInputSchema,
	scheduleRuleListResultSchema,
	setClassroomActiveInputSchema,
	setCourseActiveInputSchema,
	teacherListResultSchema,
	teacherWorkspaceInputSchema,
	teacherWorkspaceResultSchema,
	updateClassGroupInputSchema,
	updateClassroomInputSchema,
	updateCourseInputSchema,
	updateScheduleRuleInputSchema,
	updateScheduleRuleResultSchema,
	updateTeacherInputSchema,
} from "../../contracts/training";
import {
	academicManagementProcedure,
	organizationManagementProcedure,
	organizationProcedure,
	teacherWorkspaceProcedure,
} from "../../index";
import {
	createClassroom,
	listClassrooms,
	setClassroomActive,
	updateClassroom,
} from "../../repositories/classrooms";
import {
	assignEnrollmentClass,
	bulkUpdateLessons,
	cancelLesson,
	cancelMakeupLesson,
	completeLesson,
	createClassGroup,
	createCourse,
	createLesson,
	createMakeupLesson,
	createScheduleRule,
	createTeacher,
	deactivateScheduleRule,
	deleteScheduleRule,
	generateScheduleLessons,
	getLessonAttendance,
	getTeacherLessonAttendance,
	getTeacherWorkspace,
	listBindableTeacherMembers,
	listClassEnrollments,
	listClassGroups,
	listCourses,
	listLessons,
	listMakeupLessons,
	listScheduleRules,
	listTeachers,
	pauseClassGroup,
	previewBulkLessonUpdate,
	previewScheduleGeneration,
	previewScheduleRuleDeactivation,
	previewScheduleRuleUpdate,
	resumeClassGroup,
	saveLessonAttendanceDraft,
	setCourseActive,
	updateClassGroup,
	updateCourse,
	updateScheduleRule,
	updateTeacher,
} from "../../repositories/teaching";

export const teachingRouter = {
	classrooms: {
		list: academicManagementProcedure
			.input(classroomListInputSchema)
			.output(classroomListResultSchema)
			.handler(({ context, input }) =>
				listClassrooms(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createClassroomInputSchema)
			.output(classroomListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createClassroom(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: academicManagementProcedure
			.input(updateClassroomInputSchema)
			.output(classroomListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				updateClassroom(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		setActive: academicManagementProcedure
			.input(setClassroomActiveInputSchema)
			.output(classroomListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				setClassroomActive(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	courses: {
		list: organizationProcedure
			.input(courseListInputSchema)
			.output(courseListResultSchema)
			.handler(({ context, input }) =>
				listCourses(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createCourseInputSchema)
			.output(courseListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createCourse(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: academicManagementProcedure
			.input(updateCourseInputSchema)
			.output(courseListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				updateCourse(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		setActive: academicManagementProcedure
			.input(setCourseActiveInputSchema)
			.output(courseListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				setCourseActive(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	teachers: {
		list: organizationProcedure
			.output(teacherListResultSchema)
			.handler(({ context }) =>
				listTeachers({
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				}),
			),
		create: academicManagementProcedure
			.input(createTeacherInputSchema)
			.output(teacherListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createTeacher(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: academicManagementProcedure
			.input(updateTeacherInputSchema)
			.output(teacherListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				updateTeacher(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		bindableMembers: organizationManagementProcedure
			.output(bindableTeacherMemberListResultSchema)
			.handler(({ context }) =>
				listBindableTeacherMembers({
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				}),
			),
	},
	scheduleRules: {
		list: academicManagementProcedure
			.input(scheduleRuleListInputSchema)
			.output(scheduleRuleListResultSchema)
			.handler(({ context, input }) =>
				listScheduleRules(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createScheduleRuleInputSchema)
			.output(scheduleRuleListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createScheduleRule(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		previewGenerate: academicManagementProcedure
			.input(previewScheduleGenerationInputSchema)
			.output(previewScheduleGenerationResultSchema)
			.handler(({ context, input }) =>
				previewScheduleGeneration(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		generate: academicManagementProcedure
			.input(generateScheduleLessonsInputSchema)
			.output(generateScheduleLessonsResultSchema)
			.handler(({ context, input }) =>
				generateScheduleLessons(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		previewUpdate: academicManagementProcedure
			.input(previewScheduleRuleUpdateInputSchema)
			.output(previewScheduleRuleUpdateResultSchema)
			.handler(({ context, input }) =>
				previewScheduleRuleUpdate(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: academicManagementProcedure
			.input(updateScheduleRuleInputSchema)
			.output(updateScheduleRuleResultSchema)
			.handler(({ context, input }) =>
				updateScheduleRule(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		previewDeactivate: academicManagementProcedure
			.input(previewScheduleRuleDeactivationInputSchema)
			.output(previewScheduleRuleDeactivationResultSchema)
			.handler(({ context, input }) =>
				previewScheduleRuleDeactivation(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		deactivate: academicManagementProcedure
			.input(deactivateScheduleRuleInputSchema)
			.output(deactivateScheduleRuleResultSchema)
			.handler(({ context, input }) =>
				deactivateScheduleRule(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		delete: academicManagementProcedure
			.input(deleteScheduleRuleInputSchema)
			.output(deleteScheduleRuleResultSchema)
			.handler(({ context, input }) =>
				deleteScheduleRule(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	classes: {
		list: academicManagementProcedure
			.input(classGroupListInputSchema)
			.output(classGroupListResultSchema)
			.handler(({ context, input }) =>
				listClassGroups(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createClassGroupInputSchema)
			.output(classGroupListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createClassGroup(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: academicManagementProcedure
			.input(updateClassGroupInputSchema)
			.output(classGroupListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				updateClassGroup(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		pause: academicManagementProcedure
			.input(pauseClassGroupInputSchema)
			.output(pauseClassGroupResultSchema)
			.handler(({ context, input }) =>
				pauseClassGroup(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		resume: academicManagementProcedure
			.input(resumeClassGroupInputSchema)
			.output(resumeClassGroupResultSchema)
			.handler(({ context, input }) =>
				resumeClassGroup(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		enrollments: academicManagementProcedure
			.input(classEnrollmentListInputSchema)
			.output(classEnrollmentListResultSchema)
			.handler(({ context, input }) =>
				listClassEnrollments(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		assignEnrollment: academicManagementProcedure
			.input(assignEnrollmentClassInputSchema)
			.output(assignEnrollmentClassResultSchema)
			.handler(({ context, input }) =>
				assignEnrollmentClass(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	lessons: {
		list: academicManagementProcedure
			.input(lessonListInputSchema)
			.output(lessonListResultSchema)
			.handler(({ context, input }) =>
				listLessons(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createLessonInputSchema)
			.output(lessonListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		previewBulkUpdate: academicManagementProcedure
			.input(previewBulkLessonUpdateInputSchema)
			.output(previewBulkLessonUpdateResultSchema)
			.handler(({ context, input }) =>
				previewBulkLessonUpdate(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		bulkUpdate: academicManagementProcedure
			.input(bulkUpdateLessonsInputSchema)
			.output(bulkUpdateLessonsResultSchema)
			.handler(({ context, input }) =>
				bulkUpdateLessons(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		attendance: academicManagementProcedure
			.input(lessonAttendanceInputSchema)
			.output(lessonAttendanceResultSchema)
			.handler(({ context, input }) =>
				getLessonAttendance(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		saveDraft: academicManagementProcedure
			.input(saveLessonAttendanceDraftInputSchema)
			.output(lessonAttendanceResultSchema)
			.handler(({ context, input }) =>
				saveLessonAttendanceDraft(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		complete: academicManagementProcedure
			.input(completeLessonInputSchema)
			.output(lessonListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				completeLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		cancel: academicManagementProcedure
			.input(cancelLessonInputSchema)
			.output(lessonListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				cancelLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	makeups: {
		list: academicManagementProcedure
			.input(makeupLessonListInputSchema)
			.output(makeupLessonListResultSchema)
			.handler(({ context, input }) =>
				listMakeupLessons(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: academicManagementProcedure
			.input(createMakeupLessonInputSchema)
			.output(makeupLessonMutationResultSchema)
			.handler(({ context, input }) =>
				createMakeupLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		cancel: academicManagementProcedure
			.input(cancelMakeupLessonInputSchema)
			.output(makeupLessonMutationResultSchema)
			.handler(({ context, input }) =>
				cancelMakeupLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	teacherWorkspace: {
		lessons: teacherWorkspaceProcedure
			.input(teacherWorkspaceInputSchema)
			.output(teacherWorkspaceResultSchema)
			.handler(({ context, input }) =>
				getTeacherWorkspace(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		attendance: teacherWorkspaceProcedure
			.input(lessonAttendanceInputSchema)
			.output(lessonAttendanceResultSchema)
			.handler(({ context, input }) =>
				getTeacherLessonAttendance(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		saveDraft: teacherWorkspaceProcedure
			.input(saveLessonAttendanceDraftInputSchema)
			.output(lessonAttendanceResultSchema)
			.handler(({ context, input }) =>
				saveLessonAttendanceDraft(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		complete: teacherWorkspaceProcedure
			.input(completeLessonInputSchema)
			.output(lessonListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				completeLesson(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
};
