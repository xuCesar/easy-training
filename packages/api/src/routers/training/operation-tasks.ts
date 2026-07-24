import {
	createOperationTaskInputSchema,
	operationTaskActionInputSchema,
	operationTaskAssigneeListInputSchema,
	operationTaskAssigneeListResultSchema,
	operationTaskListInputSchema,
	operationTaskListResultSchema,
	operationTaskMutationResultSchema,
	updateOperationTaskInputSchema,
} from "../../contracts/training";
import { organizationProcedure } from "../../index";
import {
	cancelOperationTaskForOrganization,
	claimOperationTaskForOrganization,
	completeOperationTaskForOrganization,
	createOperationTaskForOrganization,
	listOperationTaskAssigneesForOrganization,
	listOperationTasksForOrganization,
	reopenOperationTaskForOrganization,
	updateOperationTaskForOrganization,
} from "../../repositories/operation-tasks";

export const operationTasksRouter = {
	list: organizationProcedure
		.input(operationTaskListInputSchema)
		.output(operationTaskListResultSchema)
		.handler(({ context, input }) =>
			listOperationTasksForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	assignees: organizationProcedure
		.input(operationTaskAssigneeListInputSchema)
		.output(operationTaskAssigneeListResultSchema)
		.handler(({ context, input }) =>
			listOperationTaskAssigneesForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	create: organizationProcedure
		.input(createOperationTaskInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			createOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	update: organizationProcedure
		.input(updateOperationTaskInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			updateOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	claim: organizationProcedure
		.input(operationTaskActionInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			claimOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	complete: organizationProcedure
		.input(operationTaskActionInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			completeOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	reopen: organizationProcedure
		.input(operationTaskActionInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			reopenOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	cancel: organizationProcedure
		.input(operationTaskActionInputSchema)
		.output(operationTaskMutationResultSchema)
		.handler(({ context, input }) =>
			cancelOperationTaskForOrganization(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
};
