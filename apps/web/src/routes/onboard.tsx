import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BuildingIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const ONBOARDING_TOKEN_KEY = "easy-training:onboarding-token";

export const Route = createFileRoute("/onboard")({
	component: OnboardingRoute,
	head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
});

function OnboardingRoute() {
	const navigate = useNavigate();
	const [token, setToken] = useState<string | null>(null);

	useEffect(() => {
		const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
			"token",
		);
		const nextToken =
			fromHash ?? window.sessionStorage.getItem(ONBOARDING_TOKEN_KEY);
		if (fromHash) {
			window.sessionStorage.setItem(ONBOARDING_TOKEN_KEY, fromHash);
			window.history.replaceState(null, "", window.location.pathname);
		}
		setToken(nextToken);
	}, []);

	if (token === null) {
		return null;
	}

	if (!token) {
		return (
			<main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center p-4">
				<Empty className="w-full border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<TriangleAlertIcon />
						</EmptyMedia>
						<EmptyTitle>开通链接无效</EmptyTitle>
						<EmptyDescription>
							请联系平台获取新的机构开通链接。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</main>
		);
	}

	return (
		<main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center p-4">
			<Empty className="w-full border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<BuildingIcon />
					</EmptyMedia>
					<EmptyTitle>开通机构</EmptyTitle>
					<EmptyDescription>
						请使用收到开通邀请的邮箱创建账号,注册完成后将自动创建您的机构。
					</EmptyDescription>
				</EmptyHeader>
				<Button
					className="w-full"
					onClick={() =>
						navigate({ to: "/login", search: { mode: "sign-up" } })
					}
				>
					创建机构账号
				</Button>
			</Empty>
		</main>
	);
}
