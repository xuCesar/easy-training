import type {
	LeadListResult,
	LeadRecord,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@easy-training/ui/components/table";
import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
	ArrowRightIcon,
	ClipboardPlusIcon,
	PencilIcon,
	UsersRoundIcon,
} from "lucide-react";
import { LeadsSkeleton } from "./leads-skeleton";
import { LeadStageBadge } from "./leads-stage-badge";
import { formatFollowAt } from "./leads-utils";

export function LeadResults({
	items,
	isFiltered,
	query,
	onEdit,
	onFollowUp,
	onConvert,
}: {
	items: LeadRecord[];
	isFiltered: boolean;
	query: UseInfiniteQueryResult<InfiniteData<LeadListResult>, Error>;
	onEdit: (lead: LeadRecord) => void;
	onFollowUp: (lead: LeadRecord) => void;
	onConvert: (lead: LeadRecord) => void;
}) {
	if (query.isPending) return <LeadsSkeleton />;
	if (query.isError)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>线索加载失败</EmptyTitle>
					<EmptyDescription>暂时无法加载线索，请重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={() => query.refetch()}>重试</Button>
			</Empty>
		);
	if (items.length === 0)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>
						{isFiltered ? "没有匹配的线索" : "还没有招生线索"}
					</EmptyTitle>
					<EmptyDescription>
						{isFiltered
							? "试试调整搜索词或筛选条件。"
							: "新增第一条线索，开始跟进招生咨询。"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<section className="border">
			<div className="hidden md:block">
				<Table>
					<TableCaption className="sr-only">招生线索列表</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>线索</TableHead>
							<TableHead>负责人</TableHead>
							<TableHead>阶段</TableHead>
							<TableHead>下次跟进</TableHead>
							<TableHead className="text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((lead) => (
							<LeadTableRow
								key={lead.id}
								lead={lead}
								onEdit={onEdit}
								onFollowUp={onFollowUp}
								onConvert={onConvert}
							/>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y md:hidden">
				{items.map((lead) => (
					<LeadCompactRow
						key={lead.id}
						lead={lead}
						onEdit={onEdit}
						onFollowUp={onFollowUp}
						onConvert={onConvert}
					/>
				))}
			</div>
		</section>
	);
}

type LeadRowProps = {
	lead: LeadRecord;
	onEdit: (lead: LeadRecord) => void;
	onFollowUp: (lead: LeadRecord) => void;
	onConvert: (lead: LeadRecord) => void;
};

function LeadTableRow({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<TableRow>
			<TableCell>
				<p className="font-medium">{lead.name}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					{lead.phone} · {lead.source}
				</p>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{lead.owner || "未分配"}
			</TableCell>
			<TableCell>
				<LeadStageBadge stage={lead.stage} />
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatFollowAt(lead.nextFollowAt)}
			</TableCell>
			<TableCell className="text-right">
				<LeadActions
					lead={lead}
					onEdit={onEdit}
					onFollowUp={onFollowUp}
					onConvert={onConvert}
				/>
			</TableCell>
		</TableRow>
	);
}

function LeadCompactRow({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<article className="flex flex-col gap-3 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium text-sm">{lead.name}</p>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{lead.phone} · {lead.source}
					</p>
				</div>
				<LeadStageBadge stage={lead.stage} />
			</div>
			<div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
				<span>{lead.owner || "未分配"}</span>
				<span>{formatFollowAt(lead.nextFollowAt)}</span>
			</div>
			<LeadActions
				lead={lead}
				onEdit={onEdit}
				onFollowUp={onFollowUp}
				onConvert={onConvert}
			/>
		</article>
	);
}

function LeadActions({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<div className="flex flex-wrap justify-end gap-1">
			<Button variant="outline" size="sm" onClick={() => onFollowUp(lead)}>
				<ClipboardPlusIcon data-icon="inline-start" />
				跟进
			</Button>
			<Button variant="ghost" size="sm" onClick={() => onEdit(lead)}>
				<PencilIcon data-icon="inline-start" />
				编辑
			</Button>
			{lead.stage !== "lost" ? (
				<Button variant="ghost" size="sm" onClick={() => onConvert(lead)}>
					<ArrowRightIcon data-icon="inline-start" />
					转报名
				</Button>
			) : null}
		</div>
	);
}
