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
