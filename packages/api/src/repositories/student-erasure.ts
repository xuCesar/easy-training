import { eraseStudentRecord, StudentErasureError } from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	EraseStudentInput,
	EraseStudentResult,
} from "../contracts/training";

function throwErasureError(error: unknown): never {
	if (!(error instanceof StudentErasureError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法删除学员数据，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权删除学员数据。",
			});
		case "STUDENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "学员不存在。" });
		case "STUDENT_MERGED":
			throw new ORPCError("CONFLICT", {
				message: "该学员已被合并，请对合并后的学员操作。",
			});
		case "STUDENT_ALREADY_ERASED":
			throw new ORPCError("CONFLICT", {
				message: "该学员的个人信息已删除。",
			});
		case "ERASE_CONFIRM_MISMATCH":
			throw new ORPCError("BAD_REQUEST", {
				message: "确认姓名与学员当前姓名不一致。",
			});
		case "ERASE_OUTSTANDING_INVOICE":
			throw new ORPCError("CONFLICT", {
				message: "该学员存在未结清账单，请先完成结算或退费。",
				data: { reason: "OUTSTANDING_INVOICE" },
			});
	}
}

export async function eraseStudent(
	scope: { organizationId: string; userId: string },
	input: EraseStudentInput,
): Promise<EraseStudentResult> {
	try {
		return await eraseStudentRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			studentId: input.studentId,
			confirmName: input.confirmName,
		});
	} catch (error) {
		throwErasureError(error);
	}
}
