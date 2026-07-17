import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LockKeyholeIcon, ReceiptTextIcon } from "lucide-react";

import { FinanceWorkspace } from "@/features/training/finance-workspace";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/finance")({
	component: FinanceRoute,
});

const financeRoles = new Set(["owner", "admin", "campus_manager", "finance"]);

function FinanceRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const organizationOptions = orpc.training.organization.current.queryOptions();
	const organizationQuery = useQuery({
		...organizationOptions,
		queryKey: [
			...organizationOptions.queryKey,
			{ sessionUserId, financeRouteAccess: true },
		],
	});

	if (organizationQuery.isPending) {
		return <FinanceRouteSkeleton />;
	}

	if (organizationQuery.isError) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ReceiptTextIcon />
					</EmptyMedia>
					<EmptyTitle>财务权限校验失败</EmptyTitle>
					<EmptyDescription>{organizationQuery.error.message}</EmptyDescription>
				</EmptyHeader>
				<Button onClick={() => organizationQuery.refetch()}>重试</Button>
			</Empty>
		);
	}

	if (!financeRoles.has(organizationQuery.data.role)) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<LockKeyholeIcon />
					</EmptyMedia>
					<EmptyTitle>无权访问应收账单</EmptyTitle>
					<EmptyDescription>
						请联系机构负责人为你开通财务管理权限。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return <FinanceWorkspace sessionUserId={sessionUserId} />;
}

function FinanceRouteSkeleton() {
	return (
		<div
			className="flex flex-col gap-5"
			role="status"
			aria-label="正在校验财务访问权限"
		>
			<div className="space-y-2">
				<Skeleton className="h-4 w-20" />
				<Skeleton className="h-8 w-32" />
			</div>
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-72 w-full" />
		</div>
	);
}
