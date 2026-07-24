import {
	auditEventListInputSchema,
	auditEventListResultSchema,
} from "../../contracts/training";
import { organizationManagementProcedure } from "../../index";
import { listAuditEvents } from "../../repositories/operations";

export const auditRouter = {
	list: organizationManagementProcedure
		.input(auditEventListInputSchema)
		.output(auditEventListResultSchema)
		.handler(({ context, input }) =>
			listAuditEvents(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
};
