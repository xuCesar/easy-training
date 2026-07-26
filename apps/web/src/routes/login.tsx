import { env } from "@easy-training/env/web";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { createFileRoute } from "@tanstack/react-router";
import { MailCheckIcon } from "lucide-react";
import { useState } from "react";
import z from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/login")({
	validateSearch: z.object({
		mode: z.enum(["sign-in", "sign-up"]).optional(),
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { mode } = Route.useSearch();
	const isInvitation =
		typeof window !== "undefined" &&
		Boolean(window.sessionStorage.getItem("easy-training:invitation-token"));
	const isOnboarding =
		typeof window !== "undefined" &&
		Boolean(window.sessionStorage.getItem("easy-training:onboarding-token"));
	const [showSignIn, setShowSignIn] = useState(mode !== "sign-up");

	if (
		!showSignIn &&
		!env.VITE_ALLOW_PUBLIC_SIGNUP &&
		!isInvitation &&
		!isOnboarding
	) {
		return (
			<main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center p-4">
				<Empty className="w-full border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MailCheckIcon />
						</EmptyMedia>
						<EmptyTitle>当前仅支持邀请注册</EmptyTitle>
						<EmptyDescription>
							请通过机构管理员发送的邀请链接创建账号；已有账号可直接登录。
						</EmptyDescription>
					</EmptyHeader>
					<Button className="w-full" onClick={() => setShowSignIn(true)}>
						返回登录
					</Button>
				</Empty>
			</main>
		);
	}

	return showSignIn ? (
		<SignInForm
			allowPublicSignup={
				env.VITE_ALLOW_PUBLIC_SIGNUP || isInvitation || isOnboarding
			}
			onSwitchToSignUp={() => setShowSignIn(false)}
		/>
	) : (
		<SignUpForm
			isInvitation={isInvitation}
			isOnboarding={isOnboarding}
			onSwitchToSignIn={() => setShowSignIn(true)}
		/>
	);
}
