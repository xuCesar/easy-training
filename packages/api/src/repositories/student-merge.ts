import {
	getStudentMergePreviewRecord,
	mergeStudentRecords,
	StudentMergeRepositoryError,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	MergeStudentsInput,
	MergeStudentsResult,
	StudentMergePreviewInput,
	StudentMergePreviewResult,
	StudentStatus,
} from "../contracts/training";

function toStudentStatus(
	status: "active" | "trial" | "paused" | "graduated" | "at_risk",
): StudentStatus {
	return status === "at_risk" ? "atRisk" : status;
}

function throwMergeError(error: unknown): never {
	if (!(error instanceof StudentMergeRepositoryError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理学员合并，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权合并这两位学员。",
			});
		case "STUDENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "待合并学员不存在。" });
		case "STUDENT_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "学员资料已更新，请刷新预览后重试。",
				data: { reason: "STUDENT_VERSION_CONFLICT" },
			});
		case "STUDENT_MERGE_ACTIVE_COURSE_ENROLLMENT":
			throw new ORPCError("CONFLICT", {
				message: "两位学员存在同课程有效报名，请先单独处理报名。",
				data: { reason: "ACTIVE_COURSE_ENROLLMENT" },
			});
		case "STUDENT_MERGE_ATTENDANCE_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "两位学员在同一课次均有考勤，不能自动合并。",
				data: { reason: "ATTENDANCE_CONFLICT" },
			});
		case "STUDENT_MERGE_CAMPUS_ENROLLMENT_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "合并后的所属校区必须与全部有效班级一致，请先处理跨校区报名。",
				data: { reason: "CAMPUS_ENROLLMENT_CONFLICT" },
			});
		case "STUDENT_MERGE_CONTACT_INVALID":
			throw new ORPCError("BAD_REQUEST", {
				message: "请选择合并后的主要联系人。",
			});
		case "STUDENT_OWNER_NOT_ELIGIBLE":
			throw new ORPCError("BAD_REQUEST", {
				message: "合并后负责人不具备所选校区的负责人资格。",
			});
		case "STUDENT_MERGE_SAME_RECORD":
		case "STUDENT_ALREADY_MERGED":
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "当前学员档案不能按该方式合并。",
			});
	}
}

export async function getStudentMergePreview(
	scope: { organizationId: string; userId: string },
	input: StudentMergePreviewInput,
): Promise<StudentMergePreviewResult> {
	try {
		const result = await getStudentMergePreviewRecord({ ...scope, ...input });
		return {
			...result,
			source: {
				...result.source,
				status: toStudentStatus(result.source.status),
				updatedAt: result.source.updatedAt.toISOString(),
			},
			target: {
				...result.target,
				status: toStudentStatus(result.target.status),
				updatedAt: result.target.updatedAt.toISOString(),
			},
		};
	} catch (error) {
		return throwMergeError(error);
	}
}

export async function mergeStudents(
	scope: { organizationId: string; userId: string },
	input: MergeStudentsInput,
): Promise<MergeStudentsResult> {
	try {
		return await mergeStudentRecords({
			...scope,
			...input,
		});
	} catch (error) {
		return throwMergeError(error);
	}
}
