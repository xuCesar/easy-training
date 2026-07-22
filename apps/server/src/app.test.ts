import assert from "node:assert/strict";
import test from "node:test";

import {
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
} from "@easy-training/api/contracts/training";
import {
	BusinessMetricRangeError,
	resolveBusinessMetricWindow,
} from "@easy-training/api/repositories/business-metrics-time";

import { createApp } from "./app";

type LoggedEvent = {
	event: string;
	requestId: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	error?: string;
};

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
