import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { platformRouter } from "./platform";
import { analyticsRouter } from "./training/analytics";
import { auditRouter } from "./training/audit";
import { dashboardSnapshotProcedure } from "./training/dashboard";
import { enrollmentsRouter } from "./training/enrollments";
import { financeRouter } from "./training/finance";
import { leadsRouter } from "./training/leads";
import { notificationsRouter } from "./training/notifications";
import { operationTasksRouter } from "./training/operation-tasks";
import {
	campusesRouter,
	invitationsRouter,
	membersRouter,
	organizationRouter,
} from "./training/organization";
import { searchRouter } from "./training/search";
import { studentsRouter } from "./training/students";
import { teachingRouter } from "./training/teaching";

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
	platform: platformRouter,
	training: {
		search: searchRouter,
		organization: organizationRouter,
		campuses: campusesRouter,
		members: membersRouter,
		invitations: invitationsRouter,
		notifications: notificationsRouter,
		audit: auditRouter,
		students: studentsRouter,
		teaching: teachingRouter,
		enrollments: enrollmentsRouter,
		leads: leadsRouter,
		finance: financeRouter,
		operations: {
			tasks: operationTasksRouter,
		},
		analytics: analyticsRouter,
		snapshot: dashboardSnapshotProcedure,
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
