import {
	type CreatePaymentInput,
	type CurrentOrganization,
	createPaymentInputSchema,
	type InvoiceDetail,
	type InvoiceListInput,
	type InvoiceListResult,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
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
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "@easy-training/ui/components/sheet";
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
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CircleDollarSignIcon,
	ClockAlertIcon,
	FilePlus2Icon,
	LoaderCircleIcon,
	PencilLineIcon,
	ReceiptTextIcon,
	RotateCcwIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import { type FormEvent, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { FinanceAdjustments } from "./finance-adjustments";
import {
	formatCentsAsYuan,
	getActivityTypeLabel,
	getInvoiceSourceLabel,
	getShanghaiCurrentDateTime,
	parseYuanToCents,
	shanghaiDateTimeToIso,
} from "./finance-form-utils";
import { invalidateFinanceQueries } from "./finance-query-utils";
import { formatCentsToCurrency, formatDate, formatDateTime } from "./format";
import { InvoiceAdjustmentDialog } from "./invoice-adjustment-dialog";
import { ManualInvoiceDialog } from "./manual-invoice-dialog";
import { PaymentReversalDialog } from "./payment-reversal-dialog";
import { RefundApprovalPanel } from "./refund-approval-panel";

type InvoiceSummary = InvoiceListResult["items"][number];
type InvoiceStatusFilter = InvoiceListInput["status"];
type PaymentMethod = CreatePaymentInput["method"];
type PaymentFormField =
	| "amountInCents"
	| "receivedAt"
	| "method"
	| "referenceNo"
	| "note";
type PaymentFormErrors = Partial<Record<PaymentFormField, string>>;

const statusFilters: Array<{ value: InvoiceStatusFilter; label: string }> = [
	{ value: "all", label: "全部账单" },
	{ value: "open", label: "未结清" },
	{ value: "pending", label: "待收款" },
	{ value: "partial", label: "部分收款" },
	{ value: "paid", label: "已结清" },
	{ value: "refunded", label: "已退款" },
];

const paymentMethods: Array<{ value: PaymentMethod; label: string }> = [
	{ value: "cash", label: "现金" },
	{ value: "wechat", label: "微信" },
	{ value: "alipay", label: "支付宝" },
	{ value: "bankTransfer", label: "银行转账" },
	{ value: "pos", label: "POS" },
	{ value: "other", label: "其他" },
];

export function FinanceWorkspace({
	organizationId,
	organizationRole,
	sessionUserId,
	initialInvoiceId,
	onInvoiceIdChange,
}: {
	organizationId: string;
	organizationRole: CurrentOrganization["role"];
	sessionUserId: string;
	initialInvoiceId?: string;
	onInvoiceIdChange?: (invoiceId: string | null) => void;
}) {
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<InvoiceStatusFilter>("open");
	const [manualInvoiceOpen, setManualInvoiceOpen] = useState(false);
	const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
		initialInvoiceId ?? null,
	);
	useEffect(() => {
		setSelectedInvoiceId(initialInvoiceId ?? null);
	}, [initialInvoiceId]);
	const deferredSearch = useDeferredValue(search.trim());
	const listOptions = orpc.training.finance.invoices.list.queryOptions({
		input: { query: deferredSearch || undefined, status },
	});
	const listQuery = useQuery({
		...listOptions,
		queryKey: [...listOptions.queryKey, { organizationId, sessionUserId }],
	});

	return (
		<div className="flex min-w-0 flex-col gap-5">
			<section className="flex min-w-0 flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<p className="text-muted-foreground text-sm">财务管理</p>
					<h1 className="mt-1 font-semibold text-2xl">应收账单</h1>
					{listQuery.data ? (
						<p
							className="mt-1 text-muted-foreground text-xs"
							aria-live="polite"
						>
							共 {listQuery.data.total} 笔
						</p>
					) : null}
				</div>
				<Button onClick={() => setManualInvoiceOpen(true)}>
					<FilePlus2Icon data-icon="inline-start" />
					手工开单
				</Button>
			</section>

			<section className="flex min-w-0 flex-col gap-3 sm:flex-row">
				<div className="relative min-w-0 flex-1">
					<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="搜索应收账单"
						className="w-full pl-8"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="搜索学员、课程或摘要"
					/>
				</div>
				<Select
					value={status}
					onValueChange={(value) => setStatus(value ?? "open")}
				>
					<SelectTrigger className="w-full sm:w-36" aria-label="按结算状态筛选">
						<SelectValue>{() => getFilterLabel(status)}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{statusFilters.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</section>

			<FinanceAdjustments organizationId={organizationId} />

			<InvoiceResults
				data={listQuery.data}
				isPending={listQuery.isPending}
				isError={listQuery.isError}
				errorMessage={listQuery.error?.message}
				isFiltered={Boolean(deferredSearch || status !== "open")}
				onRetry={() => listQuery.refetch()}
				onSelect={(invoiceId) => {
					setSelectedInvoiceId(invoiceId);
					onInvoiceIdChange?.(invoiceId);
				}}
			/>

			{selectedInvoiceId ? (
				<InvoiceDetailSheet
					key={selectedInvoiceId}
					invoiceId={selectedInvoiceId}
					organizationId={organizationId}
					organizationRole={organizationRole}
					sessionUserId={sessionUserId}
					onClose={() => {
						setSelectedInvoiceId(null);
						onInvoiceIdChange?.(null);
					}}
				/>
			) : null}

			{manualInvoiceOpen ? (
				<ManualInvoiceDialog
					organizationId={organizationId}
					onClose={() => setManualInvoiceOpen(false)}
					onCreated={(invoiceId) => {
						setManualInvoiceOpen(false);
						setSelectedInvoiceId(invoiceId);
						onInvoiceIdChange?.(invoiceId);
						void invalidateFinanceQueries().catch(() => {
							toast.warning("账单已创建，部分列表刷新失败，请稍后手动刷新。");
						});
					}}
				/>
			) : null}
		</div>
	);
}

function InvoiceResults({
	data,
	isPending,
	isError,
	errorMessage,
	isFiltered,
	onRetry,
	onSelect,
}: {
	data?: InvoiceListResult;
	isPending: boolean;
	isError: boolean;
	errorMessage?: string;
	isFiltered: boolean;
	onRetry: () => void;
	onSelect: (invoiceId: string) => void;
}) {
	if (isPending) return <InvoiceListSkeleton />;

	if (isError) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ReceiptTextIcon />
					</EmptyMedia>
					<EmptyTitle>应收账单加载失败</EmptyTitle>
					<EmptyDescription>{errorMessage}</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onRetry}>重试</Button>
			</Empty>
		);
	}

	if (!data || data.items.length === 0) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CircleDollarSignIcon />
					</EmptyMedia>
					<EmptyTitle>
						{isFiltered ? "没有匹配的账单" : "暂无应收账单"}
					</EmptyTitle>
					<EmptyDescription>
						{isFiltered
							? "请调整搜索词或结算状态后重试。"
							: "报名、续费或手工创建的应收账单会显示在这里。"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<section className="min-w-0 border" aria-label="应收账单列表">
			<div className="hidden md:block">
				<Table>
					<TableCaption className="sr-only">应收账单列表</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>学员 / 摘要</TableHead>
							<TableHead className="text-right">应收</TableHead>
							<TableHead className="text-right">已收</TableHead>
							<TableHead className="text-right">未收</TableHead>
							<TableHead>到期日</TableHead>
							<TableHead>状态</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.items.map((invoice) => (
							<TableRow
								key={invoice.id}
								className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
								tabIndex={0}
								aria-label={`查看 ${invoice.studentName} 的账单详情`}
								onClick={() => onSelect(invoice.id)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect(invoice.id);
									}
								}}
							>
								<TableCell className="max-w-56 whitespace-normal">
									<div className="min-w-0">
										<span className="block truncate font-medium">
											{invoice.studentName}
										</span>
										<span className="mt-0.5 block truncate text-muted-foreground">
											{invoice.summary}
										</span>
									</div>
								</TableCell>
								<MoneyCell value={invoice.amountInCents} />
								<MoneyCell value={invoice.paidAmountInCents} />
								<MoneyCell value={invoice.outstandingAmountInCents} strong />
								<TableCell>{formatDate(invoice.dueDate)}</TableCell>
								<TableCell>
									<InvoiceBadges invoice={invoice} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<div className="divide-y md:hidden">
				{data.items.map((invoice) => (
					<button
						key={invoice.id}
						type="button"
						className="block w-full min-w-0 p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => onSelect(invoice.id)}
					>
						<span className="flex min-w-0 items-start justify-between gap-2">
							<span className="min-w-0">
								<span className="block truncate font-medium text-sm">
									{invoice.studentName}
								</span>
								<span className="mt-0.5 block truncate text-muted-foreground text-xs">
									{invoice.summary}
								</span>
							</span>
							<InvoiceBadges invoice={invoice} />
						</span>
						<span className="mt-3 grid grid-cols-3 gap-2 text-xs">
							<MobileAmount label="应收" value={invoice.amountInCents} />
							<MobileAmount label="已收" value={invoice.paidAmountInCents} />
							<MobileAmount
								label="未收"
								value={invoice.outstandingAmountInCents}
								strong
							/>
						</span>
						<span className="mt-2 block text-muted-foreground text-xs">
							到期日 {formatDate(invoice.dueDate)}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}

function InvoiceDetailSheet({
	invoiceId,
	organizationId,
	organizationRole,
	sessionUserId,
	onClose,
}: {
	invoiceId: string;
	organizationId: string;
	organizationRole: CurrentOrganization["role"];
	sessionUserId: string;
	onClose: () => void;
}) {
	const [paymentFormGeneration, setPaymentFormGeneration] = useState(0);
	const [paymentPending, setPaymentPending] = useState(false);
	const [adjustmentOpen, setAdjustmentOpen] = useState(false);
	const detailOptions = orpc.training.finance.invoices.detail.queryOptions({
		input: { id: invoiceId },
	});
	const detailQuery = useQuery({
		...detailOptions,
		queryKey: [...detailOptions.queryKey, { organizationId }],
	});

	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open && !paymentPending && !adjustmentOpen) onClose();
			}}
		>
			<SheetContent
				side="right"
				className="w-full max-w-xl overflow-y-auto border-r-0 border-l p-0 sm:w-[min(40rem,92vw)]"
			>
				<header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-3 border-b bg-popover px-4 py-4 sm:px-5">
					<div className="min-w-0">
						<SheetTitle className="font-semibold text-lg">账单详情</SheetTitle>
						<p className="mt-1 truncate text-muted-foreground text-xs">
							账单号 {invoiceId}
						</p>
					</div>
					<SheetClose
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="关闭账单详情"
								disabled={paymentPending}
							/>
						}
					>
						<XIcon data-icon="inline" />
					</SheetClose>
				</header>

				{detailQuery.isPending ? (
					<DetailSkeleton />
				) : detailQuery.isError ? (
					<Empty className="mx-4 mt-4 min-h-64 border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<ReceiptTextIcon />
							</EmptyMedia>
							<EmptyTitle>账单详情加载失败</EmptyTitle>
							<EmptyDescription>{detailQuery.error.message}</EmptyDescription>
						</EmptyHeader>
						<Button onClick={() => detailQuery.refetch()}>重试</Button>
					</Empty>
				) : (
					<InvoiceDetailContent
						detail={detailQuery.data}
						organizationId={organizationId}
						organizationRole={organizationRole}
						sessionUserId={sessionUserId}
						paymentFormGeneration={paymentFormGeneration}
						onAdjust={() => setAdjustmentOpen(true)}
						onPaymentCreated={() =>
							setPaymentFormGeneration((current) => current + 1)
						}
						onPaymentPendingChange={setPaymentPending}
					/>
				)}
			</SheetContent>
			{adjustmentOpen && detailQuery.data ? (
				<InvoiceAdjustmentDialog
					detail={detailQuery.data}
					onClose={() => setAdjustmentOpen(false)}
					onAdjusted={() => {
						setAdjustmentOpen(false);
						void invalidateFinanceQueries().catch(() => {
							toast.warning("账单已调整，部分列表刷新失败，请稍后手动刷新。");
						});
					}}
				/>
			) : null}
		</Sheet>
	);
}

function InvoiceDetailContent({
	detail,
	organizationId,
	organizationRole,
	sessionUserId,
	paymentFormGeneration,
	onAdjust,
	onPaymentCreated,
	onPaymentPendingChange,
}: {
	detail: InvoiceDetail;
	organizationId: string;
	organizationRole: CurrentOrganization["role"];
	sessionUserId: string;
	paymentFormGeneration: number;
	onAdjust: () => void;
	onPaymentCreated: () => void;
	onPaymentPendingChange: (pending: boolean) => void;
}) {
	const { invoice } = detail;
	const [reversalTarget, setReversalTarget] = useState<
		InvoiceDetail["payments"][number] | null
	>(null);
	const payments = [...detail.payments].sort(
		(left, right) =>
			new Date(right.receivedAt).getTime() -
			new Date(left.receivedAt).getTime(),
	);
	const refundedAmountInCents = detail.refunds.reduce(
		(total, refund) => total + refund.amountInCents,
		0,
	);
	const refundableAmountInCents = Math.max(
		invoice.paidAmountInCents - refundedAmountInCents,
		0,
	);
	const canAdjust =
		detail.capabilities.canAdjustAmount ||
		detail.capabilities.canAdjustDueDate ||
		detail.capabilities.canAdjustSummary;

	return (
		<div className="flex min-w-0 flex-col gap-6 p-4 sm:p-5">
			<section className="min-w-0 border p-4" aria-label="账单摘要">
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="truncate font-semibold text-base">
							{invoice.studentName}
						</h2>
						<p className="mt-1 break-words text-muted-foreground text-sm">
							{invoice.summary}
						</p>
					</div>
					<InvoiceBadges invoice={invoice} />
				</div>
				<dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
					<AmountDefinition label="应收" value={invoice.amountInCents} />
					<AmountDefinition label="已收" value={invoice.paidAmountInCents} />
					<AmountDefinition
						label="未收"
						value={invoice.outstandingAmountInCents}
						strong
					/>
					<AmountDefinition label="已退" value={refundedAmountInCents} />
					<div className="col-span-2 sm:col-span-3">
						<dt className="text-muted-foreground text-xs">付款到期日</dt>
						<dd className="mt-1 tabular-nums">{formatDate(invoice.dueDate)}</dd>
					</div>
					<TextDefinition
						label="账单来源"
						value={getInvoiceSourceLabel(invoice.source)}
					/>
					<TextDefinition
						label="业务类型"
						value={getActivityTypeLabel(invoice.businessActivityType)}
					/>
					<TextDefinition
						label="关联课程"
						value={invoice.courseName ?? "未关联课程"}
					/>
					<TextDefinition
						label="创建人"
						value={invoice.createdByName ?? "历史数据"}
					/>
					<TextDefinition
						label="创建时间"
						value={formatDateTime(invoice.issuedAt)}
					/>
					<TextDefinition label="当前版本" value={`V${invoice.version}`} />
				</dl>
				<div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
					<p className="text-muted-foreground text-xs">
						{canAdjust
							? "允许按当前收款状态调整账单条款。"
							: "该账单条款已冻结，不能继续调整。"}
					</p>
					{canAdjust ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onAdjust}
						>
							<PencilLineIcon data-icon="inline-start" />
							调整账单
						</Button>
					) : null}
				</div>
			</section>

			<InvoiceAdjustmentHistory adjustments={detail.adjustments} />

			{invoice.outstandingAmountInCents > 0 ? (
				<PaymentForm
					key={`${invoice.id}-${paymentFormGeneration}`}
					invoice={invoice}
					onCreated={onPaymentCreated}
					onPendingChange={onPaymentPendingChange}
				/>
			) : (
				<div className="border border-emerald-600/30 bg-emerald-600/5 p-4 text-sm">
					{invoice.status === "refunded"
						? "该账单已全额退款，资金与审批记录保持可追溯。"
						: "该账单已结清，无需继续登记收款。"}
				</div>
			)}

			<RefundApprovalPanel
				invoice={invoice}
				maxAmountInCents={refundableAmountInCents}
				organizationId={organizationId}
				organizationRole={organizationRole}
				sessionUserId={sessionUserId}
				onPendingChange={onPaymentPendingChange}
			/>

			<section className="min-w-0" aria-labelledby="payment-history-title">
				<div className="flex items-baseline justify-between gap-3">
					<h2 id="payment-history-title" className="font-semibold text-sm">
						收款流水
					</h2>
					<span className="text-muted-foreground text-xs">
						共 {payments.length} 笔可追溯流水
					</span>
				</div>
				{detail.historicalPaidAmountInCents > 0 ? (
					<div className="mt-3 border border-dashed p-3 text-sm">
						<p className="font-medium">
							期初已收{" "}
							{formatCentsToCurrency(detail.historicalPaidAmountInCents)}
						</p>
						<p className="mt-1 text-muted-foreground text-xs">
							该金额来自历史账单快照，原始收款方式与操作人未迁移。
						</p>
					</div>
				) : null}
				{payments.length > 0 ? (
					<ol className="mt-3 divide-y border">
						{payments.map((payment) => (
							<li key={payment.id} className="min-w-0 p-3 text-sm">
								<div className="flex min-w-0 items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="font-medium">
											{getPaymentMethodLabel(payment.method)}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											{formatDateTime(payment.receivedAt)} ·{" "}
											{payment.operatorName}
										</p>
									</div>
									<div className="shrink-0 text-right tabular-nums">
										<p className="font-semibold">
											{formatCentsToCurrency(payment.amountInCents)}
										</p>
										{payment.reversedAmountInCents > 0 ? (
											<>
												<p className="mt-1 text-destructive text-xs">
													已冲正 -
													{formatCentsToCurrency(payment.reversedAmountInCents)}
												</p>
												<p className="text-muted-foreground text-xs">
													有效{" "}
													{formatCentsToCurrency(
														payment.effectiveAmountInCents,
													)}
												</p>
											</>
										) : null}
									</div>
								</div>
								{payment.referenceNo ? (
									<p className="mt-2 break-all text-muted-foreground text-xs">
										流水号：{payment.referenceNo}
									</p>
								) : null}
								{payment.note ? (
									<p className="mt-1 break-words text-muted-foreground text-xs">
										备注：{payment.note}
									</p>
								) : null}
								{payment.reversals.length > 0 ? (
									<ol className="mt-3 divide-y border-t text-xs">
										{payment.reversals.map((reversal) => (
											<li key={reversal.id} className="py-2">
												<div className="flex items-start justify-between gap-3">
													<div className="min-w-0">
														<p className="font-medium">冲正记录</p>
														<p className="mt-1 break-words text-muted-foreground">
															{reversal.reason}
														</p>
														<p className="mt-1 text-muted-foreground">
															{formatDateTime(reversal.reversedAt)} ·{" "}
															{reversal.operatorName}
														</p>
													</div>
													<span className="shrink-0 font-medium text-destructive tabular-nums">
														-{formatCentsToCurrency(reversal.amountInCents)}
													</span>
												</div>
											</li>
										))}
									</ol>
								) : null}
								<div className="mt-3 flex flex-wrap items-center justify-end gap-2">
									{payment.effectiveAmountInCents <= 0 ? (
										<span className="text-muted-foreground text-xs">
											该收款已全部冲正
										</span>
									) : detail.refunds.length > 0 ? (
										<span className="text-muted-foreground text-xs">
											账单已有退款，不能冲正
										</span>
									) : (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => setReversalTarget(payment)}
										>
											<RotateCcwIcon data-icon="inline-start" />
											冲正
										</Button>
									)}
								</div>
							</li>
						))}
					</ol>
				) : (
					<div className="mt-3 border p-6 text-center text-muted-foreground text-sm">
						暂无收款流水
					</div>
				)}
			</section>

			<section className="min-w-0" aria-labelledby="refund-history-title">
				<div className="flex items-baseline justify-between gap-3">
					<h2 id="refund-history-title" className="font-semibold text-sm">
						退款流水
					</h2>
					<span className="text-muted-foreground text-xs">
						共 {detail.refunds.length} 笔可追溯流水
					</span>
				</div>
				{detail.refunds.length > 0 ? (
					<ol className="mt-3 divide-y border">
						{detail.refunds.map((refund) => (
							<li
								id={`refund-${refund.id}`}
								key={refund.id}
								className="min-w-0 scroll-mt-20 p-3 text-sm"
							>
								<div className="flex min-w-0 items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="font-medium">
											{getPaymentMethodLabel(refund.method)}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											{formatDateTime(refund.refundedAt)} ·{" "}
											{refund.operatorName}
										</p>
									</div>
									<span className="shrink-0 font-semibold tabular-nums">
										-{formatCentsToCurrency(refund.amountInCents)}
									</span>
								</div>
								<p className="mt-2 break-words text-muted-foreground text-xs">
									{refund.reason}
								</p>
							</li>
						))}
					</ol>
				) : (
					<div className="mt-3 border p-6 text-center text-muted-foreground text-sm">
						暂无退款流水
					</div>
				)}
			</section>
			{reversalTarget ? (
				<PaymentReversalDialog
					payment={reversalTarget}
					onClose={() => setReversalTarget(null)}
					onReversed={() => setReversalTarget(null)}
					onPendingChange={onPaymentPendingChange}
				/>
			) : null}
		</div>
	);
}

function PaymentForm({
	invoice,
	onCreated,
	onPendingChange,
}: {
	invoice: InvoiceSummary;
	onCreated: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [amountInYuan, setAmountInYuan] = useState("");
	const [receivedAt, setReceivedAt] = useState(getShanghaiCurrentDateTime);
	const [method, setMethod] = useState<PaymentMethod | "">("");
	const [referenceNo, setReferenceNo] = useState("");
	const [note, setNote] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<PaymentFormErrors>({});
	const paymentMutation = useMutation(
		orpc.training.finance.payments.create.mutationOptions({
			onSuccess: async () => {
				toast.success("收款登记成功");
				try {
					await invalidateFinanceQueries();
				} finally {
					onPendingChange(false);
					onCreated();
				}
			},
			onError: (error) => {
				onPendingChange(false);
				toast.error(`收款登记失败：${error.message}`);
			},
		}),
	);

	function clearError(field: PaymentFormField) {
		setErrors((current) => {
			if (!current[field]) return current;
			const next = { ...current };
			delete next[field];
			return next;
		});
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (paymentMutation.isPending) return;

		const nextErrors: PaymentFormErrors = {};
		const amountInCents = parseYuanToCents(amountInYuan);
		if (amountInCents === null) {
			nextErrors.amountInCents = "请输入最多两位小数的有效金额";
		} else if (amountInCents > invoice.outstandingAmountInCents) {
			nextErrors.amountInCents = "收款金额不能大于账单未收金额";
		}
		const receivedAtIso = shanghaiDateTimeToIso(receivedAt);
		if (!receivedAtIso) nextErrors.receivedAt = "请选择有效的收款时间";
		if (!method) nextErrors.method = "请选择收款方式";
		if (method === "other" && !note.trim()) {
			nextErrors.note = "选择其他收款方式时请填写备注";
		}
		if (
			amountInCents === null ||
			amountInCents > invoice.outstandingAmountInCents ||
			!receivedAtIso ||
			!method
		) {
			setErrors(nextErrors);
			toast.error("请检查收款信息");
			return;
		}

		const result = createPaymentInputSchema.safeParse({
			invoiceId: invoice.id,
			amountInCents,
			receivedAt: receivedAtIso,
			method,
			referenceNo: referenceNo.trim() || null,
			note: note.trim() || null,
			requestId,
		});
		if (!result.success) {
			for (const issue of result.error.issues) {
				const field = getPaymentFormField(issue.path);
				if (field) nextErrors[field] ??= issue.message;
			}
			setErrors(nextErrors);
			toast.error("请检查收款信息");
			return;
		}

		setErrors({});
		onPendingChange(true);
		paymentMutation.mutate(result.data);
	}

	return (
		<section
			className="min-w-0 border p-4"
			aria-labelledby="payment-form-title"
		>
			<div>
				<h2 id="payment-form-title" className="font-semibold text-sm">
					登记收款
				</h2>
				<p className="mt-1 text-muted-foreground text-xs">
					提交失败时会保留当前填写内容，可直接重试。
				</p>
			</div>
			<form
				className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"
				onSubmit={submit}
				noValidate
			>
				<Field invalid={Boolean(errors.amountInCents)}>
					<div className="flex items-center justify-between gap-2">
						<FieldLabel htmlFor="payment-amount">收款金额（元）</FieldLabel>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-auto px-1 py-0 text-muted-foreground text-xs"
							onClick={() => {
								setAmountInYuan(
									formatCentsAsYuan(invoice.outstandingAmountInCents),
								);
								clearError("amountInCents");
							}}
						>
							填入全部未收
						</Button>
					</div>
					<Input
						id="payment-amount"
						value={amountInYuan}
						onChange={(event) => {
							setAmountInYuan(event.target.value);
							clearError("amountInCents");
						}}
						inputMode="decimal"
						placeholder="0.00"
						aria-invalid={Boolean(errors.amountInCents)}
						required
					/>
					<FieldError match={Boolean(errors.amountInCents)}>
						{errors.amountInCents}
					</FieldError>
				</Field>
				<Field invalid={Boolean(errors.receivedAt)}>
					<FieldLabel htmlFor="payment-received-at">收款时间</FieldLabel>
					<Input
						id="payment-received-at"
						type="datetime-local"
						value={receivedAt}
						onChange={(event) => {
							setReceivedAt(event.target.value);
							clearError("receivedAt");
						}}
						aria-invalid={Boolean(errors.receivedAt)}
						required
					/>
					<FieldError match={Boolean(errors.receivedAt)}>
						{errors.receivedAt}
					</FieldError>
				</Field>
				<Field invalid={Boolean(errors.method)}>
					<FieldLabel htmlFor="payment-method">收款方式</FieldLabel>
					<Select
						value={method || null}
						onValueChange={(value) => {
							setMethod(value ?? "");
							clearError("method");
							clearError("note");
						}}
					>
						<SelectTrigger
							id="payment-method"
							className="w-full"
							aria-invalid={Boolean(errors.method)}
						>
							<SelectValue>
								{() =>
									method ? getPaymentMethodLabel(method) : "请选择收款方式"
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
					<FieldError match={Boolean(errors.method)}>
						{errors.method}
					</FieldError>
				</Field>
				<Field invalid={Boolean(errors.referenceNo)}>
					<FieldLabel htmlFor="payment-reference-no">流水号（可选）</FieldLabel>
					<Input
						id="payment-reference-no"
						value={referenceNo}
						onChange={(event) => {
							setReferenceNo(event.target.value);
							clearError("referenceNo");
						}}
						maxLength={100}
					/>
					<FieldError match={Boolean(errors.referenceNo)}>
						{errors.referenceNo}
					</FieldError>
				</Field>
				<Field className="sm:col-span-2" invalid={Boolean(errors.note)}>
					<FieldLabel htmlFor="payment-note">
						备注{method === "other" ? "（必填）" : "（可选）"}
					</FieldLabel>
					<Textarea
						id="payment-note"
						value={note}
						onChange={(event) => {
							setNote(event.target.value);
							clearError("note");
						}}
						maxLength={500}
						aria-invalid={Boolean(errors.note)}
						required={method === "other"}
					/>
					<FieldError match={Boolean(errors.note)}>{errors.note}</FieldError>
				</Field>
				<div className="sm:col-span-2 sm:flex sm:justify-end">
					<Button
						type="submit"
						className="w-full sm:w-auto"
						disabled={paymentMutation.isPending}
					>
						{paymentMutation.isPending ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : null}
						{paymentMutation.isPending ? "提交中" : "确认登记"}
					</Button>
				</div>
			</form>
		</section>
	);
}

function InvoiceBadges({ invoice }: { invoice: InvoiceSummary }) {
	return (
		<span className="flex shrink-0 flex-wrap justify-end gap-1">
			<Badge variant="outline">
				{getActivityTypeLabel(invoice.businessActivityType)}
			</Badge>
			<Badge variant={invoice.status === "paid" ? "outline" : "secondary"}>
				{getInvoiceStatusLabel(invoice.status)}
			</Badge>
			{invoice.isOverdue ? (
				<Badge variant="destructive">
					<ClockAlertIcon data-icon="inline-start" />
					逾期
				</Badge>
			) : null}
		</span>
	);
}

function MoneyCell({
	value,
	strong = false,
}: {
	value: number;
	strong?: boolean;
}) {
	return (
		<TableCell
			className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}
		>
			{formatCentsToCurrency(value)}
		</TableCell>
	);
}

function MobileAmount({
	label,
	value,
	strong = false,
}: {
	label: string;
	value: number;
	strong?: boolean;
}) {
	return (
		<span className="min-w-0">
			<span className="block text-muted-foreground">{label}</span>
			<span
				className={`mt-1 block truncate tabular-nums ${strong ? "font-semibold" : ""}`}
			>
				{formatCentsToCurrency(value)}
			</span>
		</span>
	);
}

function AmountDefinition({
	label,
	value,
	strong = false,
}: {
	label: string;
	value: number;
	strong?: boolean;
}) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd
				className={`mt-1 truncate tabular-nums ${strong ? "font-semibold" : ""}`}
			>
				{formatCentsToCurrency(value)}
			</dd>
		</div>
	);
}

function TextDefinition({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 break-words">{value}</dd>
		</div>
	);
}

function InvoiceAdjustmentHistory({
	adjustments,
}: {
	adjustments: InvoiceDetail["adjustments"];
}) {
	return (
		<section className="min-w-0" aria-labelledby="adjustment-history-title">
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="adjustment-history-title" className="font-semibold text-sm">
					账单调整记录
				</h2>
				<span className="text-muted-foreground text-xs">
					共 {adjustments.length} 次调整
				</span>
			</div>
			{adjustments.length > 0 ? (
				<ol className="mt-3 divide-y border">
					{adjustments.map((adjustment) => (
						<li key={adjustment.id} className="min-w-0 p-3 text-sm">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<p className="font-medium">
									V{adjustment.beforeVersion} → V{adjustment.afterVersion}
								</p>
								<p className="text-muted-foreground text-xs">
									{formatDateTime(adjustment.createdAt)} ·{" "}
									{adjustment.operatorName}
								</p>
							</div>
							<ul className="mt-2 space-y-1 text-muted-foreground text-xs">
								{adjustment.before.amountInCents !==
								adjustment.after.amountInCents ? (
									<li>
										金额：
										{formatCentsToCurrency(adjustment.before.amountInCents)} →{" "}
										{formatCentsToCurrency(adjustment.after.amountInCents)}
									</li>
								) : null}
								{adjustment.before.dueDate !== adjustment.after.dueDate ? (
									<li>
										到期日：{formatDate(adjustment.before.dueDate)} →{" "}
										{formatDate(adjustment.after.dueDate)}
									</li>
								) : null}
								{adjustment.before.summary !== adjustment.after.summary ? (
									<li className="break-words">
										摘要：{adjustment.before.summary} →{" "}
										{adjustment.after.summary}
									</li>
								) : null}
							</ul>
							<p className="mt-2 break-words border-t pt-2 text-xs">
								调整原因：{adjustment.reason}
							</p>
						</li>
					))}
				</ol>
			) : (
				<div className="mt-3 border p-6 text-center text-muted-foreground text-sm">
					暂无调整记录
				</div>
			)}
		</section>
	);
}

function InvoiceListSkeleton() {
	return (
		<div className="border" role="status" aria-label="正在加载应收账单">
			{["one", "two", "three", "four", "five"].map((key) => (
				<div
					key={key}
					className="flex items-center gap-4 border-b p-3 last:border-b-0"
				>
					<Skeleton className="h-9 flex-1" />
					<Skeleton className="hidden h-6 w-24 sm:block" />
					<Skeleton className="h-6 w-16" />
				</div>
			))}
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div
			className="flex flex-col gap-5 p-4"
			role="status"
			aria-label="正在加载账单详情"
		>
			<Skeleton className="h-40 w-full" />
			<Skeleton className="h-72 w-full" />
			<Skeleton className="h-48 w-full" />
		</div>
	);
}

function getFilterLabel(status: InvoiceStatusFilter): string {
	return statusFilters.find((item) => item.value === status)?.label ?? "未结清";
}

function getInvoiceStatusLabel(status: InvoiceSummary["status"]): string {
	if (status === "partial") return "部分收款";
	if (status === "paid") return "已结清";
	if (status === "refunded") return "已退款";
	return "待收款";
}

function getPaymentMethodLabel(method: PaymentMethod): string {
	return paymentMethods.find((item) => item.value === method)?.label ?? "其他";
}

function getPaymentFormField(path: PropertyKey[]): PaymentFormField | null {
	const field = path[0];
	if (
		field === "amountInCents" ||
		field === "receivedAt" ||
		field === "method" ||
		field === "referenceNo" ||
		field === "note"
	) {
		return field;
	}
	return null;
}
