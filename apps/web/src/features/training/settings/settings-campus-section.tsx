import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Building2Icon, PencilIcon, PowerIcon } from "lucide-react";
import { FailureState, SectionSkeleton } from "./settings-states";
import type { Campus } from "./settings-types";

export function CampusSection({
	data,
	isPending,
	isError,
	errorMessage,
	onRetry,
	onCreate,
	onEdit,
	onToggle,
}: {
	data?: Campus[];
	isPending: boolean;
	isError: boolean;
	errorMessage?: string;
	onRetry: () => void;
	onCreate: () => void;
	onEdit: (campus: Campus) => void;
	onToggle: (campus: Campus) => void;
}) {
	return (
		<section className="space-y-3" aria-labelledby="campus-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="campus-heading" className="font-semibold text-lg">
						校区
					</h2>
					<p className="text-muted-foreground text-sm">
						停用后保留历史记录，但不能用于新的业务写入。
					</p>
				</div>
				<Button onClick={onCreate}>
					<Building2Icon data-icon="inline-start" />
					新建校区
				</Button>
			</div>
			{isPending ? <SectionSkeleton /> : null}
			{isError ? (
				<FailureState
					title="校区加载失败"
					message={errorMessage}
					onRetry={onRetry}
				/>
			) : null}
			{!isPending && !isError && data?.length === 0 ? (
				<Empty className="min-h-48 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Building2Icon />
						</EmptyMedia>
						<EmptyTitle>暂无校区</EmptyTitle>
						<EmptyDescription>
							创建第一个校区后，即可为成员配置访问范围。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{data && data.length > 0 ? (
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{data.map((campus) => (
						<article key={campus.id} className="min-w-0 border p-4">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<h3 className="truncate font-medium">{campus.name}</h3>
									<p className="mt-1 truncate text-muted-foreground text-xs">
										{campus.code} · {campus.city}
									</p>
								</div>
								<Badge variant={campus.isActive ? "default" : "secondary"}>
									{campus.isActive ? "启用中" : "已停用"}
								</Badge>
							</div>
							<p className="mt-3 line-clamp-2 text-muted-foreground text-sm">
								{campus.address}
							</p>
							<p className="mt-2 text-muted-foreground text-xs">
								{campus.roomCount} 间教室 · 容量 {campus.capacity} 人
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onEdit(campus)}
								>
									<PencilIcon data-icon="inline-start" />
									编辑
								</Button>
								<Button
									size="sm"
									variant={campus.isActive ? "outline" : "default"}
									onClick={() => onToggle(campus)}
								>
									<PowerIcon data-icon="inline-start" />
									{campus.isActive ? "停用" : "启用"}
								</Button>
							</div>
						</article>
					))}
				</div>
			) : null}
		</section>
	);
}
