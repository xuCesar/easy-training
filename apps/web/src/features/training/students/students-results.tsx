import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import { Checkbox } from "@easy-training/ui/components/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@easy-training/ui/components/table";
import { HistoryIcon, PencilIcon, UsersRoundIcon } from "lucide-react";
import { StudentStatusBadge } from "./students-status-badge";
import type { StudentSummary } from "./students-types";
import { formatDate } from "./students-utils";

export function StudentResults({
	items,
	isFiltered,
	isPending,
	isError,
	onRetry,
	onEdit,
	onTimeline,
	selectedIds,
	onToggleSelected,
}: {
	items: StudentSummary[];
	isFiltered: boolean;
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selectedIds: ReadonlySet<string>;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	if (isPending)
		return (
			<div className="space-y-2 border p-3">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	if (isError)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>学员加载失败</EmptyTitle>
					<EmptyDescription>暂时无法加载学员档案，请重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onRetry}>重试</Button>
			</Empty>
		);
	if (!items.length)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>
						{isFiltered ? "没有匹配的学员" : "还没有学员档案"}
					</EmptyTitle>
					<EmptyDescription>
						{isFiltered
							? "试试调整搜索词或筛选条件。"
							: "新增学员，开始维护其联系人和状态。"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<section className="border">
			<div className="hidden md:block">
				<Table>
					<TableCaption className="sr-only">学员列表</TableCaption>
					<TableHeader>
						<TableRow>
							{onToggleSelected ? (
								<TableHead className="w-12">
									<span className="sr-only">选择</span>
								</TableHead>
							) : null}
							<TableHead>学员</TableHead>
							<TableHead>校区</TableHead>
							<TableHead>主要联系人</TableHead>
							<TableHead>负责人</TableHead>
							<TableHead>状态与标签</TableHead>
							<TableHead className="text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((student) => (
							<StudentTableRow
								key={student.id}
								student={student}
								onEdit={onEdit}
								onTimeline={onTimeline}
								selected={selectedIds.has(student.id)}
								onToggleSelected={onToggleSelected}
							/>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y md:hidden">
				{items.map((student) => (
					<StudentCompactRow
						key={student.id}
						student={student}
						onEdit={onEdit}
						onTimeline={onTimeline}
						selected={selectedIds.has(student.id)}
						onToggleSelected={onToggleSelected}
					/>
				))}
			</div>
		</section>
	);
}

function StudentTableRow({
	student,
	onEdit,
	onTimeline,
	selected,
	onToggleSelected,
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selected: boolean;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	return (
		<TableRow>
			{onToggleSelected ? (
				<TableCell>
					<Checkbox
						aria-label={`选择 ${student.name}`}
						checked={selected}
						onCheckedChange={(checked) =>
							onToggleSelected(student, checked === true)
						}
					/>
				</TableCell>
			) : null}
			<TableCell>
				<p className="font-medium">{student.name}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					创建于 {formatDate(student.createdAt)}
				</p>
			</TableCell>
			<TableCell>{student.campusName}</TableCell>
			<TableCell>
				<p>{student.primaryContactName}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					{student.primaryContactPhoneMasked}
				</p>
			</TableCell>
			<TableCell>{student.ownerName ?? "未分配"}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1">
					<StudentStatusBadge status={student.status} />
					{student.tags.map((tag) => (
						<Badge key={tag.id} variant="outline">
							{tag.name}
							{!tag.isActive ? "（已停用）" : ""}
						</Badge>
					))}
				</div>
			</TableCell>
			<TableCell className="text-right">
				<Button size="sm" variant="ghost" onClick={() => onTimeline(student)}>
					<HistoryIcon data-icon="inline-start" />
					时间线
				</Button>
				<Button size="sm" variant="ghost" onClick={() => onEdit(student)}>
					<PencilIcon data-icon="inline-start" />
					编辑
				</Button>
			</TableCell>
		</TableRow>
	);
}

function StudentCompactRow({
	student,
	onEdit,
	onTimeline,
	selected,
	onToggleSelected,
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selected: boolean;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	return (
		<article className="flex flex-col gap-3 p-3">
			{onToggleSelected ? (
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor={`student-select-mobile-${student.id}`}
				>
					<Checkbox
						id={`student-select-mobile-${student.id}`}
						checked={selected}
						onCheckedChange={(checked) =>
							onToggleSelected(student, checked === true)
						}
					/>
					选择 {student.name}
				</label>
			) : null}
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium">{student.name}</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{student.campusName} · {student.primaryContactName} ·{" "}
						{student.primaryContactPhoneMasked}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						负责人：{student.ownerName ?? "未分配"}
					</p>
				</div>
				<StudentStatusBadge status={student.status} />
			</div>
			{student.tags.length ? (
				<div className="flex flex-wrap gap-1">
					{student.tags.map((tag) => (
						<Badge key={tag.id} variant="outline">
							{tag.name}
						</Badge>
					))}
				</div>
			) : null}
			<Button
				className="self-start"
				size="sm"
				variant="outline"
				onClick={() => onTimeline(student)}
			>
				<HistoryIcon data-icon="inline-start" />
				业务时间线
			</Button>
			<Button
				className="self-start"
				size="sm"
				variant="outline"
				onClick={() => onEdit(student)}
			>
				<PencilIcon data-icon="inline-start" />
				编辑档案
			</Button>
		</article>
	);
}
