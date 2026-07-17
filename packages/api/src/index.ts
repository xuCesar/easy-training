import { ORPCError, os } from "@orpc/server";

import {
	financeManagementRoles,
	leadManagementRoles,
	type OrganizationRole,
} from "./authorization/training";
import type { Context } from "./context";
import {
	type CurrentOrganization,
	getOrCreateCurrentOrganization,
} from "./repositories/organization";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);

function createOrganizationMiddleware(
	allowedRoles?: ReadonlySet<OrganizationRole>,
	forbiddenMessage = "当前角色无权访问该功能。",
) {
	return requireAuth.concat(async ({ context, next }) => {
		const sessionUser = context.session.user;
		let currentOrganization: CurrentOrganization;

		try {
			currentOrganization = await getOrCreateCurrentOrganization({
				userId: sessionUser.id,
				userName: sessionUser.name,
			});
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "暂时无法加载机构信息，请稍后重试。",
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

const requireOrganization = createOrganizationMiddleware();
const requireLeadManager = createOrganizationMiddleware(
	leadManagementRoles,
	"当前角色无权访问招生线索。",
);
const requireFinanceManager = createOrganizationMiddleware(
	financeManagementRoles,
	"当前角色无权访问财务管理。",
);

export const organizationProcedure = publicProcedure.use(requireOrganization);
export const leadProcedure = publicProcedure.use(requireLeadManager);
export const financeProcedure = publicProcedure.use(requireFinanceManager);
