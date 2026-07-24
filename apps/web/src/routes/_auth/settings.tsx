import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/training/settings-page";

export const Route = createFileRoute("/_auth/settings")({
	component: SettingsRoute,
});

function SettingsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	return <SettingsPage sessionUserId={sessionUserId} />;
}
