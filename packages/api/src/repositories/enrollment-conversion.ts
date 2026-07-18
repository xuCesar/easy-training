import {
	convertLeadRecord,
	EnrollmentConversionError,
	getLeadConversionOptionsRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type { OrganizationRole } from "../authorization/training";
import type {
	ConvertLeadInput,
	ConvertLeadResult,
	LeadConversionOptions,
	LeadConversionOptionsInput,
} from "../contracts/training";

type LeadConversionScope = {
	organizationId: string;
	role: OrganizationRole;
};

function canOverridePackageTerms(role: OrganizationRole): boolean {
	return role === "owner" || role === "admin" || role === "campus_manager";
}

function toStudentStatus(
	status: "active" | "trial" | "paused" | "graduated" | "at_risk",
): "active" | "trial" | "paused" | "graduated" | "atRisk" {
	return status === "at_risk" ? "atRisk" : status;
}

function throwConversionError(error: unknown): never {
	if (!(error instanceof EnrollmentConversionError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理线索转化，请稍后重试。",
		});
	}

	switch (error.code) {
		case "LEAD_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "线索不存在。" });
		case "LEAD_ALREADY_CONVERTED":
			throw new ORPCError("CONFLICT", { message: "该线索已完成转化。" });
		case "LEAD_NOT_CONVERTIBLE":
			throw new ORPCError("CONFLICT", {
				message: "当前线索状态不允许转化。",
			});
		case "STUDENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "学员不存在。" });
		case "STUDENT_PHONE_MISMATCH":
			throw new ORPCError("BAD_REQUEST", {
				message: "学员监护人手机号与线索电话不匹配。",
			});
		case "CAMPUS_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "校区不存在。" });
		case "COURSE_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "课程不存在。" });
		case "CLASS_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "班级不存在。" });
		case "CLASS_COURSE_MISMATCH":
			throw new ORPCError("BAD_REQUEST", {
				message: "班级与所选课程不匹配。",
			});
		case "CLASS_CAMPUS_MISMATCH":
			throw new ORPCError("BAD_REQUEST", {
				message: "班级与学员校区不匹配。",
			});
		case "CLASS_NOT_AVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "该班级当前不可报名。",
			});
		case "CLASS_FULL":
			throw new ORPCError("CONFLICT", { message: "该班级名额已满。" });
		case "PACKAGE_TERMS_OVERRIDE_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前角色不能修改课程标准价格或课时。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已发生变化，请刷新后重试。",
			});
	}
}

export async function getLeadConversionOptions(
	scope: LeadConversionScope,
	input: LeadConversionOptionsInput,
): Promise<LeadConversionOptions> {
	try {
		const result = await getLeadConversionOptionsRecord({
			organizationId: scope.organizationId,
			leadId: input.leadId,
		});

		return {
			...result,
			permissions: {
				canOverridePackageTerms: canOverridePackageTerms(scope.role),
			},
			lead: {
				...result.lead,
				stage:
					result.lead.stage === "trial_booked"
						? "trialBooked"
						: result.lead.stage,
			},
			matchingStudents: result.matchingStudents.map((item) => ({
				...item,
				status: toStudentStatus(item.status),
			})),
		};
	} catch (error) {
		return throwConversionError(error);
	}
}

export async function convertLead(
	scope: LeadConversionScope & { userId: string },
	input: ConvertLeadInput,
): Promise<ConvertLeadResult> {
	try {
		return await convertLeadRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			canOverridePackageTerms: canOverridePackageTerms(scope.role),
			...input,
		});
	} catch (error) {
		return throwConversionError(error);
	}
}
