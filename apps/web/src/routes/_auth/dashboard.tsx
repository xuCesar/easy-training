import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { TrainingDashboard } from "@/features/training/training-dashboard";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/dashboard")({
	component: DashboardRoute,
});

function DashboardRoute() {
	const snapshotQuery = useQuery(orpc.training.snapshot.queryOptions());

	if (snapshotQuery.isPending) {
		return (
			<main className="app-loading" aria-live="polite">
				<span />
				<p>正在加载教培运营数据...</p>
			</main>
		);
	}

	if (snapshotQuery.isError) {
		return (
			<main className="app-error" role="alert">
				<h1>数据加载失败</h1>
				<p>{snapshotQuery.error.message}</p>
				<button
					type="button"
					className="button button-primary"
					onClick={() => snapshotQuery.refetch()}
				>
					重新加载
				</button>
			</main>
		);
	}

	return <TrainingDashboard snapshot={snapshotQuery.data} />;
}
