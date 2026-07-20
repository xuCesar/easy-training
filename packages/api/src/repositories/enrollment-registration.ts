import {
	createIndependentEnrollmentRecord,
	EnrollmentRegistrationError,
	getIndependentEnrollmentOptionsRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type { OrganizationRole } from "../authorization/training";
import type {
	CreateIndependentEnrollmentInput,
	CreateIndependentEnrollmentResult,
	IndependentEnrollmentOptions,
	IndependentEnrollmentOptionsInput,
} from "../contracts/training";

type IndependentEnrollmentScope = {
	organizationId: string;
	role: OrganizationRole;
	userId: string;
	campusAccess?: Parameters<
		typeof getIndependentEnrollmentOptionsRecord
	>[0]["campusAccess"];
};

function canOverridePackageTerms(role: OrganizationRole): boolean {
	return role === "owner" || role === "admin" || role === "campus_manager";
}

function toErrorData(details: EnrollmentRegistrationError["details"]) {
	return details?.affectedLessons
		? {
				affectedLessons: details.affectedLessons.map((item) => ({
					...item,
					startsAt: item.startsAt.toISOString(),
				})),
			}
		: undefined;
}

function throwRegistrationError(error: unknown): never {
	if (!(error instanceof EnrollmentRegistrationError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理独立报名，请稍后重试。",
		});
	}

	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权办理该校区的报名。",
			});
		case "STUDENT_NOT_FOUND":
		case "CAMPUS_NOT_FOUND":
		case "COURSE_NOT_FOUND":
		case "CLASS_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "报名关联资源不存在。" });
		case "STUDENT_NOT_ENROLLABLE":
			throw new ORPCError("CONFLICT", {
				message: "暂停或已结业学员不能直接报名，请先处理学员状态。",
			});
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续报名。",
			});
		case "COURSE_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "课程已停用，不能继续报名。",
			});
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
			throw new ORPCError("CONFLICT", {
				message: error.details?.affectedLessons
					? "报名会导致未来课次教室超容，请先调整班级排课。"
					: "该班级名额已满。",
				data: toErrorData(error.details),
			});
		case "CLASS_STUDENT_DUPLICATE":
			throw new ORPCError("CONFLICT", {
				message: "该学员已在所选班级中，不能重复入班。",
			});
		case "ACTIVE_COURSE_ENROLLMENT":
			throw new ORPCError("CONFLICT", {
				message: "该学员已有同课程有效报名，请使用续费。",
			});
		case "PACKAGE_TERMS_OVERRIDE_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前角色不能修改课程标准价格或课时。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "请求标识已被其他报名请求使用，请刷新后重试。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已发生变化，请刷新后重试。",
			});
	}
}

export async function getIndependentEnrollmentOptions(
	scope: IndependentEnrollmentScope,
	_input: IndependentEnrollmentOptionsInput,
): Promise<IndependentEnrollmentOptions> {
	try {
		const result = await getIndependentEnrollmentOptionsRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess ?? { kind: "all" },
		});
		return {
			...result,
			permissions: {
				canOverridePackageTerms: canOverridePackageTerms(scope.role),
			},
		};
	} catch (error) {
		return throwRegistrationError(error);
	}
}

export async function createIndependentEnrollment(
	scope: IndependentEnrollmentScope,
	input: CreateIndependentEnrollmentInput,
): Promise<CreateIndependentEnrollmentResult> {
	try {
		return await createIndependentEnrollmentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwRegistrationError(error);
	}
}
