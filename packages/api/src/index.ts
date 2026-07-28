import { ORPCError, os } from "@orpc/server";

import {
	platformAuthorizationProvider,
	toPlatformAuthorizationSubject,
} from "./authorization/platform";
import {
	academicManagementRoles,
	financeManagementRoles,
	leadManagementRoles,
	type OrganizationRole,
	organizationManagementRoles,
	organizationOperationsRoles,
	studentManagementRoles,
	teacherWorkspaceRoles,
} from "./authorization/training";
import type { Context } from "./context";
import {
	type CurrentOrganization,
	getOrCreateCurrentOrganization,
} from "./repositories/organization";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user || !context.session.session) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
			onboardingToken: context.onboardingToken,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);

const requirePlatformOnboardingCapability = requireAuth.concat(
	async ({ context, next }) => {
		const allowed = await platformAuthorizationProvider.can(
			toPlatformAuthorizationSubject(context.session.user),
			"organization:onboard",
		);
		if (!allowed) {
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权访问平台管理。",
			});
		}
		return next({
			context: {
				platformCapability: "organization:onboard" as const,
			},
		});
	},
);

export const platformProcedure = publicProcedure.use(
	requirePlatformOnboardingCapability,
);

function createOrganizationMiddleware(
	allowedRoles?: ReadonlySet<OrganizationRole>,
	forbiddenMessage = "当前角色无权访问该功能。",
	requireExpectedOrganization = true,
) {
	return requireAuth.concat(async ({ context, next }) => {
		const sessionUser = context.session.user;
		const currentOrganization: CurrentOrganization =
			await getOrCreateCurrentOrganization({
				userId: sessionUser.id,
				userName: sessionUser.name,
				sessionId: context.session.session.id,
				onboardingToken: context.onboardingToken,
			});

		if (
			requireExpectedOrganization &&
			context.expectedOrganizationId !== currentOrganization.organization.id
		) {
			throw new ORPCError("CONFLICT", {
				message: "机构上下文已变化，请刷新页面后重试。",
			});
		}

		if (allowedRoles && !allowedRoles.has(currentOrganization.role)) {
			throw new ORPCError("FORBIDDEN", {
				message: forbiddenMessage,
			});
		}

		return next({
			context: {
				...currentOrganization,
			},
		});
	});
}

const requireCurrentOrganization = createOrganizationMiddleware(
	undefined,
	undefined,
	false,
);
const requireOrganization = createOrganizationMiddleware();
const requireLeadManager = createOrganizationMiddleware(
	leadManagementRoles,
	"当前角色无权访问招生线索。",
);
const requireStudentManager = createOrganizationMiddleware(
	studentManagementRoles,
	"当前角色无权访问学员档案。",
);
const requireFinanceManager = createOrganizationMiddleware(
	financeManagementRoles,
	"当前角色无权访问财务管理。",
);

export const organizationProcedure = publicProcedure.use(requireOrganization);
export const currentOrganizationProcedure = publicProcedure.use(
	requireCurrentOrganization,
);
export const leadProcedure = publicProcedure.use(requireLeadManager);
export const studentProcedure = publicProcedure.use(requireStudentManager);
export const leadExportProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		organizationOperationsRoles,
		"当前角色无权导出招生线索。",
	),
);
export const studentExportProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		organizationOperationsRoles,
		"当前角色无权导出学员联系人。",
	),
);
export const studentBulkProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		organizationOperationsRoles,
		"当前角色无权执行学员批量调整。",
	),
);
export const financeProcedure = publicProcedure.use(requireFinanceManager);
export const organizationManagementProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		organizationManagementRoles,
		"当前角色无权管理校区或成员。",
	),
);
export const academicManagementProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		academicManagementRoles,
		"当前角色无权管理教务。",
	),
);
export const teacherWorkspaceProcedure = publicProcedure.use(
	createOrganizationMiddleware(
		teacherWorkspaceRoles,
		"当前角色无权访问教师工作台。",
	),
);
