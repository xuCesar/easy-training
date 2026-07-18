import type { RouterClient } from "@orpc/server";

import {
	addLeadFollowUpInputSchema,
	convertLeadInputSchema,
	convertLeadResultSchema,
	createLeadInputSchema,
	createLeadResultSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	currentOrganizationSchema,
	dashboardSnapshotSchema,
	exportLeadsInputSchema,
	exportLeadsResultSchema,
	invoiceDetailInputSchema,
	invoiceDetailSchema,
	invoiceListInputSchema,
	invoiceListResultSchema,
	leadConversionOptionsInputSchema,
	leadConversionOptionsSchema,
	leadFilterOptionsSchema,
	leadHistoryInputSchema,
	leadHistoryResultSchema,
	leadListInputSchema,
	leadListResultSchema,
	selectOrganizationInputSchema,
	updateLeadInputSchema,
} from "../contracts/training";
import {
	currentOrganizationProcedure,
	financeProcedure,
	leadExportProcedure,
	leadProcedure,
	organizationProcedure,
	protectedProcedure,
	publicProcedure,
} from "../index";
import {
	convertLead,
	getLeadConversionOptions,
} from "../repositories/enrollment-conversion";
import {
	createPayment,
	getInvoiceDetail,
	listInvoices,
} from "../repositories/finance";
import {
	addLeadFollowUp,
	createLead,
	exportLeads,
	getLeadFilterOptions,
	getLeadHistory,
	listLeads,
	updateLead,
} from "../repositories/leads";
import {
	type CurrentOrganization as CurrentOrganizationContext,
	selectCurrentOrganization,
} from "../repositories/organization";
import { getTrainingDashboardSnapshot } from "../repositories/training-dashboard";

function toCurrentOrganizationResponse(
	context: Pick<
		CurrentOrganizationContext,
		"organization" | "role" | "organizations"
	>,
) {
	return {
		id: context.organization.id,
		name: context.organization.name,
		role: context.role,
		organizations: context.organizations,
	};
}

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
			current: currentOrganizationProcedure
				.output(currentOrganizationSchema)
				.handler(({ context }) => toCurrentOrganizationResponse(context)),
			select: protectedProcedure
				.input(selectOrganizationInputSchema)
				.output(currentOrganizationSchema)
				.handler(async ({ context, input }) => {
					const currentOrganization = await selectCurrentOrganization({
						userId: context.session.user.id,
						sessionId: context.session.session.id,
						organizationId: input.organizationId,
					});

					return toCurrentOrganizationResponse(currentOrganization);
				}),
		},
		leads: {
			filterOptions: leadProcedure
				.output(leadFilterOptionsSchema)
				.handler(({ context }) =>
					getLeadFilterOptions({
						organizationId: context.organization.id,
						userId: context.session.user.id,
					}),
				),
			conversionOptions: leadProcedure
				.input(leadConversionOptionsInputSchema)
				.output(leadConversionOptionsSchema)
				.handler(({ context, input }) =>
					getLeadConversionOptions(
						{
							organizationId: context.organization.id,
							role: context.role,
						},
						input,
					),
				),
			convert: leadProcedure
				.input(convertLeadInputSchema)
				.output(convertLeadResultSchema)
				.handler(({ context, input }) =>
					convertLead(
						{
							organizationId: context.organization.id,
							role: context.role,
							userId: context.session.user.id,
						},
						input,
					),
				),
			list: leadProcedure
				.input(leadListInputSchema)
				.output(leadListResultSchema)
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
				.output(createLeadResultSchema)
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
			followUp: leadProcedure
				.input(addLeadFollowUpInputSchema)
				.handler(({ context, input }) =>
					addLeadFollowUp(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
			history: leadProcedure
				.input(leadHistoryInputSchema)
				.output(leadHistoryResultSchema)
				.handler(({ context, input }) =>
					getLeadHistory(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input.leadId,
					),
				),
			export: leadExportProcedure
				.input(exportLeadsInputSchema)
				.output(exportLeadsResultSchema)
				.handler(({ context, input }) =>
					exportLeads(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
		},
		finance: {
			invoices: {
				list: financeProcedure
					.input(invoiceListInputSchema)
					.output(invoiceListResultSchema)
					.handler(({ context, input }) =>
						listInvoices(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
							},
							input,
						),
					),
				detail: financeProcedure
					.input(invoiceDetailInputSchema)
					.output(invoiceDetailSchema)
					.handler(({ context, input }) =>
						getInvoiceDetail(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
							},
							input,
						),
					),
			},
			payments: {
				create: financeProcedure
					.input(createPaymentInputSchema)
					.output(createPaymentResultSchema)
					.handler(({ context, input }) =>
						createPayment(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
							},
							input,
						),
					),
			},
		},
		snapshot: organizationProcedure
			.output(dashboardSnapshotSchema)
			.handler(({ context }) =>
				getTrainingDashboardSnapshot({
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
				}),
			),
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
