import {
	type ArrearsListResult,
	addArrearsNoteInputSchema,
	type EnrollmentAdjustmentListResult,
	renewEnrollmentInputSchema,
	transferEnrollmentInputSchema,
	transitionArrearsInputSchema,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowLeftRightIcon,
	ClockAlertIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	WalletCardsIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { client, orpc, queryClient } from "@/utils/orpc";

import { formatCentsToCurrency, formatDate, formatDateTime } from "./format";

type Adjustment = EnrollmentAdjustmentListResult["items"][number];
type ArrearsItem = ArrearsListResult["items"][number];
type ArrearsFilterStatus = "pending" | "following_up" | "promised" | "paused";
type Action =
	| { kind: "renew"; enrollment: Adjustment }
	| { kind: "transfer"; enrollment: Adjustment }
	| { kind: "arrears"; item: ArrearsItem }
	| null;

export function FinanceAdjustments({
	organizationId,
}: {
	organizationId: string;
}) {
	const [action, setAction] = useState<Action>(null);
	const [arrearsStatusFilter, setArrearsStatusFilter] =
		useState<ArrearsFilterStatus | null>(null);
	const [pausedWithoutResumeOnly, setPausedWithoutResumeOnly] = useState(false);
	const adjustmentsOptions =
		orpc.training.finance.adjustments.list.queryOptions();
	const arrearsInput = {
		...(arrearsStatusFilter ? { status: arrearsStatusFilter } : {}),
		...(pausedWithoutResumeOnly ? { pausedWithoutResumeOnly: true } : {}),
	};
	const adjustmentsQuery = useQuery({
		...adjustmentsOptions,
		queryKey: [...adjustmentsOptions.queryKey, { organizationId }],
	});
	const arrearsQuery = useInfiniteQuery({
		queryKey: [
			...orpc.training.finance.arrears.list.key(),
			{ organizationId, arrearsInput },
		],
		queryFn: ({ pageParam }) =>
			client.training.finance.arrears.list({
				...arrearsInput,
				cursor: pageParam ?? undefined,
				pageSize: 20,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const arrearsItems =
		arrearsQuery.data?.pages.flatMap((page) => page.items) ?? [];

	return (
		<>
			<section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
				<article
					className="min-w-0 border"
					aria-labelledby="enrollment-adjustments-title"
				>
					<header className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
						<div className="min-w-0">
							<h2
								id="enrollment-adjustments-title"
								className="font-semibold text-sm"
							>
								报名变更
							</h2>
							<p className="mt-1 text-muted-foreground text-xs">续费与转课</p>
						</div>
						<WalletCardsIcon className="size-4 text-muted-foreground" />
					</header>
					{adjustmentsQuery.isPending ? (
						<PanelLoading />
					) : adjustmentsQuery.isError ? (
						<PanelError
							message={adjustmentsQuery.error.message}
							onRetry={() => adjustmentsQuery.refetch()}
						/>
					) : (
						<div className="divide-y">
							{adjustmentsQuery.data.items
								.filter((item) => item.status === "active")
								.slice(0, 5)
								.map((item) => (
									<div
										key={item.id}
										className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
									>
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{item.studentName} · {item.courseName}
											</p>
											<p className="mt-1 text-muted-foreground text-xs">
												{item.campusName} · 剩余 {item.remainingLessons} 课时
											</p>
										</div>
										<div className="flex shrink-0 gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													setAction({ kind: "renew", enrollment: item })
												}
											>
												<RefreshCwIcon data-icon="inline-start" />
												续费
											</Button>
											<Button
												variant="outline"
												size="sm"
												disabled={item.remainingLessons === 0}
												onClick={() =>
													setAction({ kind: "transfer", enrollment: item })
												}
											>
												<ArrowLeftRightIcon data-icon="inline-start" />
												转课
											</Button>
										</div>
									</div>
								))}
							{adjustmentsQuery.data.items.filter(
								(item) => item.status === "active",
							).length === 0 ? (
								<EmptyRow text="当前校区暂无可变更报名" />
							) : null}
						</div>
					)}
				</article>
				<article className="min-w-0 border" aria-labelledby="arrears-title">
					<header className="border-b px-4 py-3">
						<div className="flex min-w-0 items-center justify-between gap-3">
							<div className="min-w-0">
								<h2 id="arrears-title" className="font-semibold text-sm">
									欠费跟进
								</h2>
								<p className="mt-1 text-muted-foreground text-xs">
									按到期日排序
								</p>
							</div>
							<ClockAlertIcon className="size-4 text-muted-foreground" />
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							<Select
								value={arrearsStatusFilter ?? "all"}
								onValueChange={(value) =>
									setArrearsStatusFilter(
										value === "all" ? null : (value as ArrearsFilterStatus),
									)
								}
							>
								<SelectTrigger
									aria-label="筛选欠费状态"
									className="h-8 w-28 text-xs"
								>
									<SelectValue>全部状态</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">全部状态</SelectItem>
									<SelectItem value="pending">待跟进</SelectItem>
									<SelectItem value="following_up">跟进中</SelectItem>
									<SelectItem value="promised">承诺付款</SelectItem>
									<SelectItem value="paused">暂停追缴</SelectItem>
								</SelectContent>
							</Select>
							<Button
								type="button"
								variant={pausedWithoutResumeOnly ? "secondary" : "outline"}
								className="h-10"
								aria-pressed={pausedWithoutResumeOnly}
								onClick={() =>
									setPausedWithoutResumeOnly((current) => !current)
								}
							>
								长期暂停
							</Button>
						</div>
					</header>
					{arrearsQuery.isPending ? (
						<PanelLoading />
					) : arrearsQuery.isError ? (
						<PanelError
							message={arrearsQuery.error.message}
							onRetry={() => void arrearsQuery.refetch()}
						/>
					) : (
						<div className="divide-y">
							{arrearsItems.map((item) => (
								<div key={item.invoiceId} className="min-w-0 p-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{item.studentName}
											</p>
											<p className="mt-1 truncate text-muted-foreground text-xs">
												{item.source === "manual"
													? item.summary
													: (item.courseName ?? item.summary)}{" "}
												· 到期 {formatDate(item.dueDate)}
											</p>
										</div>
										<span className="shrink-0 font-semibold text-sm tabular-nums">
											{formatCentsToCurrency(item.outstandingAmountInCents)}
										</span>
									</div>
									<div className="mt-2 flex items-center justify-between gap-2">
										<div className="min-w-0 text-muted-foreground text-xs">
											<p className="truncate">
												{getArrearsStatusLabel(item.cycle.status)} ·{" "}
												{item.latestEvent
													? `${formatDateTime(item.latestEvent.createdAt)}${item.latestEvent.operatorName ? ` · ${item.latestEvent.operatorName}` : ""}`
													: "尚未操作"}
											</p>
											{item.cycle.promisedPaymentDate ? (
												<p className="mt-1">
													承诺付款：{formatDate(item.cycle.promisedPaymentDate)}
												</p>
											) : null}
											{item.cycle.status === "paused" ? (
												<p className="mt-1">
													恢复跟进：
													{item.cycle.resumeDate
														? formatDate(item.cycle.resumeDate)
														: "未设置"}
												</p>
											) : null}
										</div>
										<Button
											variant="ghost"
											size="xs"
											onClick={() =>
												setAction({
													kind: "arrears",
													item,
												})
											}
										>
											处理
										</Button>
									</div>
								</div>
							))}
							{arrearsItems.length === 0 ? (
								<EmptyRow text="暂无待跟进欠费" />
							) : null}
							{arrearsQuery.hasNextPage ? (
								<div className="flex justify-center p-3">
									<Button
										variant="outline"
										disabled={arrearsQuery.isFetchingNextPage}
										onClick={() => void arrearsQuery.fetchNextPage()}
									>
										{arrearsQuery.isFetchingNextPage ? (
											<LoaderCircleIcon
												className="animate-spin"
												data-icon="inline-start"
											/>
										) : null}
										{arrearsQuery.isFetchingNextPage
											? "正在加载更多"
											: "加载更多"}
									</Button>
								</div>
							) : null}
						</div>
					)}
				</article>
			</section>
			{action?.kind === "renew" ? (
				<RenewalDialog
					enrollment={action.enrollment}
					onClose={() => setAction(null)}
				/>
			) : null}
			{action?.kind === "transfer" && adjustmentsQuery.data ? (
				<TransferDialog
					enrollment={action.enrollment}
					courses={adjustmentsQuery.data.courses}
					onClose={() => setAction(null)}
				/>
			) : null}
			{action?.kind === "arrears" ? (
				<ArrearsDialog item={action.item} onClose={() => setAction(null)} />
			) : null}
		</>
	);
}

function RenewalDialog({
	enrollment,
	onClose,
}: {
	enrollment: Adjustment;
	onClose: () => void;
}) {
	const [lessons, setLessons] = useState("");
	const [amount, setAmount] = useState("");
	const [dueDate, setDueDate] = useState(getShanghaiToday());
	const [requestId] = useState(() => crypto.randomUUID());
	const mutation = useMutation(
		orpc.training.finance.adjustments.renew.mutationOptions({
			onSuccess: async () => {
				toast.success("续费账单已创建");
				await invalidateFinanceChangeQueries();
				onClose();
			},
			onError: (error) => toast.error(`续费失败：${error.message}`),
		}),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = renewEnrollmentInputSchema.safeParse({
			enrollmentId: enrollment.id,
			addedLessons: Number(lessons),
			amountInCents: parseYuanToCents(amount),
			dueDate,
			requestId,
		});
		if (!input.success) return toast.error("请检查续费信息");
		mutation.mutate(input.data);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !mutation.isPending && onClose()}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>续费</DialogTitle>
					<DialogDescription>
						{enrollment.studentName} · {enrollment.courseName}
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<Field>
						<FieldLabel htmlFor="renew-lessons">追加课时</FieldLabel>
						<Input
							id="renew-lessons"
							type="number"
							min="1"
							value={lessons}
							onChange={(event) => setLessons(event.target.value)}
							required
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="renew-amount">应收金额（元）</FieldLabel>
						<Input
							id="renew-amount"
							inputMode="decimal"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							required
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="renew-due-date">到期日</FieldLabel>
						<Input
							id="renew-due-date"
							type="date"
							value={dueDate}
							onChange={(event) => setDueDate(event.target.value)}
							required
						/>
					</Field>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "确认续费"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function TransferDialog({
	enrollment,
	courses,
	onClose,
}: {
	enrollment: Adjustment;
	courses: EnrollmentAdjustmentListResult["courses"];
	onClose: () => void;
}) {
	const [targetCourseId, setTargetCourseId] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	const mutation = useMutation(
		orpc.training.finance.adjustments.transfer.mutationOptions({
			onSuccess: async () => {
				toast.success("转课已完成");
				await invalidateFinanceChangeQueries();
				onClose();
			},
			onError: (error) => toast.error(`转课失败：${error.message}`),
		}),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = transferEnrollmentInputSchema.safeParse({
			sourceEnrollmentId: enrollment.id,
			targetCourseId,
			requestId,
		});
		if (!input.success) return toast.error("请选择目标课程");
		mutation.mutate(input.data);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !mutation.isPending && onClose()}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>转课</DialogTitle>
					<DialogDescription>
						{enrollment.studentName} 的 {enrollment.remainingLessons}{" "}
						节剩余课时将转入目标课程。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<Field>
						<FieldLabel htmlFor="transfer-course">目标课程</FieldLabel>
						<Select
							value={targetCourseId || null}
							onValueChange={(value) => setTargetCourseId(value ?? "")}
						>
							<SelectTrigger id="transfer-course" className="w-full">
								<SelectValue>
									{() =>
										courses.find((course) => course.id === targetCourseId)
											?.name ?? "请选择目标课程"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{courses
									.filter((course) => course.id !== enrollment.courseId)
									.map((course) => (
										<SelectItem key={course.id} value={course.id}>
											{course.name}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</Field>
					<p className="text-muted-foreground text-xs">
						来源报名存在未结清账单时，系统会拒绝本次转课。
					</p>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "确认转课"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ArrearsDialog({
	item,
	onClose,
}: {
	item: ArrearsItem;
	onClose: () => void;
}) {
	const [mode, setMode] = useState<"status" | "note">("status");
	const [targetStatus, setTargetStatus] = useState<
		"following_up" | "promised" | "paused"
	>("following_up");
	const [promisedPaymentDate, setPromisedPaymentDate] = useState("");
	const [resumeDate, setResumeDate] = useState("");
	const [reason, setReason] = useState("");
	const [note, setNote] = useState("");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [requestId] = useState(() => crypto.randomUUID());
	const detailOptions = orpc.training.finance.arrears.detail.queryOptions({
		input: { invoiceId: item.invoiceId },
	});
	const detailQuery = useQuery(detailOptions);
	const transitionMutation = useMutation(
		orpc.training.finance.arrears.transition.mutationOptions({
			onSuccess: async () => {
				toast.success("欠费状态已更新");
				await invalidateFinanceChangeQueries();
				onClose();
			},
			onError: (error) => toast.error(`更新失败：${error.message}`),
		}),
	);
	const noteMutation = useMutation(
		orpc.training.finance.arrears.addNote.mutationOptions({
			onSuccess: async () => {
				toast.success("欠费记录已保存");
				await invalidateFinanceChangeQueries();
				onClose();
			},
			onError: (error) => toast.error(`记录失败：${error.message}`),
		}),
	);
	const isPending = transitionMutation.isPending || noteMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFieldErrors({});
		if (mode === "note") {
			const result = addArrearsNoteInputSchema.safeParse({
				invoiceId: item.invoiceId,
				note,
				expectedVersion: item.cycle.version,
				requestId,
			});
			if (!result.success) {
				setFieldErrors(toFieldErrors(result.error));
				return;
			}
			noteMutation.mutate(result.data);
			return;
		}
		const result = transitionArrearsInputSchema.safeParse({
			invoiceId: item.invoiceId,
			toStatus: targetStatus,
			promisedPaymentDate: promisedPaymentDate || null,
			resumeDate: resumeDate || null,
			reason: reason || null,
			note: note || null,
			expectedVersion: item.cycle.version,
			requestId,
		});
		if (!result.success) {
			setFieldErrors(toFieldErrors(result.error));
			return;
		}
		transitionMutation.mutate(result.data);
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>处理欠费</DialogTitle>
					<DialogDescription>
						{item.studentName} ·{" "}
						{formatCentsToCurrency(item.outstandingAmountInCents)}· 当前为
						{getArrearsStatusLabel(item.cycle.status)}
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2">
					<Button
						type="button"
						size="sm"
						variant={mode === "status" ? "default" : "outline"}
						disabled={isPending}
						onClick={() => setMode("status")}
					>
						变更状态
					</Button>
					<Button
						type="button"
						size="sm"
						variant={mode === "note" ? "default" : "outline"}
						disabled={isPending}
						onClick={() => setMode("note")}
					>
						追加记录
					</Button>
				</div>
				<form className="grid gap-4" onSubmit={submit}>
					{mode === "status" ? (
						<>
							<Field invalid={Boolean(fieldErrors.toStatus)}>
								<FieldLabel htmlFor="arrears-status">目标状态</FieldLabel>
								<Select
									value={targetStatus}
									onValueChange={(value) =>
										setTargetStatus(
											value as "following_up" | "promised" | "paused",
										)
									}
								>
									<SelectTrigger id="arrears-status" className="w-full">
										<SelectValue>
											{getArrearsStatusLabel(targetStatus)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="following_up">跟进中</SelectItem>
										<SelectItem value="promised">承诺付款</SelectItem>
										<SelectItem value="paused">暂停追缴</SelectItem>
									</SelectContent>
								</Select>
								<FieldError>{fieldErrors.toStatus}</FieldError>
							</Field>
							{targetStatus === "promised" ? (
								<Field invalid={Boolean(fieldErrors.promisedPaymentDate)}>
									<FieldLabel htmlFor="arrears-promised-date">
										承诺付款日期
									</FieldLabel>
									<Input
										id="arrears-promised-date"
										type="date"
										min={getShanghaiToday()}
										value={promisedPaymentDate}
										onChange={(event) =>
											setPromisedPaymentDate(event.target.value)
										}
										aria-invalid={Boolean(fieldErrors.promisedPaymentDate)}
									/>
									<FieldError>{fieldErrors.promisedPaymentDate}</FieldError>
								</Field>
							) : null}
							{targetStatus === "paused" ? (
								<>
									<Field invalid={Boolean(fieldErrors.reason)}>
										<FieldLabel htmlFor="arrears-pause-reason">
											暂停原因
										</FieldLabel>
										<Textarea
											id="arrears-pause-reason"
											value={reason}
											onChange={(event) => setReason(event.target.value)}
											maxLength={500}
											aria-invalid={Boolean(fieldErrors.reason)}
										/>
										<FieldError>{fieldErrors.reason}</FieldError>
									</Field>
									<Field invalid={Boolean(fieldErrors.resumeDate)}>
										<FieldLabel htmlFor="arrears-resume-date">
											恢复跟进日期（可选）
										</FieldLabel>
										<Input
											id="arrears-resume-date"
											type="date"
											min={getShanghaiToday()}
											value={resumeDate}
											onChange={(event) => setResumeDate(event.target.value)}
											aria-invalid={Boolean(fieldErrors.resumeDate)}
										/>
										<FieldError>{fieldErrors.resumeDate}</FieldError>
									</Field>
								</>
							) : null}
						</>
					) : null}
					<Field invalid={Boolean(fieldErrors.note)}>
						<FieldLabel htmlFor="arrears-note">
							{mode === "note" ? "本次记录" : "补充说明（可选）"}
						</FieldLabel>
						<Textarea
							id="arrears-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={500}
							aria-invalid={Boolean(fieldErrors.note)}
						/>
						<FieldError>{fieldErrors.note}</FieldError>
					</Field>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={isPending}
						>
							取消
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{isPending ? "提交中" : mode === "note" ? "保存记录" : "确认更新"}
						</Button>
					</DialogFooter>
				</form>
				<div className="border-t pt-4">
					<h3 className="font-medium text-sm">欠费历史</h3>
					{detailQuery.isPending ? (
						<p className="mt-2 text-muted-foreground text-xs">正在加载历史…</p>
					) : null}
					{detailQuery.isError ? (
						<p className="mt-2 text-destructive text-xs">
							历史加载失败，可关闭后重试。
						</p>
					) : null}
					<div className="mt-2 space-y-3">
						{detailQuery.data?.cycles.map((cycle) => (
							<div key={cycle.id} className="border-l pl-3 text-xs">
								<p className="font-medium">
									第 {cycle.cycleNumber} 轮 ·{" "}
									{getArrearsStatusLabel(cycle.status)}
								</p>
								{cycle.events.map((entry) => (
									<p key={entry.id} className="mt-1 text-muted-foreground">
										{formatDateTime(entry.createdAt)} ·{" "}
										{getArrearsEventLabel(entry.eventType)}
										{entry.note ? ` · ${entry.note}` : ""}
										{entry.reason ? ` · ${entry.reason}` : ""}
									</p>
								))}
							</div>
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function PanelLoading() {
	return <div className="p-5 text-muted-foreground text-sm">正在加载…</div>;
}
function PanelError({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="p-5 text-sm">
			<p className="text-destructive">{message}</p>
			<Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
				重试
			</Button>
		</div>
	);
}
function EmptyRow({ text }: { text: string }) {
	return (
		<p className="p-5 text-center text-muted-foreground text-sm">{text}</p>
	);
}
function getArrearsStatusLabel(
	status: "pending" | "following_up" | "promised" | "paused" | "resolved",
) {
	switch (status) {
		case "pending":
			return "待跟进";
		case "following_up":
			return "跟进中";
		case "promised":
			return "承诺付款";
		case "paused":
			return "暂停追缴";
		case "resolved":
			return "已解决";
	}
}
function getArrearsEventLabel(
	eventType:
		| "cycle_started"
		| "status_changed"
		| "note_added"
		| "auto_resolved",
) {
	switch (eventType) {
		case "cycle_started":
			return "开启欠费周期";
		case "status_changed":
			return "变更状态";
		case "note_added":
			return "追加记录";
		case "auto_resolved":
			return "自动解决";
	}
}
function toFieldErrors(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
	return error.issues.reduce<Record<string, string>>((result, issue) => {
		const key = issue.path[0];
		if (typeof key === "string" && !result[key]) result[key] = issue.message;
		return result;
	}, {});
}
function parseYuanToCents(value: string): number | null {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!match) return null;
	const result =
		Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	return Number.isSafeInteger(result) && result >= 0 && result <= 100_000_000
		? result
		: null;
}
function getShanghaiToday() {
	return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function invalidateFinanceChangeQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.adjustments.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.arrears.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.invoices.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.invoices.detail.key(),
		}),
		queryClient.invalidateQueries({ queryKey: orpc.training.snapshot.key() }),
	]);
}
