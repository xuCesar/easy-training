import { Buffer } from "node:buffer";

import {
	type listClassGroupRecords,
	type listCourseRecords,
	type listLessonRecords,
	type listMakeupLessonRecords,
	type listScheduleRuleRecords,
	type listTeacherRecords,
	TeachingRepositoryError,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	ClassGroup,
	Course,
	Lesson,
	MakeupLesson,
	ScheduleRule,
	Teacher,
} from "../contracts/training";

export type TeachingScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listTeacherRecords>[0]["campusAccess"];
};

export function appendTarget<T extends { id: string }>(
	items: T[],
	target: T | undefined,
) {
	if (!target || items.some((item) => item.id === target.id)) return items;
	return [...items, target];
}

export type ClassGroupRecord = Awaited<
	ReturnType<typeof listClassGroupRecords>
>[number];
export type LessonRecord = Awaited<
	ReturnType<typeof listLessonRecords>
>[number];

export function encodeCursor(value: Record<string, string>): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function encodeClassGroupCursor(record: ClassGroupRecord): string {
	return encodeCursor({
		startDate: record.startDate,
		name: record.name,
		id: record.id,
	});
}

export function encodeLessonCursor(record: LessonRecord): string {
	return encodeCursor({
		startsAt: record.startsAt.toISOString(),
		id: record.id,
	});
}

export function throwTargetNotFound(): never {
	throw new ORPCError("NOT_FOUND", {
		message: "目标记录不存在或当前账号无权访问。",
	});
}

export function toCourse(
	record: Awaited<ReturnType<typeof listCourseRecords>>[number],
): Course {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function toTeacher(
	record: Awaited<ReturnType<typeof listTeacherRecords>>[number],
): Teacher {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function toClassGroup(
	record: Awaited<ReturnType<typeof listClassGroupRecords>>[number],
): ClassGroup {
	return record;
}

export function toLesson(
	record: Awaited<ReturnType<typeof listLessonRecords>>[number],
): Lesson {
	return {
		...record,
		startsAt: record.startsAt.toISOString(),
		endsAt: record.endsAt.toISOString(),
		cancelledAt: record.cancelledAt?.toISOString() ?? null,
		completedAt: record.completedAt?.toISOString() ?? null,
	};
}

export function toScheduleRule(
	record: Awaited<ReturnType<typeof listScheduleRuleRecords>>[number],
): ScheduleRule {
	return {
		...record,
		kind: "weekly",
		intervalWeeks: 1,
		timezone: "Asia/Shanghai",
		hasGeneratedLessons: record.hasGeneratedLessons ?? false,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function toMakeupLesson(
	record: Awaited<ReturnType<typeof listMakeupLessonRecords>>[number],
): MakeupLesson {
	return {
		...record,
		targetStartsAt: record.targetStartsAt.toISOString(),
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function throwTeachingError(error: unknown): never {
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
		case "SCHEDULE_CANDIDATE_INVALID":
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
		case "CLASS_STATUS_TRANSITION_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "当前班级状态不允许执行该变更。",
			});
		case "CLASS_HAS_SCHEDULED_LESSONS":
			throw new ORPCError("CONFLICT", {
				message: "请先完成或取消全部已排课次，再将班级结课。",
			});
		case "CLASS_CAPACITY_TOO_LOW":
			throw new ORPCError("CONFLICT", {
				message: "班级容量不能低于现有报名人数。",
			});
		case "CLASS_FULL":
			throw new ORPCError("CONFLICT", {
				message: error.details?.affectedLessons
					? "入班会使部分未来课次超过教室容量。"
					: "班级容量已满。",
				data: toErrorData(error.details),
			});
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
		case "ENROLLMENT_NOT_ACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "该报名已失效，不能调整班级。",
			});
		case "CLASS_NOT_SCHEDULABLE":
			throw new ORPCError("CONFLICT", {
				message: "当前班级状态不能新增课次。",
			});
		case "CLASS_NOT_PAUSABLE":
			throw new ORPCError("CONFLICT", {
				message: "只有进行中的班级可以停课。",
			});
		case "CLASS_NOT_RESUMABLE":
			throw new ORPCError("CONFLICT", { message: "只有已暂停班级可以复课。" });
		case "CLASS_ATTENDANCE_LOCKED":
			throw new ORPCError("CONFLICT", {
				message: "班级已暂停，不能点名或结课。",
			});
		case "MAKEUP_LESSON_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "该缺勤记录或目标课次不符合补课条件。",
			});
		case "MAKEUP_LESSON_DUPLICATE":
			throw new ORPCError("CONFLICT", {
				message: "该学员已有生效中的补课安排。",
			});
		case "LESSON_DURATION_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "课次时长必须与课程标准时长一致。",
			});
		case "LESSON_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "教师或教室在该时段已有课次。",
			});
		case "SCHEDULE_RULE_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "排课规则不存在。" });
		case "SCHEDULE_RULE_DUPLICATE":
			throw new ORPCError("CONFLICT", {
				message: "已存在相同的有效周期规则，请直接使用或修改现有规则。",
			});
		case "SCHEDULE_RULE_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message:
					"该规则会与同班级现有有效规则在未来时段重叠，请调整星期或开始时间。",
			});
		case "SCHEDULE_RULE_HAS_GENERATED_LESSONS":
			throw new ORPCError("CONFLICT", {
				message: "规则已生成课次，为保证排课记录可追溯，不能删除。",
			});
		case "SCHEDULE_RULE_INACTIVE":
			throw new ORPCError("CONFLICT", { message: "排课规则已停用。" });
		case "SCHEDULE_RULE_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "排课规则已发生变化，请刷新预览。",
			});
		case "SCHEDULE_BATCH_TOO_LARGE":
			throw new ORPCError("BAD_REQUEST", {
				message: "单次最多处理 200 节课次，请缩小日期范围。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "重复请求的内容不一致，请重新提交。",
			});
		case "LESSON_BULK_UPDATE_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "部分课次已开始或发生变化，请刷新预览。",
			});
		case "TEACHER_BINDING_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "教师账号绑定无效或已被其他教师使用。",
			});
		case "ATTENDANCE_DRAFT_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "点名名单已变化，请刷新后重新确认。",
			});
		case "ATTENDANCE_TOO_EARLY":
			throw new ORPCError("CONFLICT", {
				message: "尚未到可点名或结课时间。",
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

export function toErrorData(details: TeachingRepositoryError["details"]) {
	return details?.affectedLessons
		? {
				affectedLessons: details.affectedLessons.map((item) => ({
					...item,
					startsAt: item.startsAt.toISOString(),
				})),
			}
		: undefined;
}
