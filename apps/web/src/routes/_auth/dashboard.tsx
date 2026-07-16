import { Button } from "@easy-training/ui/components/button";
import { Skeleton } from "@easy-training/ui/components/skeleton";
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
		return <DashboardSkeleton />;
	}

	if (snapshotQuery.isError) {
		return (
			<section className="grid min-h-72 place-items-center border">
				<div className="flex flex-col items-center gap-3 text-center">
					<h1 className="font-semibold text-lg">概览加载失败</h1>
					<p className="text-muted-foreground text-sm">
						{snapshotQuery.error.message}
					</p>
					<Button onClick={() => snapshotQuery.refetch()}>重试</Button>
				</div>
			</section>
		);
	}

	return <TrainingDashboard snapshot={snapshotQuery.data} />;
}

function DashboardSkeleton() {
	return (
		<div className="flex flex-col gap-6" aria-live="polite">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-32" />
				<Skeleton className="h-4 w-56" />
			</div>
			<div className="grid gap-px border bg-border md:grid-cols-4">
				{["a", "b", "c", "d"].map((key) => (
					<div className="bg-background p-4" key={key}>
						<Skeleton className="h-4 w-16" />
						<Skeleton className="mt-4 h-8 w-20" />
					</div>
				))}
			</div>
			<div className="grid gap-6 lg:grid-cols-2">
				<Skeleton className="h-80" />
				<Skeleton className="h-80" />
			</div>
		</div>
	);
}
