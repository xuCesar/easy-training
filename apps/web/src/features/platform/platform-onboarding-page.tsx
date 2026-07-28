import type { PlatformOnboardingInvitation } from "@easy-training/api/contracts/platform";
import { Button } from "@easy-training/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@easy-training/ui/components/dropdown-menu";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@easy-training/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import {
	BanIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	LoaderCircleIcon,
	MoreHorizontalIcon,
	PlusIcon,
	RefreshCwIcon,
	RotateCcwIcon,
	SearchIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { formatDateTime } from "@/features/training/format";
import { orpc } from "@/utils/orpc";

import {
	CreateOnboardingDialog,
	type OnboardingConfirmation,
	OnboardingConfirmationDialog,
	type OnboardingSecret,
	OnboardingSecretDialog,
} from "./platform-onboarding-dialogs";

type StatusFilter = "all" | PlatformOnboardingInvitation["status"];

const statusLabels: Record<PlatformOnboardingInvitation["status"], string> = {
	pending: "待领取",
	claimed: "已领取",
	expired: "已过期",
	revoked: "已撤销",
};

const statusDotClasses: Record<PlatformOnboardingInvitation["status"], string> =
	{
		pending: "bg-blue-600",
		claimed: "bg-emerald-600",
		expired: "bg-amber-600",
		revoked: "bg-destructive",
	};

export function PlatformOnboardingPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const [confirmation, setConfirmation] =
		useState<OnboardingConfirmation | null>(null);
	const [secret, setSecret] = useState<OnboardingSecret | null>(null);
	const [status, setStatus] = useState<StatusFilter>("all");
	const [emailDraft, setEmailDraft] = useState("");
	const [email, setEmail] = useState("");
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);
	const currentCursor = cursorHistory.at(-1);
	const listQuery = useQuery(
		orpc.platform.onboarding.list.queryOptions({
			input: {
				limit: 10,
				...(status === "all" ? {} : { status }),
				...(email ? { email } : {}),
				...(currentCursor ? { cursor: currentCursor } : {}),
			},
		}),
	);

	function applyEmailFilter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalized = emailDraft.trim().toLocaleLowerCase("en-US");
		if (normalized && !z.email().safeParse(normalized).success) {
			toast.error("请输入完整有效的邮箱地址。");
			return;
		}
		setEmail(normalized);
		setCursorHistory([]);
	}

	async function refreshAfterChange() {
		setConfirmation(null);
		setCursorHistory([]);
		await listQuery.refetch();
	}

	async function showSecret(nextSecret: OnboardingSecret) {
		setCreateOpen(false);
		setConfirmation(null);
		setCursorHistory([]);
		setSecret(nextSecret);
		await listQuery.refetch();
	}

	return (
		<main className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8 lg:py-9">
			<section className="flex flex-col gap-5">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
							机构开通管理
						</h1>
						<p className="mt-2 text-muted-foreground text-sm">
							创建并管理新机构负责人的开通邀请。链接仅显示一次。
						</p>
					</div>
					<Button size="lg" onClick={() => setCreateOpen(true)}>
						<PlusIcon data-icon="inline-start" />
						<span className="hidden sm:inline">创建开通邀请</span>
						<span className="sm:hidden">创建邀请</span>
					</Button>
				</div>

				<div className="flex flex-col gap-2 border-y py-4 sm:flex-row">
					<form className="flex w-full max-w-md" onSubmit={applyEmailFilter}>
						<Input
							type="email"
							value={emailDraft}
							onChange={(event) => setEmailDraft(event.target.value)}
							placeholder="搜索完整邮箱"
							aria-label="搜索完整邮箱"
							className="border-r-0"
						/>
						<Button
							type="submit"
							variant="outline"
							size="icon"
							aria-label="搜索"
						>
							<SearchIcon />
						</Button>
					</form>
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus((value ?? "all") as StatusFilter);
							setCursorHistory([]);
						}}
					>
						<SelectTrigger className="w-full sm:w-40" aria-label="邀请状态">
							<SelectValue>
								{() => (status === "all" ? "全部状态" : statusLabels[status])}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">全部状态</SelectItem>
							<SelectItem value="pending">待领取</SelectItem>
							<SelectItem value="claimed">已领取</SelectItem>
							<SelectItem value="expired">已过期</SelectItem>
							<SelectItem value="revoked">已撤销</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant="outline"
						size="icon"
						aria-label="刷新邀请列表"
						disabled={listQuery.isFetching}
						onClick={() => listQuery.refetch()}
					>
						<RefreshCwIcon
							className={listQuery.isFetching ? "animate-spin" : ""}
						/>
					</Button>
				</div>

				{listQuery.isPending ? (
					<div
						className="grid min-h-64 place-items-center border"
						aria-busy="true"
					>
						<div className="flex items-center gap-2 text-muted-foreground text-sm">
							<LoaderCircleIcon className="size-4 animate-spin" />
							正在加载邀请
						</div>
					</div>
				) : listQuery.isError ? (
					<div className="grid min-h-64 place-items-center border p-5 text-center">
						<div>
							<h2 className="font-medium">邀请列表加载失败</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								{listQuery.error.message}
							</p>
							<Button className="mt-4" onClick={() => listQuery.refetch()}>
								重试
							</Button>
						</div>
					</div>
				) : listQuery.data.items.length === 0 ? (
					<div className="grid min-h-64 place-items-center border p-5 text-center">
						<div>
							<h2 className="font-medium">暂无符合条件的开通邀请</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								可以调整筛选条件，或创建第一条邀请。
							</p>
						</div>
					</div>
				) : (
					<>
						<div className="hidden border md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>受邀邮箱</TableHead>
										<TableHead>机构名称</TableHead>
										<TableHead>状态</TableHead>
										<TableHead>创建人</TableHead>
										<TableHead>创建时间</TableHead>
										<TableHead>有效期</TableHead>
										<TableHead className="w-16 text-right">操作</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listQuery.data.items.map((invitation) => (
										<TableRow key={invitation.id}>
											<TableCell className="font-medium">
												{invitation.email}
											</TableCell>
											<TableCell>{invitation.organizationName}</TableCell>
											<TableCell>
												<StatusLabel status={invitation.status} />
											</TableCell>
											<TableCell>
												{invitation.createdBy?.name ?? "紧急脚本"}
											</TableCell>
											<TableCell className="tabular-nums">
												{formatDateTime(invitation.createdAt)}
											</TableCell>
											<TableCell className="tabular-nums">
												{formatDateTime(invitation.expiresAt)}
											</TableCell>
											<TableCell className="text-right">
												<InvitationActions
													invitation={invitation}
													onConfirm={setConfirmation}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>

						<div className="divide-y border md:hidden">
							{listQuery.data.items.map((invitation) => (
								<article key={invitation.id} className="p-4">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<StatusLabel status={invitation.status} />
											<h2 className="mt-2 truncate font-medium text-sm">
												{invitation.email}
											</h2>
											<p className="mt-1 truncate text-muted-foreground text-sm">
												{invitation.organizationName}
											</p>
										</div>
										<InvitationActions
											invitation={invitation}
											onConfirm={setConfirmation}
										/>
									</div>
									<dl className="mt-4 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
										<dt className="text-muted-foreground">创建时间</dt>
										<dd>{formatDateTime(invitation.createdAt)}</dd>
										<dt className="text-muted-foreground">有效期至</dt>
										<dd>{formatDateTime(invitation.expiresAt)}</dd>
										<dt className="text-muted-foreground">创建人</dt>
										<dd>{invitation.createdBy?.name ?? "紧急脚本"}</dd>
									</dl>
								</article>
							))}
						</div>

						<div className="flex items-center justify-end gap-2">
							<Button
								variant="outline"
								size="icon"
								aria-label="上一页"
								disabled={cursorHistory.length === 0 || listQuery.isFetching}
								onClick={() =>
									setCursorHistory((history) => history.slice(0, -1))
								}
							>
								<ChevronLeftIcon />
							</Button>
							<span className="min-w-16 text-center text-muted-foreground text-xs">
								第 {cursorHistory.length + 1} 页
							</span>
							<Button
								variant="outline"
								size="icon"
								aria-label="下一页"
								disabled={!listQuery.data.nextCursor || listQuery.isFetching}
								onClick={() => {
									if (listQuery.data.nextCursor) {
										setCursorHistory((history) => [
											...history,
											listQuery.data.nextCursor as string,
										]);
									}
								}}
							>
								<ChevronRightIcon />
							</Button>
						</div>
					</>
				)}
			</section>

			<CreateOnboardingDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={showSecret}
			/>
			<OnboardingConfirmationDialog
				confirmation={confirmation}
				onOpenChange={(open) => !open && setConfirmation(null)}
				onChanged={refreshAfterChange}
				onRotated={showSecret}
			/>
			<OnboardingSecretDialog secret={secret} onClose={() => setSecret(null)} />
		</main>
	);
}

function StatusLabel({
	status,
}: {
	status: PlatformOnboardingInvitation["status"];
}) {
	return (
		<span className="inline-flex items-center gap-2 text-xs">
			<span
				className={`size-2 rounded-full ${statusDotClasses[status]}`}
				aria-hidden="true"
			/>
			{statusLabels[status]}
		</span>
	);
}

function InvitationActions({
	invitation,
	onConfirm,
}: {
	invitation: PlatformOnboardingInvitation;
	onConfirm: (confirmation: OnboardingConfirmation) => void;
}) {
	if (invitation.status === "claimed") {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label={`管理 ${invitation.email} 的邀请`}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={() =>
						onConfirm({
							kind: "rotate",
							invitation,
							requestId: crypto.randomUUID(),
						})
					}
				>
					<RotateCcwIcon />
					重新生成
				</DropdownMenuItem>
				{invitation.status === "pending" ? (
					<DropdownMenuItem
						variant="destructive"
						onClick={() => onConfirm({ kind: "revoke", invitation })}
					>
						<BanIcon />
						撤销
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
