import { dashboardSnapshotSchema } from "../../contracts/training";
import { organizationProcedure } from "../../index";
import { getTrainingDashboardSnapshot } from "../../repositories/training-dashboard";

export const dashboardSnapshotProcedure = organizationProcedure
	.output(dashboardSnapshotSchema)
	.handler(({ context }) =>
		getTrainingDashboardSnapshot({
			organizationId: context.organization.id,
			userId: context.session.user.id,
			role: context.role,
			campusAccess: context.campusAccess,
		}),
	);
