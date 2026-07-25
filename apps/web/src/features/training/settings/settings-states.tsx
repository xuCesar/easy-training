import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react";

export function PermissionDenied() {
	return (
		<Empty className="min-h-72 border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<ShieldCheckIcon />
				</EmptyMedia>
				<EmptyTitle>无权访问机构设置</EmptyTitle>
				<EmptyDescription>
					仅机构负责人和管理员可以管理校区、成员与邀请。
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export function FailureState({
	title,
	message,
	onRetry,
}: {
	title: string;
	message?: string;
	onRetry: () => void;
}) {
	return (
		<Empty className="min-h-48 border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{message ?? "请稍后重试。"}</EmptyDescription>
			</EmptyHeader>
			<Button onClick={onRetry}>重试</Button>
		</Empty>
	);
}

export function SectionSkeleton() {
	return (
		<div className="grid gap-3 md:grid-cols-2">
			<Skeleton className="h-32" />
			<Skeleton className="h-32" />
		</div>
	);
}
