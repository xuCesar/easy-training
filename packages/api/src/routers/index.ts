import type { RouterClient } from "@orpc/server";

import {
	createLeadInputSchema,
	leadListInputSchema,
	updateLeadInputSchema,
} from "../contracts/training";
import { getTrainingSnapshot } from "../data/training";
import {
	leadProcedure,
	organizationProcedure,
	protectedProcedure,
	publicProcedure,
} from "../index";
import { createLead, listLeads, updateLead } from "../repositories/leads";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	training: {
		organization: {
			current: organizationProcedure.handler(({ context }) => ({
				id: context.organization.id,
				name: context.organization.name,
				role: context.role,
			})),
		},
		leads: {
			list: leadProcedure
				.input(leadListInputSchema)
				.handler(({ context, input }) =>
					listLeads(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
			create: leadProcedure
				.input(createLeadInputSchema)
				.handler(({ context, input }) =>
					createLead(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
			update: leadProcedure
				.input(updateLeadInputSchema)
				.handler(({ context, input }) =>
					updateLead(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
		},
		snapshot: organizationProcedure.handler(async () => getTrainingSnapshot()),
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
