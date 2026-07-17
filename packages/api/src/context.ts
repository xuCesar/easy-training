import { auth } from "@easy-training/auth";
import type { Context as HonoContext } from "hono";

import { EXPECTED_ORGANIZATION_HEADER } from "./contracts/training";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		auth: null,
		session,
		expectedOrganizationId:
			context.req.header(EXPECTED_ORGANIZATION_HEADER) ?? null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
