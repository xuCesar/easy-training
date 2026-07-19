import { randomUUID } from "node:crypto";

import { createContext } from "@easy-training/api/context";
import {
	EXPECTED_ORGANIZATION_HEADER,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
} from "@easy-training/api/contracts/training";
import { appRouter } from "@easy-training/api/routers/index";
import { auth } from "@easy-training/auth";
import { db } from "@easy-training/db";
import { env } from "@easy-training/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_CONTEXT_KEY = "requestId";
const MAX_REQUEST_ID_LENGTH = 128;
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

type AccessLogEvent = {
	event: "http.access";
	requestId: string;
	method: string;
	path: string;
	status: number;
	durationMs: number;
};

type UnexpectedErrorLogEvent = {
	event: "http.unexpected_error";
	requestId: string;
	error: "Unexpected server error";
};

type StructuredLogEvent = AccessLogEvent | UnexpectedErrorLogEvent;
type StructuredLogger = (event: StructuredLogEvent) => void;

type CreateAppDependencies = {
	readinessCheck?: () => Promise<unknown>;
	log?: StructuredLogger;
};

type AppEnvironment = {
	Variables: {
		requestId: string;
	};
};

function logStructuredEvent(event: StructuredLogEvent) {
	console.log(JSON.stringify(event));
}

function isValidRequestId(requestId: string | undefined): requestId is string {
	return (
		requestId !== undefined &&
		requestId.length <= MAX_REQUEST_ID_LENGTH &&
		VALID_REQUEST_ID.test(requestId)
	);
}

function getRequestId(requestId: string | undefined) {
	return isValidRequestId(requestId) ? requestId : randomUUID();
}

function getContextRequestId(context: unknown) {
	if (
		typeof context === "object" &&
		context !== null &&
		"requestId" in context &&
		typeof context.requestId === "string"
	) {
		return context.requestId;
	}

	return "unknown";
}

function logUnexpectedOrpcError(
	error: unknown,
	context: unknown,
	log: StructuredLogger,
) {
	if (error instanceof ORPCError && error.status < 500) return;
	log({
		event: "http.unexpected_error",
		requestId: getContextRequestId(context),
		error: "Unexpected server error",
	});
}

function createApiHandler(log: StructuredLogger) {
	return new OpenAPIHandler(appRouter, {
		plugins: [
			new OpenAPIReferencePlugin({
				schemaConverters: [new ZodToJsonSchemaConverter()],
			}),
		],
		interceptors: [
			onError((error, options) => {
				logUnexpectedOrpcError(error, options.context, log);
			}),
		],
	});
}

function createRpcHandler(log: StructuredLogger) {
	return new RPCHandler(appRouter, {
		interceptors: [
			onError((error, options) => {
				logUnexpectedOrpcError(error, options.context, log);
			}),
		],
	});
}

async function checkReadiness() {
	await db.$client.query("SELECT 1");
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

export const apiHandler = createApiHandler(logStructuredEvent);
export const rpcHandler = createRpcHandler(logStructuredEvent);

export function createApp(dependencies: CreateAppDependencies = {}) {
	const app = new Hono<AppEnvironment>();
	const log = dependencies.log ?? logStructuredEvent;
	const readinessCheck = dependencies.readinessCheck ?? checkReadiness;
	const apiHandler = createApiHandler(log);
	const rpcHandler = createRpcHandler(log);

	app.use("/*", async (c, next) => {
		const requestId = getRequestId(c.req.header(REQUEST_ID_HEADER));
		const startedAt = Date.now();

		c.set(REQUEST_ID_CONTEXT_KEY, requestId);
		c.header(REQUEST_ID_HEADER, requestId);

		try {
			await next();
		} catch {
			log({
				event: "http.unexpected_error",
				requestId,
				error: "Unexpected server error",
			});
			return c.text("Internal Server Error", 500);
		} finally {
			log({
				event: "http.access",
				requestId,
				method: c.req.method,
				path: c.req.path,
				status: c.res.status,
				durationMs: Date.now() - startedAt,
			});
		}
	});
	app.use(
		"/*",
		cors({
			origin: env.CORS_ORIGIN,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"Authorization",
				REQUEST_ID_HEADER,
				EXPECTED_ORGANIZATION_HEADER,
			],
			exposeHeaders: [REQUEST_ID_HEADER],
			credentials: true,
		}),
	);
	app.get("/readyz", async (c) => {
		try {
			await readinessCheck();
			return c.text("OK");
		} catch {
			return c.text("Service Unavailable", 503);
		}
	});
	app.use("/rpc/*", rpcBodyLimit);
	app.use("/api-reference/*", rpcBodyLimit);
	app.use("/rpc/*", requireTrustedOrigin);
	app.use("/api-reference/*", requireTrustedOrigin);
	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	app.use("/*", async (c, next) => {
		const context = {
			...(await createContext({ context: c })),
			requestId: c.get(REQUEST_ID_CONTEXT_KEY),
		};

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
