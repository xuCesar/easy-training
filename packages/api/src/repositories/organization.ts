import {
	type CurrentOrganizationRecord,
	getOrCreateCurrentOrganization as getOrCreateCurrentOrganizationRecord,
	OrganizationContextError,
	selectCurrentOrganization as selectCurrentOrganizationRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

export type CurrentOrganization = CurrentOrganizationRecord;

function throwOrganizationContextError(error: unknown): never {
	if (!(error instanceof OrganizationContextError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载机构信息，请稍后重试。",
		});
	}

	switch (error.code) {
		case "SESSION_NOT_FOUND":
			throw new ORPCError("UNAUTHORIZED", {
				message: "登录状态已失效，请重新登录。",
			});
		case "ORGANIZATION_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "机构不存在或无权访问。" });
		case "ORGANIZATION_MEMBERSHIP_REQUIRED":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号已不属于任何机构，请联系机构管理员。",
			});
	}
}

export async function getOrCreateCurrentOrganization(input: {
	userId: string;
	userName: string;
	sessionId: string;
}): Promise<CurrentOrganization> {
	try {
		return await getOrCreateCurrentOrganizationRecord(input);
	} catch (error) {
		return throwOrganizationContextError(error);
	}
}

export async function selectCurrentOrganization(input: {
	userId: string;
	sessionId: string;
	organizationId: string;
}): Promise<CurrentOrganization> {
	try {
		return await selectCurrentOrganizationRecord(input);
	} catch (error) {
		return throwOrganizationContextError(error);
	}
}
