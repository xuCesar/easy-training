import type { z } from "zod";

export type EntityId = string;

export const EXPECTED_ORGANIZATION_HEADER = "X-Expected-Organization-Id";

export const LEAD_IMPORT_RPC_BODY_LIMIT_BYTES = 256 * 1024;
// Hono 对所有 RPC 请求应用同一限制，因此文案必须保持通用。
export const LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE =
	"请求内容超过 256 KiB 限制。";

/**
 * oRPC fetch transport 将调用 input 包装为 `{ json: input }` 后发送。
 * 此函数必须保持浏览器可用，不能依赖 Buffer 等 Node API。
 */
export function getLeadImportRpcBodyBytes(input: unknown): number {
	return new TextEncoder().encode(JSON.stringify({ json: input })).byteLength;
}

export function validateLeadImportRpcBodySize(
	input: { content: string },
	context: z.RefinementCtx,
) {
	if (getLeadImportRpcBodyBytes(input) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES) {
		context.addIssue({
			code: "custom",
			path: ["content"],
			message: LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
		});
	}
}
