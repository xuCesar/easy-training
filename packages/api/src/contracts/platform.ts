import { z } from "zod";

export const platformAccessResultSchema = z.object({
	canManageOnboarding: z.boolean(),
});

export const platformOnboardingStatusSchema = z.enum([
	"pending",
	"claimed",
	"expired",
	"revoked",
]);

export const platformOnboardingInvitationSchema = z.object({
	id: z.uuid(),
	email: z.email(),
	organizationName: z.string(),
	note: z.string().nullable(),
	status: platformOnboardingStatusSchema,
	expiresAt: z.iso.datetime({ offset: true }),
	revokedAt: z.iso.datetime({ offset: true }).nullable(),
	claimedAt: z.iso.datetime({ offset: true }).nullable(),
	createdAt: z.iso.datetime({ offset: true }),
	createdBy: z
		.object({
			id: z.string(),
			name: z.string(),
			email: z.email(),
		})
		.nullable(),
	createdOrganizationId: z.uuid().nullable(),
});

export const platformOnboardingListInputSchema = z.object({
	cursor: z.string().min(1).max(512).optional(),
	limit: z.number().int().min(1).max(100).default(25),
	status: platformOnboardingStatusSchema.optional(),
	email: z.string().trim().email().max(254).optional(),
});

export const platformOnboardingListResultSchema = z.object({
	items: z.array(platformOnboardingInvitationSchema),
	nextCursor: z.string().nullable(),
});

export const createPlatformOnboardingInputSchema = z.object({
	email: z.string().trim().email().max(254),
	organizationName: z.string().trim().min(1).max(200),
	note: z.string().trim().max(500).optional(),
	requestId: z.uuid(),
});

export const rotatePlatformOnboardingInputSchema = z.object({
	invitationId: z.uuid(),
	requestId: z.uuid(),
});

export const revokePlatformOnboardingInputSchema = z.object({
	invitationId: z.uuid(),
});

export const platformOnboardingSecretResultSchema = z.object({
	id: z.uuid(),
	expiresAt: z.iso.datetime({ offset: true }),
	invitationUrl: z.url(),
});

export const revokePlatformOnboardingResultSchema = z.object({
	id: z.uuid(),
	revokedAt: z.iso.datetime({ offset: true }),
});

export type PlatformOnboardingListInput = z.infer<
	typeof platformOnboardingListInputSchema
>;
export type CreatePlatformOnboardingInput = z.infer<
	typeof createPlatformOnboardingInputSchema
>;
export type RotatePlatformOnboardingInput = z.infer<
	typeof rotatePlatformOnboardingInputSchema
>;
export type PlatformOnboardingInvitation = z.infer<
	typeof platformOnboardingInvitationSchema
>;
