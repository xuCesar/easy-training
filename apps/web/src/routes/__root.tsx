import { Toaster } from "@easy-training/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { subscribeToAuthChanges } from "@/utils/auth-session-sync";
import { type orpc, queryClient } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{ title: "Easy Training 教培管理系统" },
			{
				name: "description",
				content: "面向多校区教培机构的招生、学员、教务和财务管理系统",
			},
		],
	}),
});

function RootComponent() {
	useEffect(
		() =>
			subscribeToAuthChanges(() => {
				queryClient.clear();
				window.location.reload();
			}),
		[],
	);

	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="light"
				storageKey="easy-training-theme"
			>
				<Outlet />
				<Toaster richColors />
			</ThemeProvider>
			{import.meta.env.DEV ? (
				<>
					<TanStackRouterDevtools position="bottom-left" />
					<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
				</>
			) : null}
		</>
	);
}
