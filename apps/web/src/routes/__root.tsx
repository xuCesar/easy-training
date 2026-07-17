import { Toaster } from "@easy-training/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
	const [isContextChangePending, setIsContextChangePending] = useState(false);

	useEffect(() => {
		let fallbackReload: number | undefined;
		const unsubscribe = subscribeToAuthChanges((change) => {
			void queryClient.cancelQueries();

			if (change.type === "organization-switch-started") {
				queryClient.clear();
				setIsContextChangePending(true);
				window.clearTimeout(fallbackReload);
				fallbackReload = window.setTimeout(() => {
					window.location.reload();
				}, 10_000);
				return;
			}

			window.clearTimeout(fallbackReload);
			queryClient.clear();
			window.location.reload();
		});

		return () => {
			window.clearTimeout(fallbackReload);
			unsubscribe();
		};
	}, []);

	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="light"
				storageKey="easy-training-theme"
			>
				{isContextChangePending ? <ContextChangePending /> : <Outlet />}
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

function ContextChangePending() {
	return (
		<main
			className="grid min-h-screen place-items-center text-muted-foreground text-sm"
			aria-live="polite"
			aria-busy="true"
		>
			<div className="flex items-center gap-2">
				<LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
				<span>正在同步机构信息</span>
			</div>
		</main>
	);
}
