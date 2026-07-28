import { env } from "@easy-training/env/server";

export type PlatformCapability = "organization:onboard";

export type PlatformAuthorizationSubject = {
	userId: string;
	email: string;
	emailVerified: boolean;
};

export interface PlatformAuthorizationProvider {
	can(
		subject: PlatformAuthorizationSubject,
		capability: PlatformCapability,
	): Promise<boolean>;
}

export class EnvPlatformAuthorizationProvider
	implements PlatformAuthorizationProvider
{
	private readonly operatorEmails: ReadonlySet<string>;

	constructor(
		operatorEmails: readonly string[] = env.PLATFORM_OPERATOR_EMAILS,
	) {
		this.operatorEmails = new Set(
			operatorEmails.map((email) => email.trim().toLocaleLowerCase("en-US")),
		);
	}

	async can(
		subject: PlatformAuthorizationSubject,
		capability: PlatformCapability,
	): Promise<boolean> {
		if (capability !== "organization:onboard" || !subject.emailVerified) {
			return false;
		}
		return this.operatorEmails.has(
			subject.email.trim().toLocaleLowerCase("en-US"),
		);
	}
}

export const platformAuthorizationProvider: PlatformAuthorizationProvider =
	new EnvPlatformAuthorizationProvider();

export function toPlatformAuthorizationSubject(sessionUser: {
	id: string;
	email: string;
	emailVerified: boolean;
}): PlatformAuthorizationSubject {
	return {
		userId: sessionUser.id,
		email: sessionUser.email,
		emailVerified: sessionUser.emailVerified,
	};
}
