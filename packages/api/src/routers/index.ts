import type { RouterClient } from "@orpc/server";

import { getTrainingSnapshot } from "../data/training";
import { protectedProcedure, publicProcedure } from "../index";

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
		snapshot: protectedProcedure.handler(async () => getTrainingSnapshot()),
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
