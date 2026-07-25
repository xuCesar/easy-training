import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
			.number()
			.int()
			.min(1)
			.max(3600)
			.default(60),
		AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
		AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS: z.coerce
			.number()
			.int()
			.min(1)
			.max(3600)
			.default(60),
		AUTH_SENSITIVE_RATE_LIMIT_MAX: z.coerce
			.number()
			.int()
			.min(1)
			.max(1000)
			.default(5),
		AUTH_PASSWORD_MIN_LENGTH: z.coerce
			.number()
			.int()
			.min(8)
			.max(128)
			.default(10),
		AUTH_PASSWORD_MAX_LENGTH: z.coerce
			.number()
			.int()
			.min(8)
			.max(256)
			.default(128),
		CORS_ORIGIN: z.url(),
		PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
		DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(3_600_000)
			.default(30_000),
		DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(300_000)
			.default(5_000),
		DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(3_600_000)
			.default(15_000),
		ALLOW_PUBLIC_SIGNUP: z.coerce.boolean().default(false),
		SHUTDOWN_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(300_000)
			.default(10_000),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
