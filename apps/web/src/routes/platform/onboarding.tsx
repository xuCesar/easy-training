import { createFileRoute } from "@tanstack/react-router";

import { PlatformOnboardingPage } from "@/features/platform/platform-onboarding-page";

export const Route = createFileRoute("/platform/onboarding")({
	component: PlatformOnboardingPage,
});
