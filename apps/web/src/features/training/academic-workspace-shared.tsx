import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { CircleAlertIcon, PlusIcon, SchoolIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FilterSelect } from "./ui/filter-select";

export function FilterBar({
	campuses,
	campusId,
	onCampusChange,
	children,
}: {
	campuses: Array<{ id: string; name: string }>;
	campusId: string | undefined;
	onCampusChange: (value: string | undefined) => void;
	children?: ReactNode;
}) {
	return (
		<section className="flex flex-wrap gap-3 border p-3">
			<FilterSelect
				label="校区"
				showLabel
				containerClassName="w-full sm:w-[200px]"
				className="h-10 w-full"
				value={campusId ?? "all"}
				onValueChange={(value) =>
					onCampusChange(value === "all" ? undefined : value)
				}
				items={[
					{ value: "all", label: "全部校区" },
					...campuses.map((item) => ({ value: item.id, label: item.name })),
				]}
			/>
			{children}
		</section>
	);
}

export function PanelState({
	pending,
	error,
	empty,
	emptyTitle,
	emptyDescription,
	onRetry,
	onCreate,
	children,
}: {
	pending: boolean;
	error: boolean;
	empty: boolean;
	emptyTitle: string;
	emptyDescription: string;
	onRetry: () => void;
	onCreate?: () => void;
	children: ReactNode;
}) {
	if (pending)
		return (
			<div className="grid gap-2">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton className="h-20" key={index} />
				))}
			</div>
		);
	if (error)
		return (
			<Empty className="min-h-64 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CircleAlertIcon />
					</EmptyMedia>
					<EmptyTitle>数据加载失败</EmptyTitle>
					<EmptyDescription>请检查网络后重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onRetry}>重试</Button>
			</Empty>
		);
	if (empty)
		return (
			<Empty className="min-h-64 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SchoolIcon />
					</EmptyMedia>
					<EmptyTitle>{emptyTitle}</EmptyTitle>
					<EmptyDescription>{emptyDescription}</EmptyDescription>
				</EmptyHeader>
				{onCreate ? (
					<Button onClick={onCreate}>
						<PlusIcon data-icon="inline-start" />
						新建
					</Button>
				) : null}
			</Empty>
		);
	return <>{children}</>;
}

export function DataCell({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground text-xs md:hidden">{label}</p>
			<p className="truncate text-sm">{value}</p>
		</div>
	);
}

const statusLabels: Record<string, string> = {
	recruiting: "招生中",
	running: "进行中",
	paused: "已暂停",
	completed: "已结课",
	scheduled: "已排课",
	cancelled: "已取消",
	active: "已启用",
	inactive: "已停用",
};

export function StatusBadge({ status }: { status: string }) {
	const label = statusLabels[status] ?? status;
	const variant =
		status === "cancelled" || status === "inactive" || status === "completed"
			? "outline"
			: status === "paused"
				? "secondary"
				: "default";
	return <Badge variant={variant}>{label}</Badge>;
}
