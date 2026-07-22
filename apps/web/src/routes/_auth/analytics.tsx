import { createFileRoute } from "@tanstack/react-router";

import { BusinessAnalytics } from "@/features/training/business-analytics";

export const Route = createFileRoute("/_auth/analytics")({
	component: BusinessAnalytics,
});
