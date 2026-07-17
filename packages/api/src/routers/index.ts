import type { RouterClient } from "@orpc/server";

import {
	convertLeadInputSchema,
	convertLeadResultSchema,
	createLeadInputSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	dashboardSnapshotSchema,
	invoiceDetailInputSchema,
	invoiceDetailSchema,
	invoiceListInputSchema,
	invoiceListResultSchema,
	leadConversionOptionsInputSchema,
	leadConversionOptionsSchema,
	leadListInputSchema,
	updateLeadInputSchema,
} from "../contracts/training";
import {
	financeProcedure,
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
import { createLead, listLeads, updateLead } from "../repositories/leads";
import { getTrainingDashboardSnapshot } from "../repositories/training-dashboard";

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
						},
						input,
					),
				),
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
