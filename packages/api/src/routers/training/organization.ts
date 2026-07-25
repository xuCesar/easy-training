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
} from "../../contracts/training";
import {
	currentOrganizationProcedure,
	organizationManagementProcedure,
	organizationProcedure,
	protectedProcedure,
} from "../../index";
import {
	type CurrentOrganization as CurrentOrganizationContext,
	selectCurrentOrganization,
} from "../../repositories/organization";
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
} from "../../repositories/organization-management";

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

export const organizationRouter = {
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
};

export const campusesRouter = {
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
};

export const membersRouter = {
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
};

export const invitationsRouter = {
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
};
