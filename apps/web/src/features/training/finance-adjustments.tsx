import {
	createInvoiceFollowUpInputSchema,
	type EnrollmentAdjustmentListResult,
	renewEnrollmentInputSchema,
	transferEnrollmentInputSchema,
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
import { Field, FieldLabel } from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowLeftRightIcon,
	ClockAlertIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	WalletCardsIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

import { formatCentsToCurrency, formatDate, formatDateTime } from "./format";

type Adjustment = EnrollmentAdjustmentListResult["items"][number];
type Action =
	| { kind: "renew"; enrollment: Adjustment }
	| { kind: "transfer"; enrollment: Adjustment }
	| { kind: "followUp"; invoiceId: string; studentName: string }
	| null;

export function FinanceAdjustments({
	organizationId,
}: {
	organizationId: string;
}) {
	const [action, setAction] = useState<Action>(null);
	const adjustmentsOptions =
		orpc.training.finance.adjustments.list.queryOptions();
	const arrearsOptions = orpc.training.finance.arrears.list.queryOptions();
	const adjustmentsQuery = useQuery({
		...adjustmentsOptions,
		queryKey: [...adjustmentsOptions.queryKey, { organizationId }],
	});
	const arrearsQuery = useQuery({
		...arrearsOptions,
		queryKey: [...arrearsOptions.queryKey, { organizationId }],
	});

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
					<header className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
						<div className="min-w-0">
							<h2 id="arrears-title" className="font-semibold text-sm">
								欠费跟进
							</h2>
							<p className="mt-1 text-muted-foreground text-xs">按到期日排序</p>
						</div>
						<ClockAlertIcon className="size-4 text-muted-foreground" />
					</header>
					{arrearsQuery.isPending ? (
						<PanelLoading />
					) : arrearsQuery.isError ? (
						<PanelError
							message={arrearsQuery.error.message}
							onRetry={() => arrearsQuery.refetch()}
						/>
					) : (
						<div className="divide-y">
							{arrearsQuery.data.items.slice(0, 4).map((item) => (
								<div key={item.invoiceId} className="min-w-0 p-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{item.studentName}
											</p>
											<p className="mt-1 truncate text-muted-foreground text-xs">
												{item.courseName ?? "课程待确认"} · 到期{" "}
												{formatDate(item.dueDate)}
											</p>
										</div>
										<span className="shrink-0 font-semibold text-sm tabular-nums">
											{formatCentsToCurrency(item.outstandingAmountInCents)}
										</span>
									</div>
									<div className="mt-2 flex items-center justify-between gap-2">
										<span className="min-w-0 truncate text-muted-foreground text-xs">
											{item.lastFollowUpAt
												? `${formatDateTime(item.lastFollowUpAt)} · ${item.lastFollowUpNote}`
												: "尚未跟进"}
										</span>
										<Button
											variant="ghost"
											size="xs"
											onClick={() =>
												setAction({
													kind: "followUp",
													invoiceId: item.invoiceId,
													studentName: item.studentName,
												})
											}
										>
											记录
										</Button>
									</div>
								</div>
							))}
							{arrearsQuery.data.items.length === 0 ? (
								<EmptyRow text="暂无待跟进欠费" />
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
			{action?.kind === "followUp" ? (
				<FollowUpDialog
					invoiceId={action.invoiceId}
					studentName={action.studentName}
					onClose={() => setAction(null)}
				/>
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

function FollowUpDialog({
	invoiceId,
	studentName,
	onClose,
}: {
	invoiceId: string;
	studentName: string;
	onClose: () => void;
}) {
	const [note, setNote] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	const mutation = useMutation(
		orpc.training.finance.arrears.followUp.mutationOptions({
			onSuccess: async () => {
				toast.success("欠费跟进已记录");
				await invalidateFinanceChangeQueries();
				onClose();
			},
			onError: (error) => toast.error(`记录失败：${error.message}`),
		}),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = createInvoiceFollowUpInputSchema.safeParse({
			invoiceId,
			note,
			followedUpAt: new Date().toISOString(),
			requestId,
		});
		if (!input.success) return toast.error("请填写跟进记录");
		mutation.mutate(input.data);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !mutation.isPending && onClose()}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>记录欠费跟进</DialogTitle>
					<DialogDescription>{studentName}</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<Field>
						<FieldLabel htmlFor="arrears-note">本次记录</FieldLabel>
						<Textarea
							id="arrears-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={500}
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
							{mutation.isPending ? "提交中" : "保存记录"}
						</Button>
					</DialogFooter>
				</form>
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
