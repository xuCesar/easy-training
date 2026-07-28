import assert from "node:assert/strict";
import test from "node:test";
import { EnvPlatformAuthorizationProvider } from "@easy-training/api/authorization/platform";
import {
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
} from "@easy-training/api/contracts/training";
import {
	BusinessMetricRangeError,
	resolveBusinessMetricWindow,
} from "@easy-training/api/repositories/business-metrics-time";

import { AUTH_BODY_LIMIT_BYTES, createApp } from "./app";

type LoggedEvent = {
	event: string;
	requestId: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	error?: string;
};

test("platform authorization requires a verified allowlisted session email", async () => {
	const provider = new EnvPlatformAuthorizationProvider([
		" Platform-Operator@Example.invalid ",
	]);
	assert.equal(
		await provider.can(
			{
				userId: "operator",
				email: "platform-operator@example.invalid",
				emailVerified: true,
			},
			"organization:onboard",
		),
		true,
	);
	assert.equal(
		await provider.can(
			{
				userId: "unverified",
				email: "platform-operator@example.invalid",
				emailVerified: false,
			},
			"organization:onboard",
		),
		false,
	);
	assert.equal(
		await new EnvPlatformAuthorizationProvider([]).can(
			{
				userId: "operator",
				email: "platform-operator@example.invalid",
				emailVerified: true,
			},
			"organization:onboard",
		),
		false,
	);
});

test("platform onboarding RPC responses disable caching", async () => {
	const app = createApp({ log: () => undefined });
	const response = await app.fetch(
		new Request("http://localhost/rpc/platform/onboarding/create", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://untrusted.invalid",
			},
			body: "{}",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("RPC body limit uses the shared lead import contract", async () => {
	const app = createApp({ log: () => undefined });

	const withinLimitResponse = await app.fetch(
		new Request("http://localhost/rpc/leads/import/preview", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://untrusted.invalid",
			},
			body: "a".repeat(LEAD_IMPORT_RPC_BODY_LIMIT_BYTES),
		}),
	);
	assert.equal(withinLimitResponse.status, 403);

	const exceedsLimitResponse = await app.fetch(
		new Request("http://localhost/rpc/leads/import/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "a".repeat(LEAD_IMPORT_RPC_BODY_LIMIT_BYTES + 1),
		}),
	);
	assert.equal(exceedsLimitResponse.status, 413);
	assert.deepEqual(await exceedsLimitResponse.json(), {
		error: { message: LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE },
	});
});

test("request ID is reused when valid and access logs omit request contents", async () => {
	const logs: LoggedEvent[] = [];
	const app = createApp({
		log: (event) => logs.push(event),
	});
	const requestId = "client-request-123";
	const response = await app.fetch(
		new Request("http://localhost/?access_token=should-not-be-logged", {
			headers: {
				Authorization: "Bearer should-not-be-logged",
				"X-Request-Id": requestId,
			},
		}),
	);

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("X-Request-Id"), requestId);
	assert.equal(logs.length, 1);
	assert.deepEqual(logs[0], {
		event: "http.access",
		requestId,
		method: "GET",
		path: "/",
		status: 200,
		durationMs: logs[0]?.durationMs,
	});
	assert.equal(JSON.stringify(logs).includes("should-not-be-logged"), false);
});

test("invalid request ID is replaced with a generated UUID", async () => {
	const app = createApp({ log: () => undefined });
	const response = await app.fetch(
		new Request("http://localhost/", {
			headers: { "X-Request-Id": "invalid request id" },
		}),
	);
	const requestId = response.headers.get("X-Request-Id");

	assert.equal(response.status, 200);
	assert.notEqual(requestId, "invalid request id");
	assert.match(
		requestId ?? "",
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	);
});

test("readiness checks the database without changing liveness", async () => {
	let readinessChecks = 0;
	const app = createApp({
		readinessCheck: async () => {
			readinessChecks += 1;
		},
		log: () => undefined,
	});

	const readyResponse = await app.fetch(new Request("http://localhost/readyz"));
	const livenessResponse = await app.fetch(new Request("http://localhost/"));

	assert.equal(readyResponse.status, 200);
	assert.equal(livenessResponse.status, 200);
	assert.equal(readinessChecks, 1);
});

test("readiness returns 503 when the database check fails", async () => {
	const app = createApp({
		readinessCheck: async () => {
			throw new Error("database password should not be logged");
		},
		log: () => undefined,
	});
	const response = await app.fetch(new Request("http://localhost/readyz"));

	assert.equal(response.status, 503);
	assert.equal(await response.text(), "Service Unavailable");
});

test("readiness returns 503 while shutdown is in progress", async () => {
	const app = createApp({
		isReady: () => false,
		log: () => undefined,
	});
	const response = await app.fetch(new Request("http://localhost/readyz"));

	assert.equal(response.status, 503);
	assert.equal(await response.text(), "Service Unavailable");
});

test("responses carry security headers, production adds HSTS", async () => {
	const devApp = createApp({ log: () => undefined, isProduction: false });
	const devResponse = await devApp.fetch(new Request("http://localhost/"));

	assert.equal(devResponse.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(devResponse.headers.get("X-Frame-Options"), "DENY");
	assert.equal(devResponse.headers.get("Referrer-Policy"), "no-referrer");
	assert.equal(
		devResponse.headers.get("Content-Security-Policy"),
		"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	);
	assert.equal(devResponse.headers.get("Strict-Transport-Security"), null);

	const prodApp = createApp({ log: () => undefined, isProduction: true });
	const prodResponse = await prodApp.fetch(new Request("http://localhost/"));

	assert.equal(
		prodResponse.headers.get("Strict-Transport-Security"),
		"max-age=15552000; includeSubDomains",
	);
	assert.equal(
		prodResponse.headers.get("Content-Security-Policy"),
		"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	);
});

test("auth routes reject untrusted origins and oversized bodies", async () => {
	const app = createApp({ log: () => undefined });

	const untrustedResponse = await app.fetch(
		new Request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://untrusted.invalid",
			},
			body: JSON.stringify({ email: "a@example.invalid", password: "x" }),
		}),
	);
	assert.equal(untrustedResponse.status, 403);

	const oversizedResponse = await app.fetch(
		new Request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "a".repeat(AUTH_BODY_LIMIT_BYTES + 1),
		}),
	);
	assert.equal(oversizedResponse.status, 413);
});

test("api reference is disabled in production unless explicitly enabled", async () => {
	const prodApp = createApp({ log: () => undefined, isProduction: true });
	const disabledResponse = await prodApp.fetch(
		new Request("http://localhost/api-reference"),
	);
	assert.equal(disabledResponse.status, 404);

	const enabledApp = createApp({
		log: () => undefined,
		isProduction: true,
		apiReferenceEnabled: true,
	});
	const enabledResponse = await enabledApp.fetch(
		new Request("http://localhost/api-reference"),
	);
	assert.equal(enabledResponse.status, 200);
	assert.equal(enabledResponse.headers.get("Content-Security-Policy"), null);
});

test("business metric month range uses Shanghai calendar and capped comparison", () => {
	const result = resolveBusinessMetricWindow(
		{ preset: "month" },
		new Date("2026-03-31T16:30:00.000Z"),
	);

	assert.deepEqual(result, {
		range: {
			from: "2026-03-31T16:00:00.000Z",
			to: "2026-03-31T16:30:00.000Z",
		},
		comparisonRange: {
			from: "2026-02-28T16:00:00.000Z",
			to: "2026-02-28T16:30:00.000Z",
		},
		granularity: "day",
	});
});

test("business metric rolling and custom ranges use stable comparison and granularity", () => {
	assert.deepEqual(
		resolveBusinessMetricWindow(
			{ preset: "last7Days" },
			new Date("2026-07-22T04:00:00.000Z"),
		),
		{
			range: {
				from: "2026-07-15T16:00:00.000Z",
				to: "2026-07-22T04:00:00.000Z",
			},
			comparisonRange: {
				from: "2026-07-09T04:00:00.000Z",
				to: "2026-07-15T16:00:00.000Z",
			},
			granularity: "day",
		},
	);

	const custom = resolveBusinessMetricWindow({
		preset: "custom",
		from: "2026-01-01",
		to: "2026-08-01",
	});
	assert.equal(custom.granularity, "week");
	assert.deepEqual(custom.range, {
		from: "2025-12-31T16:00:00.000Z",
		to: "2026-07-31T16:00:00.000Z",
	});
});

test("business metric custom range rejects invalid and oversized windows", () => {
	assert.throws(
		() =>
			resolveBusinessMetricWindow({
				preset: "custom",
				from: "2026-02-01",
				to: "2026-02-01",
			}),
		(error) =>
			error instanceof BusinessMetricRangeError &&
			error.code === "INVALID_RANGE",
	);
	assert.throws(
		() =>
			resolveBusinessMetricWindow({
				preset: "custom",
				from: "2024-01-01",
				to: "2026-01-03",
			}),
		(error) =>
			error instanceof BusinessMetricRangeError &&
			error.code === "RANGE_TOO_LARGE",
	);
});

test("机构开通邀请:携带匹配 token 的注册经完整 HTTP 栈放行,缺失或错误 token 拒绝", async () => {
	const { createOnboardingInvitationRecord, db } = await import(
		"@easy-training/db"
	);
	const { env } = await import("@easy-training/env/server");
	const email = `onboarding-e2e-${Date.now()}@example.invalid`;
	const app = createApp({ log: () => undefined });
	const signUp = (headers: Record<string, string>) =>
		app.fetch(
			new Request("http://localhost/api/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: env.CORS_ORIGIN,
					...headers,
				},
				body: JSON.stringify({
					email,
					name: "开通端到端",
					password: "Xx12345678901",
				}),
			}),
		);

	try {
		const created = await createOnboardingInvitationRecord({
			email,
			organizationName: "端到端开通机构",
		});

		const missingToken = await signUp({});
		assert.equal(missingToken.status, 403);
		const wrongToken = await signUp({ "x-onboarding-token": "wrong" });
		assert.equal(wrongToken.status, 403);

		const accepted = await signUp({ "x-onboarding-token": created.token });
		assert.equal(accepted.status, 200);
	} finally {
		await db.$client.query(
			"DELETE FROM platform_audit_event WHERE entity_id IN (SELECT id FROM organization_onboarding_invitation WHERE email_normalized = $1)",
			[email],
		);
		await db.$client.query('DELETE FROM "user" WHERE email = $1', [email]);
		await db.$client.query(
			"DELETE FROM organization_onboarding_invitation WHERE email_normalized = $1",
			[email],
		);
	}
});
