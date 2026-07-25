import { db } from "@easy-training/db";
import {
	hasActiveInvitationForEmail,
	normalizeInvitationEmail,
} from "@easy-training/db/repositories/organization-management";
import * as schema from "@easy-training/db/schema/auth";
import { env } from "@easy-training/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";

const sensitiveAuthPaths = [
	"/sign-in/*",
	"/sign-up/*",
	"/change-password",
	"/change-email",
	"/request-password-reset",
	"/reset-password",
	"/forget-password/*",
	"/email-otp/request-password-reset",
	"/email-otp/reset-password",
] as const;

const publicSignupDisabledMessage = "当前不接受公开注册，请通过机构邀请加入。";

export function createAuth() {
	if (env.AUTH_PASSWORD_MIN_LENGTH > env.AUTH_PASSWORD_MAX_LENGTH) {
		throw new Error(
			"AUTH_PASSWORD_MIN_LENGTH must be less than or equal to AUTH_PASSWORD_MAX_LENGTH.",
		);
	}
	const sensitiveRateLimitRule = {
		window: env.AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
		max: env.AUTH_SENSITIVE_RATE_LIMIT_MAX,
	};

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
			minPasswordLength: env.AUTH_PASSWORD_MIN_LENGTH,
			maxPasswordLength: env.AUTH_PASSWORD_MAX_LENGTH,
		},
		rateLimit: {
			enabled: true,
			window: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
			max: env.AUTH_RATE_LIMIT_MAX,
			storage: "memory",
			customRules: Object.fromEntries(
				sensitiveAuthPaths.map((path) => [path, sensitiveRateLimitRule]),
			),
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (env.ALLOW_PUBLIC_SIGNUP || ctx.path !== "/sign-up/email") {
					return;
				}

				const email =
					typeof ctx.body?.email === "string" ? ctx.body.email.trim() : "";
				if (!email) {
					throw APIError.from("FORBIDDEN", {
						code: "PUBLIC_SIGNUP_DISABLED",
						message: publicSignupDisabledMessage,
					});
				}

				const invited = await hasActiveInvitationForEmail(
					normalizeInvitationEmail(email),
				);
				if (!invited) {
					throw APIError.from("FORBIDDEN", {
						code: "PUBLIC_SIGNUP_DISABLED",
						message: publicSignupDisabledMessage,
					});
				}
			}),
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: env.NODE_ENV === "production" ? "none" : "lax",
				secure: env.NODE_ENV === "production",
				httpOnly: true,
			},
		},
		plugins: [],
	});
}

export const auth = createAuth();
