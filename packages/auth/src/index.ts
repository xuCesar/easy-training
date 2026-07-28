import { db } from "@easy-training/db";
import {
	hasActiveInvitationForEmail,
	normalizeInvitationEmail,
} from "@easy-training/db/repositories/organization-management";
import { hasActiveOnboardingInvitationForEmail } from "@easy-training/db/repositories/organization-onboarding";
import * as schema from "@easy-training/db/schema/auth";
import { env } from "@easy-training/env/server";
import {
	sendEmailVerificationEmail,
	sendPasswordResetEmail,
} from "@easy-training/mail";
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
	"/send-verification-email",
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
			resetPasswordTokenExpiresIn: 60 * 60,
			sendResetPassword: async ({ user, url }) => {
				await sendPasswordResetEmail({
					to: user.email,
					userName: user.name,
					resetUrl: url,
				});
			},
		},
		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			expiresIn: 60 * 60 * 24,
			sendVerificationEmail: async ({ user, url }) => {
				await sendEmailVerificationEmail({
					to: user.email,
					userName: user.name,
					verificationUrl: url,
				});
			},
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
				if (invited) return;

				// 机构开通邀请(#66):要求请求头携带开通 token 并与该邮箱的
				// 有效邀请匹配,防止仅知邮箱者抢注。
				// 注意:钩子上下文里 HTTP 请求头在 ctx.request.headers(ctx.headers
				// 仅在服务端直调 auth.api 时由调用方传入)。
				const onboardingToken =
					ctx.request?.headers.get("x-onboarding-token") ??
					ctx.headers?.get("x-onboarding-token");
				const onboarding = await hasActiveOnboardingInvitationForEmail(
					email,
					onboardingToken,
				);
				if (!onboarding) {
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
			ipAddress: {
				// 生产 nginx 使用 $remote_addr 覆盖该请求头，避免信任客户端伪造的转发链。
				ipAddressHeaders: ["x-real-ip"],
			},
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
