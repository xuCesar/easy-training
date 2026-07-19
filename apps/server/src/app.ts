import { createContext } from "@easy-training/api/context";
import {
	EXPECTED_ORGANIZATION_HEADER,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
} from "@easy-training/api/contracts/training";
import { appRouter } from "@easy-training/api/routers/index";
import { auth } from "@easy-training/auth";
import { env } from "@easy-training/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

function logUnexpectedOrpcError(error: unknown) {
	if (error instanceof ORPCError && error.status < 500) return;
	console.error(error);
}

const rpcBodyLimit = bodyLimit({
	maxSize: LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	onError: (c) =>
		c.json({ error: { message: LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE } }, 413),
});

const requireTrustedOrigin: MiddlewareHandler = async (c, next) => {
	if (c.req.method === "GET" || c.req.method === "OPTIONS") {
		return next();
	}

	if (c.req.header("Origin") !== env.CORS_ORIGIN) {
		return c.json({ error: { message: "请求来源不受信任。" } }, 403);
	}

	return next();
};

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			logUnexpectedOrpcError(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			logUnexpectedOrpcError(error);
		}),
	],
});

export function createApp() {
	const app = new Hono();

	app.use(logger());
	app.use(
		"/*",
		cors({
			origin: env.CORS_ORIGIN,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"Authorization",
				EXPECTED_ORGANIZATION_HEADER,
			],
			credentials: true,
		}),
	);
	app.use("/rpc/*", rpcBodyLimit);
	app.use("/api-reference/*", rpcBodyLimit);
	app.use("/rpc/*", requireTrustedOrigin);
	app.use("/api-reference/*", requireTrustedOrigin);
	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	app.use("/*", async (c, next) => {
		const context = await createContext({ context: c });

		const rpcResult = await rpcHandler.handle(c.req.raw, {
			prefix: "/rpc",
			context,
		});

		if (rpcResult.matched) {
			return c.newResponse(rpcResult.response.body, rpcResult.response);
		}

		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: "/api-reference",
			context,
		});

		if (apiResult.matched) {
			return c.newResponse(apiResult.response.body, apiResult.response);
		}

		await next();
	});
	app.get("/", (c) => c.text("OK"));

	return app;
}

export const app = createApp();
