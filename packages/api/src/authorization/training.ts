import type { CurrentOrganization } from "../repositories/organization";

export type OrganizationRole = CurrentOrganization["role"];

export const leadManagementRoles: ReadonlySet<OrganizationRole> = new Set([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);

export const studentManagementRoles: ReadonlySet<OrganizationRole> = new Set([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);

export const financeManagementRoles: ReadonlySet<OrganizationRole> = new Set([
	"owner",
	"admin",
	"campus_manager",
	"finance",
]);

export const organizationOperationsRoles: ReadonlySet<OrganizationRole> =
	new Set(["owner", "admin", "campus_manager"]);

export const organizationManagementRoles: ReadonlySet<OrganizationRole> =
	new Set(["owner", "admin"]);

export const academicManagementRoles: ReadonlySet<OrganizationRole> = new Set([
	"owner",
	"admin",
	"campus_manager",
]);

export const teacherWorkspaceRoles: ReadonlySet<OrganizationRole> = new Set([
	"teacher",
]);

export const globalSearchKinds = [
	"lead",
	"student",
	"course",
	"classGroup",
	"lesson",
	"invoice",
	"receipt",
] as const;

export type GlobalSearchKind = (typeof globalSearchKinds)[number];

/** 全局搜索唯一的角色—资源决策表，DB 层只接收已裁剪的资源集合。 */
export function getGlobalSearchKindsForRole(
	role: OrganizationRole,
): readonly GlobalSearchKind[] {
	switch (role) {
		case "owner":
		case "admin":
		case "campus_manager":
			return globalSearchKinds;
		case "consultant":
			return ["lead", "student"];
		case "finance":
			return ["invoice", "receipt"];
		case "teacher":
			return ["lesson"];
	}
}
