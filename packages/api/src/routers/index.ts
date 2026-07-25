import type { RouterClient } from "@orpc/server";

import {
	analyticsExportInputSchema,
	analyticsExportResultSchema,
	analyticsSavedFilterCreateInputSchema,
	analyticsSavedFilterDeleteInputSchema,
	analyticsSavedFilterListResultSchema,
	analyticsSavedFilterSchema,
	analyticsSavedFilterUpdateInputSchema,
	businessMetricAttendanceResultSchema,
	businessMetricComparisonInputSchema,
	businessMetricComparisonResultSchema,
	businessMetricConsumptionResultSchema,
	businessMetricDrilldownInputSchema,
	businessMetricDrilldownResultSchema,
	businessMetricFinancialAgingDrilldownInputSchema,
	businessMetricFinancialAgingDrilldownResultSchema,
	businessMetricFinancialDrilldownInputSchema,
	businessMetricFinancialDrilldownResultSchema,
	businessMetricFinancialReceiptResultSchema,
	businessMetricFinancialResultSchema,
	businessMetricQueryInputSchema,
	businessMetricRenewalResultSchema,
	businessMetricResourceResultSchema,
	businessMetricSalesResultSchema,
} from "../contracts/business-metrics";

import {
	campusListInputSchema,
	campusListResultSchema,
	claimInvitationInputSchema,
	claimInvitationResultSchema,
	createCampusInputSchema,
	createInvitationInputSchema,
	createInvitationResultSchema,
	currentOrganizationSchema,
	invitationListResultSchema,
	memberListResultSchema,
	memberOwnerImpactInputSchema,
	memberOwnerImpactResultSchema,
	removeMemberInputSchema,
	resendInvitationInputSchema,
	revokeInvitationInputSchema,
	selectOrganizationInputSchema,
	setCampusActiveInputSchema,
	updateCampusInputSchema,
	updateMemberInputSchema,
} from "../contracts/training";
import {
	currentOrganizationProcedure,
	organizationManagementProcedure,
	organizationProcedure,
	protectedProcedure,
	publicProcedure,
} from "../index";
import {
	createBusinessMetricSavedFilter,
	deleteBusinessMetricSavedFilter,
	exportBusinessMetrics,
	getBusinessMetricAttendance,
	getBusinessMetricComparison,
	getBusinessMetricConsumption,
	getBusinessMetricDrilldown,
	getBusinessMetricFinancial,
	getBusinessMetricFinancialAgingDrilldown,
	getBusinessMetricFinancialDrilldown,
	getBusinessMetricFinancialReceipts,
	getBusinessMetricRenewal,
	getBusinessMetricResource,
	getBusinessMetricSales,
	listBusinessMetricSavedFilters,
	updateBusinessMetricSavedFilter,
} from "../repositories/business-metrics";
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
	previewMemberOwnerImpact,
	removeMember,
	resendInvitation,
	revokeInvitation,
	setCampusActive,
	updateCampus,
	updateMember,
} from "../repositories/organization-management";
import { auditRouter } from "./training/audit";
import { dashboardSnapshotProcedure } from "./training/dashboard";
import { enrollmentsRouter } from "./training/enrollments";
import { financeRouter } from "./training/finance";
import { leadsRouter } from "./training/leads";
import { notificationsRouter } from "./training/notifications";
import { operationTasksRouter } from "./training/operation-tasks";
import { searchRouter } from "./training/search";
import { studentsRouter } from "./training/students";
import { teachingRouter } from "./training/teaching";

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
		search: searchRouter,
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
			ownerImpact: organizationManagementProcedure
				.input(memberOwnerImpactInputSchema)
				.output(memberOwnerImpactResultSchema)
				.handler(({ context, input }) =>
					previewMemberOwnerImpact(
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
						emailVerified: context.session.user.emailVerified,
						sessionId: context.session.session.id,
					}),
				),
		},
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
		analytics: {
			export: organizationProcedure
				.input(analyticsExportInputSchema)
				.output(analyticsExportResultSchema)
				.handler(({ context, input }) =>
					exportBusinessMetrics(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input.config,
					),
				),
			savedFilters: {
				list: organizationProcedure
					.output(analyticsSavedFilterListResultSchema)
					.handler(({ context }) =>
						listBusinessMetricSavedFilters({
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						}),
					),
				create: organizationProcedure
					.input(analyticsSavedFilterCreateInputSchema)
					.output(analyticsSavedFilterSchema)
					.handler(({ context, input }) =>
						createBusinessMetricSavedFilter(
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
					.input(analyticsSavedFilterUpdateInputSchema)
					.output(analyticsSavedFilterSchema)
					.handler(({ context, input }) =>
						updateBusinessMetricSavedFilter(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								role: context.role,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				delete: organizationProcedure
					.input(analyticsSavedFilterDeleteInputSchema)
					.output(analyticsSavedFilterDeleteInputSchema)
					.handler(({ context, input }) =>
						deleteBusinessMetricSavedFilter(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								role: context.role,
								campusAccess: context.campusAccess,
							},
							input.id,
						),
					),
			},
			comparison: organizationProcedure
				.input(businessMetricComparisonInputSchema)
				.output(businessMetricComparisonResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricComparison(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financial: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricFinancialResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancial(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialDrilldown: organizationProcedure
				.input(businessMetricFinancialDrilldownInputSchema)
				.output(businessMetricFinancialDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialAgingDrilldown: organizationProcedure
				.input(businessMetricFinancialAgingDrilldownInputSchema)
				.output(businessMetricFinancialAgingDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialAgingDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			drilldown: organizationProcedure
				.input(businessMetricDrilldownInputSchema)
				.output(businessMetricDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			sales: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricSalesResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricSales(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			attendance: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricAttendanceResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricAttendance(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			consumption: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricConsumptionResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricConsumption(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialReceipts: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricFinancialReceiptResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialReceipts(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			resource: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricResourceResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricResource(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			renewal: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricRenewalResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricRenewal(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		snapshot: dashboardSnapshotProcedure,
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
