import { z } from "zod";

export const organizationRoleSchema = z.enum([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
	"teacher",
	"finance",
]);

export const organizationSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	role: organizationRoleSchema,
});

export const currentOrganizationSchema = organizationSummarySchema.extend({
	organizations: z.array(organizationSummarySchema).min(1),
});

export const selectOrganizationInputSchema = z.object({
	organizationId: z.uuid(),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type CurrentOrganization = z.infer<typeof currentOrganizationSchema>;
export type SelectOrganizationInput = z.infer<
	typeof selectOrganizationInputSchema
>;

export const campusAccessModeSchema = z.enum(["all", "selected"]);

const campusScopeSchema = z
	.object({
		campusAccessMode: campusAccessModeSchema,
		campusIds: z.array(z.uuid()).max(100).default([]),
	})
	.superRefine((value, context) => {
		if (value.campusAccessMode === "all" && value.campusIds.length > 0) {
			context.addIssue({
				code: "custom",
				path: ["campusIds"],
				message: "全机构访问不应配置校区范围。",
			});
		}
	});

const campusSchema = z.object({
	id: z.uuid(),
	code: z.string(),
	name: z.string(),
	city: z.string(),
	address: z.string(),
	roomCount: z.number().int().nonnegative(),
	capacity: z.number().int().nonnegative(),
	isActive: z.boolean(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});

const campusDataSchema = z.object({
	code: z.string().trim().min(1).max(30),
	name: z.string().trim().min(1).max(100),
	city: z.string().trim().min(1).max(100),
	address: z.string().trim().min(1).max(300),
	roomCount: z.number().int().min(0).max(10_000).default(0),
	capacity: z.number().int().min(0).max(1_000_000).default(0),
});

export const campusListInputSchema = z.object({
	includeInactive: z.boolean().default(true),
});
export const campusListResultSchema = z.object({
	items: z.array(campusSchema),
});
export const createCampusInputSchema = campusDataSchema;
export const updateCampusInputSchema = z.object({
	id: z.uuid(),
	data: campusDataSchema
		.partial()
		.refine((value) => Object.keys(value).length > 0, {
			message: "至少提供一个待更新字段。",
		}),
});
export const setCampusActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});

const memberSchema = z.object({
	id: z.uuid(),
	userId: z.string(),
	name: z.string(),
	email: z.string().email(),
	role: organizationRoleSchema,
	campusAccessMode: campusAccessModeSchema,
	campusIds: z.array(z.uuid()),
	createdAt: z.iso.datetime({ offset: true }),
});

export const memberListResultSchema = z.object({
	items: z.array(memberSchema),
});
export const updateMemberInputSchema = z
	.object({
		memberId: z.uuid(),
		role: organizationRoleSchema,
	})
	.merge(campusScopeSchema);
export const removeMemberInputSchema = z.object({ memberId: z.uuid() });
export const memberOwnerImpactInputSchema = z.discriminatedUnion("kind", [
	updateMemberInputSchema.extend({ kind: z.literal("update") }),
	removeMemberInputSchema.extend({ kind: z.literal("remove") }),
]);
export const memberOwnerImpactResultSchema = z.object({
	affectedStudentCount: z.number().int().nonnegative(),
});

const invitationSchema = z.object({
	id: z.uuid(),
	emailMasked: z.string(),
	role: organizationRoleSchema,
	campusAccessMode: campusAccessModeSchema,
	campusIds: z.array(z.uuid()),
	expiresAt: z.iso.datetime({ offset: true }),
	revokedAt: z.iso.datetime({ offset: true }).nullable(),
	claimedAt: z.iso.datetime({ offset: true }).nullable(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const invitationListResultSchema = z.object({
	items: z.array(invitationSchema),
});
export const createInvitationInputSchema = z
	.object({
		email: z.string().trim().email().max(254),
		role: organizationRoleSchema.exclude(["owner"]),
		requestId: z.uuid(),
	})
	.merge(campusScopeSchema);
export const createInvitationResultSchema = z.object({
	invitation: invitationSchema,
	token: z.string().min(40),
});
export const revokeInvitationInputSchema = z.object({ id: z.uuid() });
export const resendInvitationInputSchema = z.object({
	id: z.uuid(),
	requestId: z.uuid(),
});
export const claimInvitationInputSchema = z.object({
	token: z.string().min(40),
});
export const claimInvitationResultSchema = z.object({
	organizationId: z.uuid(),
});

export type Campus = z.infer<typeof campusSchema>;
export type CampusListInput = z.infer<typeof campusListInputSchema>;
export type CampusListResult = z.infer<typeof campusListResultSchema>;
export type CreateCampusInput = z.infer<typeof createCampusInputSchema>;
export type UpdateCampusInput = z.infer<typeof updateCampusInputSchema>;
export type SetCampusActiveInput = z.infer<typeof setCampusActiveInputSchema>;

const classroomSchema = z.object({
	id: z.uuid(),
	organizationId: z.uuid(),
	campusId: z.uuid(),
	name: z.string(),
	capacity: z.number().int().positive(),
	isActive: z.boolean(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
export const classroomListInputSchema = z.object({
	campusId: z.uuid().optional(),
	includeInactive: z.boolean().default(true),
});
export const classroomListResultSchema = z.object({
	items: z.array(classroomSchema),
});
export const createClassroomInputSchema = z.object({
	campusId: z.uuid(),
	name: z.string().trim().min(1).max(100),
	capacity: z.number().int().min(1).max(10_000),
});
export const updateClassroomInputSchema = z.object({
	id: z.uuid(),
	data: z.object({
		name: z.string().trim().min(1).max(100),
		capacity: z.number().int().min(1).max(10_000),
	}),
});
export const setClassroomActiveInputSchema = z.object({
	id: z.uuid(),
	isActive: z.boolean(),
});
export type Classroom = z.infer<typeof classroomSchema>;
export type ClassroomListInput = z.infer<typeof classroomListInputSchema>;
export type ClassroomListResult = z.infer<typeof classroomListResultSchema>;
export type CreateClassroomInput = z.infer<typeof createClassroomInputSchema>;
export type UpdateClassroomInput = z.infer<typeof updateClassroomInputSchema>;
export type SetClassroomActiveInput = z.infer<
	typeof setClassroomActiveInputSchema
>;
export type MemberListResult = z.infer<typeof memberListResultSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>;
export type MemberOwnerImpactInput = z.infer<
	typeof memberOwnerImpactInputSchema
>;
export type MemberOwnerImpactResult = z.infer<
	typeof memberOwnerImpactResultSchema
>;
export type InvitationListResult = z.infer<typeof invitationListResultSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;
export type CreateInvitationResult = z.infer<
	typeof createInvitationResultSchema
>;
export type RevokeInvitationInput = z.infer<typeof revokeInvitationInputSchema>;
export type ResendInvitationInput = z.infer<typeof resendInvitationInputSchema>;
export type ClaimInvitationInput = z.infer<typeof claimInvitationInputSchema>;
export type ClaimInvitationResult = z.infer<typeof claimInvitationResultSchema>;
