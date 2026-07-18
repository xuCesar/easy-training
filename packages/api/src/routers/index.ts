import type { RouterClient } from "@orpc/server";

import {
	addLeadFollowUpInputSchema,
	campusListInputSchema,
	campusListResultSchema,
	claimInvitationInputSchema,
	claimInvitationResultSchema,
	convertLeadInputSchema,
	convertLeadResultSchema,
	createCampusInputSchema,
	createInvitationInputSchema,
	createInvitationResultSchema,
	createLeadInputSchema,
	createLeadResultSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	currentOrganizationSchema,
	dashboardSnapshotSchema,
	exportLeadsInputSchema,
	exportLeadsResultSchema,
	invitationListResultSchema,
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
	memberListResultSchema,
	removeMemberInputSchema,
	resendInvitationInputSchema,
	revokeInvitationInputSchema,
	selectOrganizationInputSchema,
	setCampusActiveInputSchema,
	updateCampusInputSchema,
	updateLeadInputSchema,
	updateMemberInputSchema,
} from "../contracts/training";
import {
	currentOrganizationProcedure,
	financeProcedure,
	leadExportProcedure,
	leadProcedure,
	organizationManagementProcedure,
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
import {
	claimInvitation,
	createCampus,
	createInvitation,
	listCampuses,
	listInvitations,
	listMembers,
	removeMember,
	resendInvitation,
	revokeInvitation,
	setCampusActive,
	updateCampus,
	updateMember,
} from "../repositories/organization-management";
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
		campuses: {
			list: organizationProcedure
				.input(campusListInputSchema)
				.output(campusListResultSchema)
				.handler(({ context, input }) =>
					listCampuses(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			create: organizationManagementProcedure
				.input(createCampusInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					createCampus(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			update: organizationManagementProcedure
				.input(updateCampusInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					updateCampus(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			setActive: organizationManagementProcedure
				.input(setCampusActiveInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					setCampusActive(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		members: {
			list: organizationManagementProcedure
				.output(memberListResultSchema)
				.handler(({ context }) =>
					listMembers({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
			update: organizationManagementProcedure
				.input(updateMemberInputSchema)
				.handler(({ context, input }) =>
					updateMember(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			remove: organizationManagementProcedure
				.input(removeMemberInputSchema)
				.handler(({ context, input }) =>
					removeMember(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		invitations: {
			list: organizationManagementProcedure
				.output(invitationListResultSchema)
				.handler(({ context }) =>
					listInvitations({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
			create: organizationManagementProcedure
				.input(createInvitationInputSchema)
				.output(createInvitationResultSchema)
				.handler(({ context, input }) =>
					createInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			revoke: organizationManagementProcedure
				.input(revokeInvitationInputSchema)
				.handler(({ context, input }) =>
					revokeInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			resend: organizationManagementProcedure
				.input(resendInvitationInputSchema)
				.output(createInvitationResultSchema)
				.handler(({ context, input }) =>
					resendInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			claim: protectedProcedure
				.input(claimInvitationInputSchema)
				.output(claimInvitationResultSchema)
				.handler(({ context, input }) =>
					claimInvitation(input, {
						userId: context.session.user.id,
						email: context.session.user.email,
						sessionId: context.session.session.id,
					}),
				),
		},
		leads: {
			filterOptions: leadProcedure
				.output(leadFilterOptionsSchema)
				.handler(({ context }) =>
					getLeadFilterOptions({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
							campusAccess: context.campusAccess,
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
								campusAccess: context.campusAccess,
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
								campusAccess: context.campusAccess,
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
								campusAccess: context.campusAccess,
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
					campusAccess: context.campusAccess,
				}),
			),
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
