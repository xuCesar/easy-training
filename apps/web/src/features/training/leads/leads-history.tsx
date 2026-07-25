import type { LeadActivityRecord } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { LeadStageBadge } from "./leads-stage-badge";
import { formatDateTime, formatFollowAt } from "./leads-utils";

export function LeadHistory({
	history,
	isPending,
	isError,
	onRetry,
}: {
	history: LeadActivityRecord[];
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
}) {
	return (
		<section className="border-t pt-4">
			<h2 className="font-medium text-sm">跟进历史</h2>
			{isPending ? (
				<div className="mt-3 flex flex-col gap-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			) : null}
			{isError ? (
				<div className="mt-3 flex items-center gap-2 text-muted-foreground text-sm">
					<span>暂时无法加载历史。</span>
					<Button variant="outline" size="sm" onClick={onRetry}>
						重试
					</Button>
				</div>
			) : null}
			{!isPending && !isError ? (
				<ol className="mt-3 flex flex-col gap-3">
					{history.map((item) => (
						<LeadHistoryItem key={item.id} item={item} />
					))}
				</ol>
			) : null}
		</section>
	);
}

function LeadHistoryItem({ item }: { item: LeadActivityRecord }) {
	return (
		<li className="border-l-2 pl-3">
			<div className="flex flex-wrap items-center gap-2">
				<LeadStageBadge stage={item.stage} />
				<span className="text-muted-foreground text-xs">
					{item.operator} ·{" "}
					<time dateTime={item.createdAt}>
						{formatDateTime(item.createdAt)}
					</time>
				</span>
			</div>
			<p className="mt-1 text-sm">{item.content}</p>
			{item.nextFollowAt ? (
				<p className="mt-1 text-muted-foreground text-xs">
					下次跟进：{formatFollowAt(item.nextFollowAt)}
				</p>
			) : null}
			{item.lostReason ? (
				<p className="mt-1 text-destructive text-xs">
					失单原因：{item.lostReason}
				</p>
			) : null}
		</li>
	);
}
