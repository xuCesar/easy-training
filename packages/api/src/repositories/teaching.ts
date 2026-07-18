import {
	assignEnrollmentClassRecord,
	cancelLessonRecord,
	completeLessonRecord,
	createClassGroupRecord,
	createCourseRecord,
	createLessonRecord,
	createTeacherRecord,
	getLessonAttendanceRecord,
	listClassEnrollmentRecords,
	listClassGroupRecords,
	listCourseRecords,
	listLessonRecords,
	listTeacherRecords,
	setCourseActiveRecord,
	TeachingRepositoryError,
	updateClassGroupRecord,
	updateCourseRecord,
	updateTeacherRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	AssignEnrollmentClassInput,
	CancelLessonInput,
	ClassEnrollmentListInput,
	ClassGroup,
	ClassGroupListInput,
	CompleteLessonInput,
	Course,
	CourseListInput,
	CreateClassGroupInput,
	CreateCourseInput,
	CreateLessonInput,
	CreateTeacherInput,
	Lesson,
	LessonAttendanceInput,
	LessonListInput,
	SetCourseActiveInput,
	Teacher,
	UpdateClassGroupInput,
	UpdateCourseInput,
	UpdateTeacherInput,
} from "../contracts/training";

type TeachingScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listTeacherRecords>[0]["campusAccess"];
};

function toCourse(
	record: Awaited<ReturnType<typeof listCourseRecords>>[number],
): Course {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function toTeacher(
	record: Awaited<ReturnType<typeof listTeacherRecords>>[number],
): Teacher {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function toClassGroup(
	record: Awaited<ReturnType<typeof listClassGroupRecords>>[number],
): ClassGroup {
	return record;
}

function toLesson(
	record: Awaited<ReturnType<typeof listLessonRecords>>[number],
): Lesson {
	return {
		...record,
		startsAt: record.startsAt.toISOString(),
		endsAt: record.endsAt.toISOString(),
		cancelledAt: record.cancelledAt?.toISOString() ?? null,
	};
}

function throwTeachingError(error: unknown): never {
	if (!(error instanceof TeachingRepositoryError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理教务数据，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权操作该教务资源。",
			});
		case "COURSE_NOT_FOUND":
		case "TEACHER_NOT_FOUND":
		case "CLASS_NOT_FOUND":
		case "ENROLLMENT_NOT_FOUND":
		case "LESSON_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标教务资源不存在。" });
		case "CAMPUS_NOT_FOUND":
		case "INVALID_INPUT":
		case "LESSON_TIME_INVALID":
			throw new ORPCError("BAD_REQUEST", { message: "请检查提交的教务信息。" });
		case "COURSE_DUPLICATE":
			throw new ORPCError("CONFLICT", { message: "课程编码已被使用。" });
		case "COURSE_DURATION_LOCKED":
			throw new ORPCError("CONFLICT", {
				message: "课程已有报名或课次，不能修改单次时长。",
			});
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续写入。",
			});
		case "COURSE_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "课程已停用，不能用于此操作。",
			});
		case "TEACHER_CAMPUS_MISMATCH":
			throw new ORPCError("CONFLICT", { message: "教师未归属到所选校区。" });
		case "CLASS_LOCKED":
			throw new ORPCError("CONFLICT", {
				message: "班级已有报名或课次，不能变更课程或校区。",
			});
		case "CLASS_CAPACITY_TOO_LOW":
			throw new ORPCError("CONFLICT", {
				message: "班级容量不能低于现有报名人数。",
			});
		case "CLASS_FULL":
			throw new ORPCError("CONFLICT", { message: "班级容量已满。" });
		case "CLASS_COURSE_MISMATCH":
			throw new ORPCError("CONFLICT", {
				message: "报名课程与目标班级课程不一致。",
			});
		case "CLASS_CAMPUS_MISMATCH":
			throw new ORPCError("CONFLICT", {
				message: "学员所属校区与目标班级校区不一致。",
			});
		case "CLASS_STUDENT_DUPLICATE":
			throw new ORPCError("CONFLICT", {
				message: "该学员已在目标班级中，不能重复入班。",
			});
		case "CLASS_NOT_SCHEDULABLE":
			throw new ORPCError("CONFLICT", {
				message: "当前班级状态不能新增课次。",
			});
		case "LESSON_DURATION_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "课次时长必须与课程标准时长一致。",
			});
		case "LESSON_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "教师或教室在该时段已有课次。",
			});
		case "LESSON_NOT_CANCELLABLE":
			throw new ORPCError("CONFLICT", { message: "仅可取消已排课次。" });
		case "LESSON_COMPLETION_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "仅可为已排课次登记完整考勤并结课。",
			});
		case "LESSON_CONSUMPTION_INSUFFICIENT":
			throw new ORPCError("CONFLICT", {
				message: "存在剩余课时不足的学员，无法完成结课。",
			});
	}
}

export async function listCourses(
	scope: TeachingScope,
	input: CourseListInput,
) {
	return {
		items: (
			await listCourseRecords({
				organizationId: scope.organizationId,
				...input,
			})
		).map(toCourse),
	};
}
export async function createCourse(
	scope: TeachingScope,
	input: CreateCourseInput,
) {
	try {
		return toCourse(
			await createCourseRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateCourse(
	scope: TeachingScope,
	input: UpdateCourseInput,
) {
	try {
		return toCourse(
			await updateCourseRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				data: input.data,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function setCourseActive(
	scope: TeachingScope,
	input: SetCourseActiveInput,
) {
	try {
		return toCourse(
			await setCourseActiveRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listTeachers(scope: TeachingScope) {
	return { items: (await listTeacherRecords(scope)).map(toTeacher) };
}
export async function createTeacher(
	scope: TeachingScope,
	input: CreateTeacherInput,
) {
	try {
		return toTeacher(
			await createTeacherRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateTeacher(
	scope: TeachingScope,
	input: UpdateTeacherInput,
) {
	try {
		return toTeacher(
			await updateTeacherRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				...input.data,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listClassGroups(
	scope: TeachingScope,
	input: ClassGroupListInput,
) {
	return {
		items: (
			await listClassGroupRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				...input,
			})
		).map(toClassGroup),
	};
}
export async function createClassGroup(
	scope: TeachingScope,
	input: CreateClassGroupInput,
) {
	try {
		return toClassGroup(
			await createClassGroupRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateClassGroup(
	scope: TeachingScope,
	input: UpdateClassGroupInput,
) {
	try {
		return toClassGroup(
			await updateClassGroupRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				...input.data,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listClassEnrollments(
	scope: TeachingScope,
	input: ClassEnrollmentListInput,
) {
	try {
		return {
			items: await listClassEnrollmentRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				classGroupId: input.id,
			}),
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function assignEnrollmentClass(
	scope: TeachingScope,
	input: AssignEnrollmentClassInput,
) {
	try {
		await assignEnrollmentClassRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { enrollmentId: input.enrollmentId };
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listLessons(
	scope: TeachingScope,
	input: LessonListInput,
) {
	return {
		items: (
			await listLessonRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				campusId: input.campusId,
				classGroupId: input.classGroupId,
				from: input.from ? new Date(input.from) : undefined,
				to: input.to ? new Date(input.to) : undefined,
			})
		).map(toLesson),
	};
}
export async function createLesson(
	scope: TeachingScope,
	input: CreateLessonInput,
) {
	try {
		return toLesson(
			await createLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				classGroupId: input.classGroupId,
				room: input.room,
				startsAt: new Date(input.startsAt),
				endsAt: new Date(input.endsAt),
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function getLessonAttendance(
	scope: TeachingScope,
	input: LessonAttendanceInput,
) {
	try {
		const record = await getLessonAttendanceRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			id: input.id,
		});
		return {
			lesson: toLesson(record.lesson),
			members: record.members,
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function completeLesson(
	scope: TeachingScope,
	input: CompleteLessonInput,
) {
	try {
		return toLesson(
			await completeLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function cancelLesson(
	scope: TeachingScope,
	input: CancelLessonInput,
) {
	try {
		return toLesson(
			await cancelLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				reason: input.reason,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
