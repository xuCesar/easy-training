import {
	type CreateRefundRequestInput,
	type CurrentOrganization,
	createRefundRequestInputSchema,
	type InvoiceDetail,
	type RefundRequest,
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
import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	BanIcon,
	CheckIcon,
	Clock3Icon,
	LoaderCircleIcon,
	RotateCcwIcon,
	XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import {
	getShanghaiCurrentDateTime,
	parseYuanToCents,
	shanghaiDateTimeToIso,
} from "./finance-form-utils";
import { invalidateFinanceQueries } from "./finance-query-utils";
import { formatCentsToCurrency, formatDateTime } from "./format";

type InvoiceSummary = InvoiceDetail["invoice"];
type OrganizationRole = CurrentOrganization["role"];
type RefundAction = "approved" | "rejected" | "cancelled";
type RefundFormField = "amountInCents" | "refundedAt" | "method" | "reason";
type RefundFormErrors = Partial<Record<RefundFormField, string>>;

const paymentMethods: Array<{
	value: CreateRefundRequestInput["method"];
	label: string;
}> = [
	{ value: "cash", label: "现金" },
	{ value: "wechat", label: "微信" },
	{ value: "alipay", label: "支付宝" },
	{ value: "bankTransfer", label: "银行转账" },
	{ value: "pos", label: "POS" },
	{ value: "other", label: "其他" },
];

export function RefundApprovalPanel({
	invoice,
	maxAmountInCents,
	organizationId,
	organizationRole,
	sessionUserId,
	onPendingChange,
}: {
	invoice: InvoiceSummary;
	maxAmountInCents: number;
	organizationId: string;
	organizationRole: OrganizationRole;
	sessionUserId: string;
	onPendingChange: (pending: boolean) => void;
}) {
	const [actionTarget, setActionTarget] = useState<{
		request: RefundRequest;
		action: RefundAction;
	} | null>(null);
	const options = orpc.training.finance.refundRequests.list.queryOptions({
		input: { invoiceId: invoice.id },
	});
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, { organizationId }],
	});

	if (query.isPending) {
		return <Skeleton className="h-40 w-full" />;
	}
	if (query.isError) {
		return (
			<section className="border p-4 text-sm" aria-label="退款审批加载失败">
				<p className="font-medium">退款审批记录加载失败</p>
				<p className="mt-1 text-muted-foreground text-xs">
					{query.error.message}
				</p>
				<Button
					className="mt-3"
					size="sm"
					variant="outline"
					onClick={() => query.refetch()}
				>
					重试
				</Button>
			</section>
		);
	}

	const requests = query.data.items;
	const pendingRequest = requests.find(
		(request) => request.status === "pending",
	);
	const canAdminister =
		organizationRole === "owner" || organizationRole === "admin";

	return (
		<div className="flex min-w-0 flex-col gap-4">
			{pendingRequest ? (
				<RefundRequestCard
					request={pendingRequest}
					canDecide={
						canAdminister && pendingRequest.applicantUserId !== sessionUserId
					}
					canCancel={
						pendingRequest.applicantUserId === sessionUserId || canAdminister
					}
					onAction={(action) =>
						setActionTarget({ request: pendingRequest, action })
					}
				/>
			) : invoice.status === "paid" && maxAmountInCents > 0 ? (
				<RefundRequestForm
					invoice={invoice}
					maxAmountInCents={maxAmountInCents}
					onPendingChange={onPendingChange}
				/>
			) : null}

			<section
				className="min-w-0"
				aria-labelledby="refund-request-history-title"
			>
				<div className="flex items-baseline justify-between gap-3">
					<h2
						id="refund-request-history-title"
						className="font-semibold text-sm"
					>
						退款申请记录
					</h2>
					<span className="text-muted-foreground text-xs">
						共 {requests.length} 条
					</span>
				</div>
				{requests.length > 0 ? (
					<ol className="mt-3 divide-y border">
						{requests.map((request) => (
							<RefundRequestHistoryItem key={request.id} request={request} />
						))}
					</ol>
				) : (
					<div className="mt-3 border p-6 text-center text-muted-foreground text-sm">
						暂无退款申请
					</div>
				)}
			</section>

			{actionTarget ? (
				<RefundRequestActionDialog
					request={actionTarget.request}
					action={actionTarget.action}
					reasonRequired={
						actionTarget.action === "rejected" ||
						(actionTarget.action === "cancelled" &&
							actionTarget.request.applicantUserId !== sessionUserId)
					}
					onClose={() => setActionTarget(null)}
					onPendingChange={onPendingChange}
				/>
			) : null}
		</div>
	);
}

function RefundRequestCard({
	request,
	canDecide,
	canCancel,
	onAction,
}: {
	request: RefundRequest;
	canDecide: boolean;
	canCancel: boolean;
	onAction: (action: RefundAction) => void;
}) {
	return (
		<section
			className="border border-amber-600/30 bg-amber-600/5 p-4"
			aria-label="待审批退款申请"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="font-semibold text-sm">待审批退款申请</h2>
						<Badge variant="secondary">待审批</Badge>
					</div>
					<p className="mt-2 text-sm">
						申请退款 {formatCentsToCurrency(request.amountInCents)}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{request.applicantName} · {formatDateTime(request.createdAt)}
					</p>
				</div>
				<Clock3Icon className="size-4 text-amber-700" />
			</div>
			<p className="mt-3 break-words border-t pt-3 text-muted-foreground text-xs">
				退款方式：{getPaymentMethodLabel(request.method)} · 退款时间：
				{formatDateTime(request.refundedAt)}
				<br />
				申请原因：{request.reason}
			</p>
			{canDecide || canCancel ? (
				<div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					{canCancel ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => onAction("cancelled")}
						>
							<BanIcon data-icon="inline-start" />
							取消申请
						</Button>
					) : null}
					{canDecide ? (
						<>
							<Button
								size="sm"
								variant="outline"
								onClick={() => onAction("rejected")}
							>
								<XIcon data-icon="inline-start" />
								拒绝
							</Button>
							<Button size="sm" onClick={() => onAction("approved")}>
								<CheckIcon data-icon="inline-start" />
								批准
							</Button>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
}

function RefundRequestHistoryItem({ request }: { request: RefundRequest }) {
	return (
		<li className="min-w-0 p-3 text-sm">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="font-medium">
						{formatCentsToCurrency(request.amountInCents)}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{request.applicantName} · {formatDateTime(request.createdAt)}
					</p>
				</div>
				<Badge
					variant={request.status === "rejected" ? "destructive" : "outline"}
				>
					{getRequestStatusLabel(request.status)}
				</Badge>
			</div>
			<p className="mt-2 break-words text-muted-foreground text-xs">
				退款方式：{getPaymentMethodLabel(request.method)} · 退款时间：
				{formatDateTime(request.refundedAt)}
				<br />
				申请原因：{request.reason}
			</p>
			{request.refundId ? (
				<a
					href={`#refund-${request.refundId}`}
					className="mt-2 inline-flex text-primary text-xs underline-offset-4 hover:underline"
				>
					查看对应退款流水
				</a>
			) : null}
			<ol className="mt-3 space-y-2 border-t pt-3">
				{request.events.map((event) => (
					<li key={event.id} className="text-xs">
						<span className="font-medium">
							{getEventActionLabel(event.action)}
						</span>
						<span className="text-muted-foreground">
							{" "}
							· {event.operatorName} · {formatDateTime(event.createdAt)}
						</span>
						{event.comment ? (
							<p className="mt-1 break-words text-muted-foreground">
								{event.comment}
							</p>
						) : null}
					</li>
				))}
			</ol>
		</li>
	);
}

function RefundRequestForm({
	invoice,
	maxAmountInCents,
	onPendingChange,
}: {
	invoice: InvoiceSummary;
	maxAmountInCents: number;
	onPendingChange: (pending: boolean) => void;
}) {
	const [amountInYuan, setAmountInYuan] = useState("");
	const [method, setMethod] = useState<CreateRefundRequestInput["method"] | "">(
		"",
	);
	const [refundedAt, setRefundedAt] = useState(getShanghaiCurrentDateTime);
	const [reason, setReason] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<RefundFormErrors>({});
	const mutation = useMutation(
		orpc.training.finance.refundRequests.create.mutationOptions({
			onSuccess: async () => {
				toast.success("退款申请已提交，等待审批");
				await invalidateFinanceQueries();
			},
			onError: (mutationError) =>
				toast.error(`退款申请提交失败：${mutationError.message}`),
		}),
	);
	usePendingNotification(mutation.isPending, onPendingChange);

	function clearError(field: RefundFormField) {
		setErrors((current) => {
			if (!current[field]) return current;
			const next = { ...current };
			delete next[field];
			return next;
		});
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;
		const nextErrors: RefundFormErrors = {};
		const amountInCents = parseYuanToCents(amountInYuan);
		if (amountInCents === null) {
			nextErrors.amountInCents = "请输入最多两位小数的有效金额";
		} else if (amountInCents > maxAmountInCents) {
			nextErrors.amountInCents = "退款金额不能大于当前可退款金额";
		}
		const refundedAtIso = shanghaiDateTimeToIso(refundedAt);
		if (!refundedAtIso) nextErrors.refundedAt = "请选择有效的退款时间";
		if (!method) nextErrors.method = "请选择退款方式";
		if (!reason.trim()) nextErrors.reason = "请填写申请原因";
		if (
			amountInCents === null ||
			amountInCents > maxAmountInCents ||
			!refundedAtIso ||
			!method ||
			!reason.trim()
		) {
			setErrors(nextErrors);
			toast.error("请检查退款申请信息");
			return;
		}
		const result = createRefundRequestInputSchema.safeParse({
			invoiceId: invoice.id,
			amountInCents,
			refundedAt: refundedAtIso,
			method,
			reason,
			requestId,
		});
		if (!result.success) {
			for (const issue of result.error.issues) {
				const field = issue.path[0];
				if (
					field === "amountInCents" ||
					field === "refundedAt" ||
					field === "method" ||
					field === "reason"
				) {
					nextErrors[field] ??= issue.message;
				}
			}
			setErrors(nextErrors);
			toast.error("请检查退款申请信息");
			return;
		}
		setErrors({});
		mutation.mutate(result.data);
	}

	return (
		<section className="min-w-0 border p-4" aria-labelledby="refund-form-title">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 id="refund-form-title" className="font-semibold text-sm">
						申请退款
					</h2>
					<p className="mt-1 text-muted-foreground text-xs">
						本账单最多可申请 {formatCentsToCurrency(maxAmountInCents)}
						，批准前不会改变资金状态。
					</p>
				</div>
				<RotateCcwIcon className="size-4 text-muted-foreground" />
			</div>
			<form
				className="mt-4 grid gap-4 sm:grid-cols-2"
				onSubmit={submit}
				noValidate
			>
				<Field invalid={Boolean(errors.amountInCents)}>
					<FieldLabel htmlFor="refund-amount">退款金额（元）</FieldLabel>
					<Input
						id="refund-amount"
						inputMode="decimal"
						value={amountInYuan}
						onChange={(event) => {
							setAmountInYuan(event.target.value);
							clearError("amountInCents");
						}}
						aria-invalid={Boolean(errors.amountInCents)}
						required
					/>
					{errors.amountInCents ? (
						<FieldError match>{errors.amountInCents}</FieldError>
					) : null}
				</Field>
				<Field invalid={Boolean(errors.refundedAt)}>
					<FieldLabel htmlFor="refund-time">退款时间</FieldLabel>
					<Input
						id="refund-time"
						type="datetime-local"
						value={refundedAt}
						onChange={(event) => {
							setRefundedAt(event.target.value);
							clearError("refundedAt");
						}}
						aria-invalid={Boolean(errors.refundedAt)}
						required
					/>
					{errors.refundedAt ? (
						<FieldError match>{errors.refundedAt}</FieldError>
					) : null}
				</Field>
				<Field invalid={Boolean(errors.method)}>
					<FieldLabel htmlFor="refund-method">退款方式</FieldLabel>
					<Select
						value={method || null}
						onValueChange={(value) => {
							setMethod(value ?? "");
							clearError("method");
						}}
					>
						<SelectTrigger
							id="refund-method"
							className="w-full"
							aria-invalid={Boolean(errors.method)}
						>
							<SelectValue>
								{() =>
									method ? getPaymentMethodLabel(method) : "请选择退款方式"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{paymentMethods.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{errors.method ? (
						<FieldError match>{errors.method}</FieldError>
					) : null}
				</Field>
				<Field className="sm:col-span-2" invalid={Boolean(errors.reason)}>
					<FieldLabel htmlFor="refund-reason">申请原因</FieldLabel>
					<Textarea
						id="refund-reason"
						value={reason}
						onChange={(event) => {
							setReason(event.target.value);
							clearError("reason");
						}}
						maxLength={500}
						aria-invalid={Boolean(errors.reason)}
						required
					/>
					{errors.reason ? (
						<FieldError match>{errors.reason}</FieldError>
					) : null}
				</Field>
				<div className="sm:col-span-2 sm:flex sm:justify-end">
					<Button
						type="submit"
						className="w-full sm:w-auto"
						disabled={mutation.isPending}
					>
						{mutation.isPending ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : (
							<RotateCcwIcon data-icon="inline-start" />
						)}
						{mutation.isPending ? "提交中" : "提交退款申请"}
					</Button>
				</div>
			</form>
		</section>
	);
}

function RefundRequestActionDialog({
	request,
	action,
	reasonRequired,
	onClose,
	onPendingChange,
}: {
	request: RefundRequest;
	action: RefundAction;
	reasonRequired: boolean;
	onClose: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [comment, setComment] = useState("");
	const [submitAttempted, setSubmitAttempted] = useState(false);
	const [requestId] = useState(() => crypto.randomUUID());
	const decideMutation = useMutation(
		orpc.training.finance.refundRequests.decide.mutationOptions(),
	);
	const cancelMutation = useMutation(
		orpc.training.finance.refundRequests.cancel.mutationOptions(),
	);
	const pending = decideMutation.isPending || cancelMutation.isPending;
	usePendingNotification(pending, onPendingChange);

	async function handleSuccess() {
		toast.success(
			action === "approved"
				? "退款申请已批准"
				: action === "rejected"
					? "退款申请已拒绝"
					: "退款申请已取消",
		);
		try {
			await invalidateFinanceQueries();
		} catch {
			toast.warning("操作已完成，但数据刷新失败，请稍后手动刷新。");
		} finally {
			onClose();
		}
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubmitAttempted(true);
		if (pending || (reasonRequired && !comment.trim())) return;
		if (action === "cancelled") {
			cancelMutation.mutate(
				{
					refundRequestId: request.id,
					reason: comment.trim() || null,
					expectedVersion: request.version,
					requestId,
				},
				{
					onSuccess: handleSuccess,
					onError: (error) => toast.error(`取消失败：${error.message}`),
				},
			);
			return;
		}
		decideMutation.mutate(
			{
				refundRequestId: request.id,
				action,
				comment: comment.trim() || null,
				expectedVersion: request.version,
				requestId,
			},
			{
				onSuccess: handleSuccess,
				onError: (error) =>
					toast.error(
						`${action === "approved" ? "批准" : "拒绝"}失败：${error.message}`,
					),
			},
		);
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{getActionTitle(action)}</DialogTitle>
					<DialogDescription>
						{request.applicantName} 申请退款{" "}
						{formatCentsToCurrency(request.amountInCents)}
						，退款方式为 {getPaymentMethodLabel(request.method)}，退款时间为
						{formatDateTime(request.refundedAt)}
						。提交时系统会重新校验最新资金状态和权限。
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} noValidate>
					<Field invalid={submitAttempted && reasonRequired && !comment.trim()}>
						<FieldLabel htmlFor="refund-action-comment">
							{action === "approved"
								? "批准意见（可选）"
								: action === "rejected"
									? "拒绝原因"
									: reasonRequired
										? "取消原因"
										: "取消原因（可选）"}
						</FieldLabel>
						<Textarea
							id="refund-action-comment"
							value={comment}
							onChange={(event) => setComment(event.target.value)}
							maxLength={500}
							disabled={pending}
							aria-invalid={
								submitAttempted && reasonRequired && !comment.trim()
							}
							required={reasonRequired}
						/>
						{submitAttempted && reasonRequired && !comment.trim() ? (
							<FieldError match>请填写原因</FieldError>
						) : null}
					</Field>
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							返回
						</Button>
						<Button
							type="submit"
							variant={action === "rejected" ? "destructive" : "default"}
							disabled={pending}
						>
							{pending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{pending ? "提交中" : getActionTitle(action)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function usePendingNotification(
	pending: boolean,
	onPendingChange: (pending: boolean) => void,
) {
	useEffect(() => {
		onPendingChange(pending);
		return () => onPendingChange(false);
	}, [pending, onPendingChange]);
}

function getPaymentMethodLabel(
	method: CreateRefundRequestInput["method"],
): string {
	return paymentMethods.find((item) => item.value === method)?.label ?? "其他";
}

function getRequestStatusLabel(status: RefundRequest["status"]): string {
	if (status === "approved") return "已批准";
	if (status === "rejected") return "已拒绝";
	if (status === "cancelled") return "已取消";
	return "待审批";
}

function getEventActionLabel(
	action: RefundRequest["events"][number]["action"],
): string {
	if (action === "approved") return "批准申请";
	if (action === "rejected") return "拒绝申请";
	if (action === "cancelled") return "取消申请";
	return "提交申请";
}

function getActionTitle(action: RefundAction): string {
	if (action === "approved") return "批准退款申请";
	if (action === "rejected") return "拒绝退款申请";
	return "取消退款申请";
}
