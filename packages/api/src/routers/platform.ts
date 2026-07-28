import {
	platformAuthorizationProvider,
	toPlatformAuthorizationSubject,
} from "../authorization/platform";
import {
	createPlatformOnboardingInputSchema,
	platformAccessResultSchema,
	platformOnboardingListInputSchema,
	platformOnboardingListResultSchema,
	platformOnboardingSecretResultSchema,
	revokePlatformOnboardingInputSchema,
	revokePlatformOnboardingResultSchema,
	rotatePlatformOnboardingInputSchema,
} from "../contracts/platform";
import { platformProcedure, protectedProcedure } from "../index";
import {
	createPlatformOnboarding,
	listPlatformOnboarding,
	revokePlatformOnboarding,
	rotatePlatformOnboarding,
} from "../repositories/platform-onboarding";

const accessRouter = {
	get: protectedProcedure
		.output(platformAccessResultSchema)
		.handler(async ({ context }) => ({
			canManageOnboarding: await platformAuthorizationProvider.can(
				toPlatformAuthorizationSubject(context.session.user),
				"organization:onboard",
			),
		})),
};

const onboardingRouter = {
	list: platformProcedure
		.input(platformOnboardingListInputSchema)
		.output(platformOnboardingListResultSchema)
		.handler(({ input }) => listPlatformOnboarding(input)),
	create: platformProcedure
		.input(createPlatformOnboardingInputSchema)
		.output(platformOnboardingSecretResultSchema)
		.handler(({ context, input }) =>
			createPlatformOnboarding(context.session.user.id, input),
		),
	rotate: platformProcedure
		.input(rotatePlatformOnboardingInputSchema)
		.output(platformOnboardingSecretResultSchema)
		.handler(({ context, input }) =>
			rotatePlatformOnboarding(context.session.user.id, input),
		),
	revoke: platformProcedure
		.input(revokePlatformOnboardingInputSchema)
		.output(revokePlatformOnboardingResultSchema)
		.handler(({ context, input }) =>
			revokePlatformOnboarding(context.session.user.id, input),
		),
};

export const platformRouter = {
	access: accessRouter,
	onboarding: onboardingRouter,
};
