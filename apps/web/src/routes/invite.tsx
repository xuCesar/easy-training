import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	LoaderCircleIcon,
	MailCheckIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { notifyAuthChange } from "@/utils/auth-session-sync";
import { orpc, queryClient } from "@/utils/orpc";

const INVITATION_TOKEN_KEY = "easy-training:invitation-token";

export const Route = createFileRoute("/invite")({
	component: InvitationClaimRoute,
	head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
});

function InvitationClaimRoute() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();
	const [token, setToken] = useState<string | null>(null);
	const [claimError, setClaimError] = useState<string | null>(null);
	const claimMutation = useMutation({
		...orpc.training.invitations.claim.mutationOptions(),
		onSuccess: async () => {
			window.sessionStorage.removeItem(INVITATION_TOKEN_KEY);
			queryClient.clear();
			notifyAuthChange();
			toast.success("已加入机构");
			await navigate({ to: "/dashboard" });
		},
		onError: (error) => {
			const message = getErrorMessage(error);
			setClaimError(message);
			toast.error(message);
		},
	});

	useEffect(() => {
		const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
			"token",
		);
		const nextToken =
			fromHash ?? window.sessionStorage.getItem(INVITATION_TOKEN_KEY);
		if (fromHash) {
			window.sessionStorage.setItem(INVITATION_TOKEN_KEY, fromHash);
			window.history.replaceState(null, "", window.location.pathname);
		}
		setToken(nextToken);
	}, []);

	if (isPending || token === null) {
		return (
			<ClaimState
				icon={<LoaderCircleIcon className="animate-spin" />}
				title="正在准备邀请"
			/>
		);
	}

	if (!token) {
		return (
			<ClaimState
				icon={<TriangleAlertIcon />}
				title="邀请链接无效"
				description="请向机构管理员索取新的邀请链接。"
			/>
		);
	}

	if (!session) {
		return (
			<ClaimState
				icon={<MailCheckIcon />}
				title="加入机构"
				description="请使用受邀邮箱登录，或创建账号后加入机构。"
				action={
					<div className="grid w-full gap-2 sm:grid-cols-2">
						<Button
							variant="outline"
							onClick={() =>
								navigate({ to: "/login", search: { mode: "sign-in" } })
							}
						>
							已有账号，登录
						</Button>
						<Button
							onClick={() =>
								navigate({ to: "/login", search: { mode: "sign-up" } })
							}
						>
							首次使用，注册
						</Button>
					</div>
				}
			/>
		);
	}

	return (
		<ClaimState
			icon={<MailCheckIcon />}
			title="确认加入机构"
			description={
				claimError ??
				(session.user.emailVerified
					? `将以 ${session.user.email} 加入受邀机构。`
					: `请先验证 ${session.user.email} 的邮箱控制权，再领取邀请。`)
			}
			action={
				<Button
					disabled={claimMutation.isPending || !session.user.emailVerified}
					onClick={() => {
						setClaimError(null);
						claimMutation.mutate({ token });
					}}
				>
					{claimMutation.isPending
						? "正在加入"
						: session.user.emailVerified
							? "确认加入"
							: "请先验证邮箱"}
				</Button>
			}
		/>
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "领取失败，请稍后重试。";
}

function ClaimState({
	icon,
	title,
	description,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center p-4">
			<Empty className="w-full border">
				<EmptyHeader>
					<EmptyMedia variant="icon">{icon}</EmptyMedia>
					<EmptyTitle>{title}</EmptyTitle>
					{description ? (
						<EmptyDescription>{description}</EmptyDescription>
					) : null}
				</EmptyHeader>
				{action}
			</Empty>
		</main>
	);
}
