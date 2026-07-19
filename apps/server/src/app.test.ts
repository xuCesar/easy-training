import assert from "node:assert/strict";
import test from "node:test";

import {
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
} from "@easy-training/api/contracts/training";

import { app } from "./app";

test("RPC body limit uses the shared lead import contract", async () => {
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
