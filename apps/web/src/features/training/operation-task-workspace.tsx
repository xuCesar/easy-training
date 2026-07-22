import type {
	OperationTask,
	OperationTaskListInput,
	OperationTaskListItem,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Input } from "@easy-training/ui/components/input";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
	CheckIcon,
	ClipboardCheckIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	RotateCcwIcon,
	UserCheckIcon,
	XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { client, orpc, queryClient } from "@/utils/orpc";
import { formatDateTime } from "./format";
import { useOrganization } from "./organization-context";

type TaskView = OperationTaskListInput["view"];
type TaskModule = OperationTask["module"];
type TaskPriority = OperationTask["priority"];

const moduleLabels: Record<TaskModule, string> = {
	enrollment: "招生",
	academic: "教务",
	finance: "财务",
	student_service: "学员服务",
};
const priorityLabels: Record<TaskPriority, string> = {
	high: "高",
	medium: "中",
	low: "低",
};
const statusLabels: Record<OperationTask["status"], string> = {
	pending: "待处理",
	completed: "已完成",
	cancelled: "已取消",
};
const managerRoles = new Set(["owner", "admin", "campus_manager"]);
const allTaskModules: readonly TaskModule[] = [
	"enrollment",
	"academic",
	"finance",
	"student_service",
];

function getAssignableModules(role: string): readonly TaskModule[] {
	if (managerRoles.has(role)) return allTaskModules;
	switch (role) {
		case "consultant":
			return ["enrollment", "student_service"];
		case "finance":
			return ["finance"];
		case "teacher":
			return ["academic"];
		default:
			return [];
	}
}

export function OperationTaskWorkspace({ userId }: { userId: string }) {
	const { organization } = useOrganization();
	const isManager = managerRoles.has(organization.role);
	const [view, setView] = useState<TaskView>("mine");
	const [status, setStatus] = useState<OperationTask["status"] | "all">(
		"pending",
	);
	const [module, setModule] = useState<TaskModule | "all">("all");
	const [campusId, setCampusId] = useState("");
	const [dueFrom, setDueFrom] = useState("");
	const [dueTo, setDueTo] = useState("");
	const [keyword, setKeyword] = useState("");
	const [dialogTask, setDialogTask] = useState<OperationTask | "create" | null>(
		null,
	);
	const listInput: OperationTaskListInput = {
		view,
		status: status === "all" ? undefined : status,
		module: module === "all" ? undefined : module,
		campusId: campusId || undefined,
		dueAtFrom: dueFrom ? toShanghaiDayBoundary(dueFrom, "start") : undefined,
		dueAtTo: dueTo ? toShanghaiDayBoundary(dueTo, "end") : undefined,
		keyword: keyword.trim() || undefined,
		limit: 30,
	};
	const campusesQuery = useQuery(
		orpc.training.campuses.list.queryOptions({
			input: { includeInactive: false },
		}),
	);
	const tasksQuery = useInfiniteQuery({
		queryKey: [
			...orpc.training.operations.tasks.list.key(),
			{ organizationId: organization.id, userId, ...listInput },
		],
		queryFn: ({ pageParam }) =>
			client.training.operations.tasks.list({
				...listInput,
				cursor: pageParam ?? undefined,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const tasks = tasksQuery.data?.pages.flatMap((page) => page.items) ?? [];

	async function refreshTasks() {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: orpc.training.operations.tasks.list.key(),
			}),
			queryClient.invalidateQueries({ queryKey: orpc.training.snapshot.key() }),
		]);
	}

	return (
		<div className="flex min-w-0 flex-col gap-5">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-muted-foreground text-sm">运营协作</p>
					<h1 className="mt-1 font-semibold text-2xl">任务与提醒</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						统一记录派单、截止时间和完成状态，系统自动发送站内提醒。
					</p>
				</div>
				<Button onClick={() => setDialogTask("create")}>
					<PlusIcon data-icon="inline-start" />
					新建任务
				</Button>
			</header>

			<section className="grid gap-3 border p-3">
				<fieldset className="flex flex-wrap gap-1" aria-label="任务视图">
					{(
						[
							["mine", "我的任务"],
							["created", "我创建的"],
							["public", "待认领"],
							...(isManager ? ([["managed", "管理范围"]] as const) : []),
						] as const
					).map(([value, label]) => (
						<Button
							key={value}
							variant={view === value ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setView(value)}
						>
							{label}
						</Button>
					))}
				</fieldset>
				<div className="grid gap-2 sm:grid-cols-3">
					<NativeSelect
						label="状态"
						value={status}
						onChange={(value) =>
							setStatus(value as OperationTask["status"] | "all")
						}
						options={[
							["all", "全部状态"],
							["pending", "待处理"],
							["completed", "已完成"],
							["cancelled", "已取消"],
						]}
					/>
					<NativeSelect
						label="模块"
						value={module}
						onChange={(value) => setModule(value as TaskModule | "all")}
						options={[["all", "全部模块"], ...Object.entries(moduleLabels)]}
					/>
					<NativeSelect
						label="校区"
						value={campusId}
						onChange={setCampusId}
						options={[
							["", "全部校区"],
							...(campusesQuery.data?.items.map((item) => [
								item.id,
								item.name,
							]) ?? []),
						]}
					/>
				</div>
				<div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_minmax(12rem,1fr)]">
					<label className="grid gap-1.5" htmlFor="task-due-from">
						<span className="font-medium text-sm">截止起始日</span>
						<Input
							id="task-due-from"
							type="date"
							value={dueFrom}
							onChange={(event) => setDueFrom(event.target.value)}
						/>
					</label>
					<label className="grid gap-1.5" htmlFor="task-due-to">
						<span className="font-medium text-sm">截止结束日</span>
						<Input
							id="task-due-to"
							type="date"
							min={dueFrom || undefined}
							value={dueTo}
							onChange={(event) => setDueTo(event.target.value)}
						/>
					</label>
					<label className="grid gap-1.5" htmlFor="task-keyword">
						<span className="font-medium text-sm">任务标题</span>
						<Input
							id="task-keyword"
							placeholder="搜索任务标题"
							value={keyword}
							onChange={(event) => setKeyword(event.target.value)}
						/>
					</label>
				</div>
			</section>

			{tasksQuery.isPending ? <TaskListSkeleton /> : null}
			{tasksQuery.isError ? (
				<section className="grid min-h-56 place-items-center border p-6 text-center">
					<div>
						<h2 className="font-medium">任务加载失败</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{tasksQuery.error.message}
						</p>
						<Button className="mt-4" onClick={() => void tasksQuery.refetch()}>
							重试
						</Button>
					</div>
				</section>
			) : null}
			{tasksQuery.data && tasks.length === 0 ? (
				<section className="grid min-h-56 place-items-center border p-6 text-center">
					<div>
						<ClipboardCheckIcon className="mx-auto size-7 text-muted-foreground" />
						<h2 className="mt-3 font-medium">当前视图没有任务</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							可以调整筛选条件，或创建一项新的运营任务。
						</p>
					</div>
				</section>
			) : null}
			{tasks.length ? (
				<section className="divide-y border">
					{tasks.map((task) => (
						<TaskRow
							key={task.id}
							task={task}
							userId={userId}
							isManager={isManager}
							onEdit={() => setDialogTask(task)}
							onChanged={refreshTasks}
						/>
					))}
				</section>
			) : null}
			{tasksQuery.hasNextPage ? (
				<Button
					variant="outline"
					disabled={tasksQuery.isFetchingNextPage}
					onClick={() => void tasksQuery.fetchNextPage()}
				>
					{tasksQuery.isFetchingNextPage ? (
						<LoaderCircleIcon className="animate-spin" />
					) : null}
					加载更多
				</Button>
			) : null}

			{dialogTask ? (
				<TaskDialog
					task={dialogTask === "create" ? null : dialogTask}
					userId={userId}
					isManager={isManager}
					onClose={() => setDialogTask(null)}
					onSaved={async () => {
						setDialogTask(null);
						await refreshTasks();
					}}
				/>
			) : null}
		</div>
	);
}

function TaskRow({
	task,
	userId,
	isManager,
	onEdit,
	onChanged,
}: {
	task: OperationTaskListItem;
	userId: string;
	isManager: boolean;
	onEdit: () => void;
	onChanged: () => Promise<void>;
}) {
	const canEdit =
		task.status === "pending" &&
		(isManager ||
			task.createdByUserId === userId ||
			task.ownerUserId === userId);
	const canComplete = canEdit;
	const canCancel =
		task.status === "pending" && (isManager || task.createdByUserId === userId);
	const canReopen =
		task.status === "completed" &&
		(isManager || task.createdByUserId === userId);
	const actionMutation = useMutation({
		mutationFn: async (action: "claim" | "complete" | "cancel" | "reopen") => {
			const input = { id: task.id, expectedVersion: task.version };
			switch (action) {
				case "claim":
					return client.training.operations.tasks.claim(input);
				case "complete":
					return client.training.operations.tasks.complete(input);
				case "cancel":
					return client.training.operations.tasks.cancel(input);
				case "reopen":
					return client.training.operations.tasks.reopen(input);
			}
		},
		onSuccess: async () => {
			toast.success("任务状态已更新");
			await onChanged();
		},
		onError: (error) => toast.error(`操作失败：${error.message}`),
	});
	const overdue =
		task.status === "pending" && new Date(task.dueAt) < new Date();

	return (
		<article className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<Badge
						variant={task.priority === "high" ? "destructive" : "secondary"}
					>
						{priorityLabels[task.priority]}优先级
					</Badge>
					<Badge variant="outline">{moduleLabels[task.module]}</Badge>
					<Badge variant={overdue ? "destructive" : "outline"}>
						{overdue ? "已逾期" : statusLabels[task.status]}
					</Badge>
				</div>
				<h2 className="mt-2 break-words font-medium">{task.title}</h2>
				{task.description ? (
					<p className="mt-1 line-clamp-2 break-words text-muted-foreground text-sm">
						{task.description}
					</p>
				) : null}
				<p className="mt-2 text-muted-foreground text-xs">
					截止 {formatDateTime(task.dueAt)} · 负责人{" "}
					{task.ownerUserId ? (task.ownerName ?? "成员已移除") : "待认领"} ·
					版本 {task.version}
				</p>
			</div>
			<div className="flex flex-wrap gap-2 md:justify-end">
				{task.status === "pending" && !task.ownerUserId ? (
					<Button
						size="sm"
						disabled={actionMutation.isPending}
						onClick={() => actionMutation.mutate("claim")}
					>
						<UserCheckIcon data-icon="inline-start" />
						认领
					</Button>
				) : null}
				{canEdit ? (
					<Button size="sm" variant="outline" onClick={onEdit}>
						<PencilIcon data-icon="inline-start" />
						编辑
					</Button>
				) : null}
				{canComplete ? (
					<Button
						size="sm"
						disabled={actionMutation.isPending}
						onClick={() => actionMutation.mutate("complete")}
					>
						<CheckIcon data-icon="inline-start" />
						完成
					</Button>
				) : null}
				{canReopen ? (
					<Button
						size="sm"
						variant="outline"
						disabled={actionMutation.isPending}
						onClick={() => actionMutation.mutate("reopen")}
					>
						<RotateCcwIcon data-icon="inline-start" />
						重开
					</Button>
				) : null}
				{canCancel ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={actionMutation.isPending}
						onClick={() => actionMutation.mutate("cancel")}
					>
						<XIcon data-icon="inline-start" />
						取消
					</Button>
				) : null}
			</div>
		</article>
	);
}

function TaskDialog({
	task,
	userId,
	isManager,
	onClose,
	onSaved,
}: {
	task: OperationTask | null;
	userId: string;
	isManager: boolean;
	onClose: () => void;
	onSaved: () => Promise<void>;
}) {
	const { organization } = useOrganization();
	const assignableModules = getAssignableModules(organization.role);
	const [title, setTitle] = useState(task?.title ?? "");
	const [description, setDescription] = useState(task?.description ?? "");
	const [module, setModule] = useState<TaskModule>(
		task?.module ?? assignableModules[0] ?? "enrollment",
	);
	const [priority, setPriority] = useState<TaskPriority>(
		task?.priority ?? "medium",
	);
	const [campusId, setCampusId] = useState(task?.campusId ?? "");
	const [ownerUserId, setOwnerUserId] = useState(task?.ownerUserId ?? userId);
	const [dueAt, setDueAt] = useState(() =>
		toDateTimeLocal(
			task?.dueAt ?? new Date(Date.now() + 86_400_000).toISOString(),
		),
	);
	const [reminder, setReminder] = useState(
		task?.remindBeforeMinutes ? String(task.remindBeforeMinutes) : "none",
	);
	const campusesQuery = useQuery(
		orpc.training.campuses.list.queryOptions({
			input: { includeInactive: false },
		}),
	);
	const assigneesQuery = useQuery(
		orpc.training.operations.tasks.assignees.queryOptions({
			input: { campusId: campusId || null, module },
		}),
	);
	useEffect(() => {
		const firstCampus = campusesQuery.data?.items[0];
		if (!firstCampus || campusId) return;
		const ownerCanTakeGlobalTask = assigneesQuery.data?.items.some(
			(item) => item.userId === ownerUserId,
		);
		if (
			organization.role === "campus_manager" ||
			(ownerUserId && ownerCanTakeGlobalTask === false)
		) {
			setCampusId(firstCampus.id);
		}
	}, [
		assigneesQuery.data,
		campusId,
		campusesQuery.data,
		organization.role,
		ownerUserId,
	]);
	useEffect(() => {
		if (!isManager || !ownerUserId || !assigneesQuery.data) return;
		if (
			!assigneesQuery.data.items.some((item) => item.userId === ownerUserId)
		) {
			setOwnerUserId("");
		}
	}, [assigneesQuery.data, isManager, ownerUserId]);
	const saveMutation = useMutation({
		mutationFn: async () => {
			const payload = {
				campusId: campusId || null,
				ownerUserId: ownerUserId || null,
				title: title.trim(),
				description: description.trim() || null,
				module,
				priority,
				dueAt: new Date(dueAt).toISOString(),
				remindBeforeMinutes: reminder === "none" ? null : Number(reminder),
			};
			if (task) {
				return client.training.operations.tasks.update({
					id: task.id,
					expectedVersion: task.version,
					data: payload,
				});
			}
			return client.training.operations.tasks.create(payload);
		},
		onSuccess: async () => {
			toast.success(task ? "任务已更新" : "任务已创建");
			await onSaved();
		},
		onError: (error) => toast.error(`保存失败：${error.message}`),
	});

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!title.trim() || !dueAt || saveMutation.isPending) return;
		saveMutation.mutate();
	}

	const campusOptions = [
		...(organization.role === "campus_manager"
			? []
			: ([["", "全机构"]] as const)),
		...(campusesQuery.data?.items.map((item) => [item.id, item.name]) ?? []),
	];
	const assigneeOptions = [
		...(isManager ? ([["", "公共任务（待认领）"]] as const) : []),
		...(assigneesQuery.data?.items.map((item) => [item.userId, item.name]) ??
			[]),
	];

	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !saveMutation.isPending && onClose()}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{task ? "编辑任务" : "新建任务"}</DialogTitle>
					<DialogDescription>
						改期或重新分配后，系统会撤销旧提醒并按新版本重新安排。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
					<label className="grid gap-1.5 sm:col-span-2" htmlFor="task-title">
						<span className="font-medium text-sm">任务标题</span>
						<Input
							id="task-title"
							required
							maxLength={200}
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<label
						className="grid gap-1.5 sm:col-span-2"
						htmlFor="task-description"
					>
						<span className="font-medium text-sm">任务说明</span>
						<Textarea
							id="task-description"
							maxLength={4000}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
					<NativeSelect
						label="关联模块"
						value={module}
						onChange={(value) => setModule(value as TaskModule)}
						options={assignableModules.map((value) => [
							value,
							moduleLabels[value],
						])}
					/>
					<NativeSelect
						label="优先级"
						value={priority}
						onChange={(value) => setPriority(value as TaskPriority)}
						options={Object.entries(priorityLabels)}
					/>
					<NativeSelect
						label="校区"
						value={campusId}
						onChange={setCampusId}
						options={campusOptions}
					/>
					<NativeSelect
						label="负责人"
						value={ownerUserId}
						onChange={setOwnerUserId}
						disabled={assigneesQuery.isPending}
						options={assigneeOptions}
					/>
					<label className="grid gap-1.5" htmlFor="task-due-at">
						<span className="font-medium text-sm">截止时间</span>
						<Input
							id="task-due-at"
							type="datetime-local"
							required
							value={dueAt}
							onChange={(event) => setDueAt(event.target.value)}
						/>
					</label>
					<NativeSelect
						label="提前提醒"
						value={reminder}
						onChange={setReminder}
						options={[
							["none", "不提前提醒"],
							["15", "提前 15 分钟"],
							["60", "提前 1 小时"],
							["1440", "提前 1 天"],
							["4320", "提前 3 天"],
						]}
					/>
					<DialogFooter className="sm:col-span-2">
						<Button
							type="button"
							variant="outline"
							disabled={saveMutation.isPending}
							onClick={onClose}
						>
							取消
						</Button>
						<Button
							type="submit"
							disabled={saveMutation.isPending || !title.trim()}
						>
							{saveMutation.isPending ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NativeSelect({
	label,
	value,
	onChange,
	options,
	disabled = false,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<readonly [string, string] | string[]>;
	disabled?: boolean;
}) {
	return (
		<label className="grid gap-1.5">
			<span className="font-medium text-sm">{label}</span>
			<select
				className="h-9 w-full border bg-background px-3 text-sm"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				disabled={disabled}
			>
				{options.map(([optionValue, optionLabel]) => (
					<option key={optionValue || "empty"} value={optionValue}>
						{optionLabel}
					</option>
				))}
			</select>
		</label>
	);
}

function TaskListSkeleton() {
	return (
		<div className="grid gap-px border bg-border" aria-live="polite">
			{[1, 2, 3].map((item) => (
				<div className="bg-background p-4" key={item}>
					<Skeleton className="h-5 w-2/3" />
					<Skeleton className="mt-3 h-4 w-1/3" />
				</div>
			))}
		</div>
	);
}

function toDateTimeLocal(value: string) {
	const date = new Date(value);
	const offsetMs = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toShanghaiDayBoundary(value: string, boundary: "start" | "end") {
	return `${value}T${boundary === "start" ? "00:00:00" : "23:59:59.999"}+08:00`;
}
