import { ORPCError, os } from "@orpc/server";

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

type OrganizationRole = CurrentOrganization["role"];

const leadManagementRoles = new Set<OrganizationRole>([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);

function createOrganizationMiddleware(
	allowedRoles?: ReadonlySet<OrganizationRole>,
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
				message: "当前角色无权访问招生线索。",
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
const requireLeadManager = createOrganizationMiddleware(leadManagementRoles);

export const organizationProcedure = publicProcedure.use(requireOrganization);
export const leadProcedure = publicProcedure.use(requireLeadManager);
