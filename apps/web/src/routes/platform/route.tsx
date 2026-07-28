import { Avatar, AvatarFallback } from "@easy-training/ui/components/avatar";
import { Button, buttonVariants } from "@easy-training/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@easy-training/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { Building2Icon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { notifyAuthChange } from "@/utils/auth-session-sync";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/platform")({
	component: PlatformLayout,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({
				to: "/login",
				search: { redirect: "/platform/onboarding" },
			});
		}
		return { session };
	},
});

function PlatformLayout() {
	const session = Route.useRouteContext().session.data;
	const accessQuery = useQuery({
		...orpc.platform.access.get.queryOptions(),
		retry: false,
	});
	const initials = session?.user.name.slice(0, 1) ?? "U";

	if (accessQuery.isPending) {
		return (
			<main className="grid min-h-dvh place-items-center" aria-busy="true">
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<LoaderCircleIcon className="size-4 animate-spin" />
					正在验证平台权限
				</div>
			</main>
		);
	}

	if (accessQuery.isError) {
		return (
			<main className="grid min-h-dvh place-items-center p-4">
				<section className="w-full max-w-md border p-6 text-center">
					<h1 className="font-semibold text-lg">平台权限验证失败</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						{accessQuery.error.message}
					</p>
					<Button className="mt-4" onClick={() => accessQuery.refetch()}>
						重试
					</Button>
				</section>
			</main>
		);
	}

	if (!accessQuery.data.canManageOnboarding) {
		return (
			<main className="grid min-h-dvh place-items-center p-4">
				<section className="w-full max-w-md border p-6 text-center">
					<h1 className="font-semibold text-lg">无平台管理权限</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						当前账号不在平台操作员白名单中，或邮箱尚未验证。
					</p>
					<Link
						to="/"
						className={buttonVariants({
							variant: "outline",
							className: "mt-4",
						})}
					>
						返回首页
					</Link>
				</section>
			</main>
		);
	}

	return (
		<div className="min-h-dvh bg-background">
			<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-3 px-4 lg:px-8">
					<Link
						to="/platform/onboarding"
						className="flex items-center gap-2 font-semibold text-lg text-primary"
					>
						<Building2Icon className="size-5" />
						Easy Training
					</Link>
					<span className="hidden border-l pl-3 text-muted-foreground text-sm sm:inline">
						平台管理
					</span>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="ghost" className="ml-auto h-9 gap-2 px-1.5" />
							}
						>
							<Avatar size="sm">
								<AvatarFallback>{initials}</AvatarFallback>
							</Avatar>
							<span className="hidden max-w-32 truncate sm:inline">
								{session?.user.name}
							</span>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-52">
							<DropdownMenuGroup>
								<DropdownMenuLabel>{session?.user.email}</DropdownMenuLabel>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem render={<Link to="/dashboard" />}>
									进入机构工作台
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={async () => {
										const result = await authClient.signOut();
										if (result.error) {
											toast.error(
												result.error.message || "退出失败，请稍后重试。",
											);
											return;
										}
										queryClient.clear();
										notifyAuthChange();
										window.location.assign("/login");
									}}
								>
									退出登录
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>
			<Outlet />
		</div>
	);
}
