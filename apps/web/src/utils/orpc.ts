import { EXPECTED_ORGANIZATION_HEADER } from "@easy-training/api/contracts/training";
import type { AppRouterClient } from "@easy-training/api/routers/index";
import { env } from "@easy-training/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 60_000,
				gcTime: 10 * 60_000,
				refetchOnWindowFocus: false,
			},
		},
		queryCache: new QueryCache({
			onError: (error, query) => {
				toast.error(`请求失败：${error.message}`, {
					action: {
						label: "重试",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
	});
}

export const queryClient = createQueryClient();

let expectedOrganizationId: string | null = null;

export function setExpectedOrganizationId(organizationId: string | null): void {
	expectedOrganizationId = organizationId;
}

function getServerUrl(url: string) {
	const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

	if (!normalized.startsWith("/")) {
		return normalized;
	}

	if (typeof window !== "undefined") {
		return `${window.location.origin}${normalized}`;
	}

	const processEnv = (
		globalThis as {
			process?: { env?: Record<string, string | undefined> };
		}
	).process?.env;
	const vercelUrl =
		processEnv?.VERCEL_ENV === "production"
			? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
			: (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
	if (vercelUrl) {
		const origin = vercelUrl.startsWith("http")
			? vercelUrl
			: `https://${vercelUrl}`;
		return `${origin}${normalized}`;
	}

	return `http://localhost:3000${normalized}`;
}
export const link = new RPCLink({
	url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
	headers: () =>
		expectedOrganizationId
			? { [EXPECTED_ORGANIZATION_HEADER]: expectedOrganizationId }
			: {},
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
