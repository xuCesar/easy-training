import {
	EnrollmentLifecycleError,
	updateEnrollmentLifecycleRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	UpdateEnrollmentLifecycleInput,
	UpdateEnrollmentLifecycleResult,
} from "../contracts/training";

export async function updateEnrollmentLifecycle(
	scope: { organizationId: string; userId: string },
	input: UpdateEnrollmentLifecycleInput,
): Promise<UpdateEnrollmentLifecycleResult> {
	try {
		return await updateEnrollmentLifecycleRecord({ ...scope, ...input });
	} catch (error) {
		if (!(error instanceof EnrollmentLifecycleError)) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "暂时无法处理报名状态，请稍后重试。",
			});
		}
		switch (error.code) {
			case "MEMBER_FORBIDDEN":
			case "CAMPUS_OUT_OF_SCOPE":
				throw new ORPCError("FORBIDDEN", {
					message: "当前账号无权操作该报名。",
				});
			case "ENROLLMENT_NOT_FOUND":
			case "CLASS_NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { message: "报名或班级不存在。" });
			case "ENROLLMENT_VERSION_CONFLICT":
				throw new ORPCError("CONFLICT", {
					message: "报名信息已被其他操作更新，请刷新后重试。",
					data: { reason: "ENROLLMENT_VERSION_CONFLICT" },
				});
			case "CLASS_FULL":
				throw new ORPCError("CONFLICT", {
					message: "目标班级或未来课次教室容量不足。",
					data: error.details
						? {
								affectedLessons: error.details.affectedLessons?.map((item) => ({
									...item,
									startsAt: item.startsAt.toISOString(),
								})),
							}
						: undefined,
				});
			case "INVALID_INPUT":
				throw new ORPCError("BAD_REQUEST", {
					message: "报名状态操作参数无效。",
				});
			case "CAMPUS_INACTIVE":
			case "ENROLLMENT_NOT_ACTIVE":
			case "ENROLLMENT_NOT_FROZEN":
			case "CLASS_COURSE_MISMATCH":
			case "CLASS_CAMPUS_MISMATCH":
			case "CLASS_NOT_AVAILABLE":
			case "CLASS_STUDENT_DUPLICATE":
			case "IDEMPOTENCY_CONFLICT":
				throw new ORPCError("CONFLICT", {
					message: "报名状态不满足本次操作条件。",
				});
		}
	}
}
