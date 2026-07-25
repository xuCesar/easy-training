export {
	completeLessonRecord,
	getLessonAttendanceRecord,
	getTeacherLessonAttendanceRecord,
	getTeacherWorkspaceRecord,
	type LessonAttendanceInput,
	type LessonAttendanceRecord,
	saveLessonAttendanceDraftRecord,
	type TeacherWorkspaceRecord,
} from "./teaching-attendance";
export {
	type BindableTeacherMemberRecord,
	type CourseRecord,
	createCourseRecord,
	createTeacherRecord,
	listBindableTeacherMemberRecords,
	listCourseRecords,
	listTeacherRecords,
	setCourseActiveRecord,
	type TeacherRecord,
	updateCourseRecord,
	updateTeacherRecord,
} from "./teaching-catalog";
export {
	assignEnrollmentClassRecord,
	type ClassEnrollmentRecord,
	type ClassGroupRecord,
	createClassGroupRecord,
	listClassEnrollmentRecords,
	listClassGroupRecords,
	pauseClassGroupRecord,
	resumeClassGroupRecord,
	updateClassGroupRecord,
} from "./teaching-classes";
export {
	academicWriteRoles,
	assertCourseActive,
	assertTeacherForCampus,
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	markMakeupLessonsNeedsReschedule,
	normalizeRoom,
	resolveActiveClassroom,
	TeachingRepositoryError,
	type TeachingRepositoryErrorCode,
	type Transaction,
} from "./teaching-foundation";
export {
	cancelLessonRecord,
	createLessonRecord,
	type LessonRecord,
	listLessonRecords,
} from "./teaching-lessons";
export {
	cancelMakeupLessonRecord,
	createMakeupLessonRecord,
	listMakeupLessonRecords,
	type MakeupLessonRecord,
} from "./teaching-makeups";
