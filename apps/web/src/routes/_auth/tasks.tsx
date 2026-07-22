import { createFileRoute } from "@tanstack/react-router";

import { OperationTaskWorkspace } from "@/features/training/operation-task-workspace";

export const Route = createFileRoute("/_auth/tasks")({
	component: OperationTasksRoute,
});

function OperationTasksRoute() {
	const userId = Route.useRouteContext().session.data?.user.id;
	if (!userId) return null;
	return <OperationTaskWorkspace userId={userId} />;
}
