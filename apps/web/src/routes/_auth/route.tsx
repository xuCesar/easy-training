import { Avatar, AvatarFallback } from "@easy-training/ui/components/avatar";
import { Button, buttonVariants } from "@easy-training/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@easy-training/ui/components/dropdown-menu";
import { Input } from "@easy-training/ui/components/input";
import { Separator } from "@easy-training/ui/components/separator";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@easy-training/ui/components/sheet";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@easy-training/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useRouterState,
} from "@tanstack/react-router";
import {
	BellIcon,
	BookOpenIcon,
	CalendarDaysIcon,
	LayoutDashboardIcon,
	MenuIcon,
	ReceiptTextIcon,
	SearchIcon,
	UsersRoundIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { notifyAuthChange } from "@/utils/auth-session-sync";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({ to: "/login" });
		}
		return { session };
	},
});

const navigation = [
	{
		to: "/dashboard",
		label: "运营工作台",
		icon: LayoutDashboardIcon,
		available: true,
	},
	{ to: "/leads", label: "招生线索", icon: UsersRoundIcon, available: true },
	{
		to: "/finance",
		label: "应收账单",
		icon: ReceiptTextIcon,
		available: true,
		roles: ["owner", "admin", "campus_manager", "finance"],
	},
	{ to: "/dashboard", label: "学员中心", icon: BookOpenIcon, available: false },
	{
		to: "/dashboard",
		label: "教务排课",
		icon: CalendarDaysIcon,
		available: false,
	},
] as const;

function AuthLayout() {
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const session = Route.useRouteContext().session.data;
	const organizationOptions = orpc.training.organization.current.queryOptions();
	const organizationQuery = useQuery({
		...organizationOptions,
		queryKey: [
			...organizationOptions.queryKey,
			{ sessionUserId: session?.user.id },
		],
	});
	const organization = organizationQuery.data;
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const initials = session?.user.name.slice(0, 1) ?? "U";

	return (
		<TooltipProvider>
			<div className="min-h-dvh bg-background lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
				<aside className="hidden border-r bg-card lg:flex lg:flex-col">
					<Sidebar pathname={pathname} role={organization?.role} />
				</aside>
				<div className="min-w-0">
					<header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
						<Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
							<SheetTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										className="lg:hidden"
										aria-label="打开主导航"
									/>
								}
							>
								<MenuIcon data-icon="inline" />
							</SheetTrigger>
							<SheetContent className="p-0 lg:hidden">
								<div className="flex h-14 items-center justify-between px-4">
									<SheetTitle className="font-semibold">
										Easy Training
									</SheetTitle>
									<SheetClose
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="关闭主导航"
											/>
										}
									>
										<XIcon data-icon="inline" />
									</SheetClose>
								</div>
								<Separator />
								<Sidebar
									pathname={pathname}
									role={organization?.role}
									mobile
									onNavigate={() => setMobileNavOpen(false)}
								/>
							</SheetContent>
						</Sheet>
						<div className="min-w-0">
							{organizationQuery.isPending ? (
								<Skeleton className="h-4 w-28" />
							) : (
								<p className="truncate font-medium text-sm">
									{organization?.name ?? "机构信息不可用"}
								</p>
							)}
							<p className="text-muted-foreground text-xs">
								{formatRole(organization?.role)}
							</p>
						</div>
						<div className="ml-auto hidden w-full max-w-sm md:block">
							<div className="relative">
								<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									aria-label="全局搜索"
									className="pl-8"
									placeholder="搜索功能即将开放"
									disabled
								/>
							</div>
						</div>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button variant="ghost" size="icon" aria-label="查看通知" />
								}
							>
								<BellIcon data-icon="inline" />
							</TooltipTrigger>
							<TooltipContent>通知中心即将开放</TooltipContent>
						</Tooltip>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										className="h-9 gap-2 px-1.5"
										aria-label="打开用户菜单"
									/>
								}
							>
								<Avatar size="sm">
									<AvatarFallback>{initials}</AvatarFallback>
								</Avatar>
								<span className="hidden max-w-28 truncate sm:inline">
									{session?.user.name}
								</span>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-48">
								<DropdownMenuLabel>{session?.user.email}</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={async () => {
										const result = await authClient.signOut();
										if (result.error) {
											toast.error(
												result.error.message ||
													result.error.statusText ||
													"退出失败，请稍后重试。",
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
							</DropdownMenuContent>
						</DropdownMenu>
					</header>
					<main className="mx-auto w-full max-w-7xl p-4 lg:p-6">
						<Outlet />
					</main>
				</div>
			</div>
		</TooltipProvider>
	);
}

const roleLabels: Record<string, string> = {
	owner: "机构负责人",
	admin: "管理员",
	campus_manager: "校区负责人",
	consultant: "招生顾问",
	teacher: "教师",
	finance: "财务",
};

function formatRole(role: string | undefined) {
	return role ? (roleLabels[role] ?? "机构成员") : "机构成员";
}

function Sidebar({
	pathname,
	role,
	mobile = false,
	onNavigate,
}: {
	pathname: string;
	role?: string;
	mobile?: boolean;
	onNavigate?: () => void;
}) {
	const content = (
		<>
			<div className="px-4 py-5">
				<p className="font-semibold">Easy Training</p>
				<p className="mt-1 text-muted-foreground text-xs">教培运营系统</p>
			</div>
			<nav className="grid gap-1 px-2" aria-label="主导航">
				{navigation.map((item) => {
					if (
						"roles" in item &&
						!item.roles.some((allowedRole) => allowedRole === role)
					) {
						return null;
					}
					const Icon = item.icon;
					if (!item.available)
						return (
							<Tooltip key={item.label}>
								<TooltipTrigger
									render={
										<Button
											variant="ghost"
											className="justify-start text-muted-foreground"
											disabled
										>
											<Icon data-icon="inline-start" />
											{item.label}
											<span className="ml-auto text-[10px]">即将开放</span>
										</Button>
									}
								/>
								<TooltipContent>此模块即将开放</TooltipContent>
							</Tooltip>
						);
					return (
						<Link
							key={item.to}
							to={item.to}
							className={buttonVariants({
								variant: pathname === item.to ? "secondary" : "ghost",
								className: "justify-start",
							})}
							aria-current={pathname === item.to ? "page" : undefined}
							onClick={onNavigate}
						>
							<Icon data-icon="inline-start" />
							{item.label}
						</Link>
					);
				})}
			</nav>
		</>
	);
	return mobile ? (
		<div className="flex flex-col">{content}</div>
	) : (
		<div className="flex h-dvh flex-col">
			{content}
			<p className="mt-auto px-4 pb-5 text-muted-foreground text-xs">
				仅显示已开放功能
			</p>
		</div>
	);
}
