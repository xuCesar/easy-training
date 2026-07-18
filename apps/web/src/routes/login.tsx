import { createFileRoute } from "@tanstack/react-router";
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
	const [showSignIn, setShowSignIn] = useState(mode !== "sign-up");

	return showSignIn ? (
		<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
	) : (
		<SignUpForm
			isInvitation={isInvitation}
			onSwitchToSignIn={() => setShowSignIn(true)}
		/>
	);
}
