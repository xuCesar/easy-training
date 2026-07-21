import {
	generateReceiptDocumentInputSchema,
	type ReceiptDocumentView,
	reissueReceiptDocumentInputSchema,
	voidReceiptDocumentInputSchema,
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
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	BanIcon,
	LoaderCircleIcon,
	PrinterIcon,
	ReceiptTextIcon,
	RefreshCwIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { invalidateFinanceQueries } from "./finance-query-utils";
import { ReceiptDocumentViewContent } from "./receipt-document-view";

export type ReceiptDocumentDialogMode = "generate" | "view" | "reissue";

type IssueField = "title" | "note";

export function ReceiptDocumentDialog({
	organizationId,
	paymentId,
	studentName,
	initialReceiptId,
	initialMode,
	onClose,
	onPendingChange,
}: {
	organizationId: string;
	paymentId: string;
	studentName: string;
	initialReceiptId: string | null;
	initialMode: ReceiptDocumentDialogMode;
	onClose: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [mode, setMode] = useState(initialMode);
	const [receiptId, setReceiptId] = useState(initialReceiptId);
	const [pending, setPending] = useState(false);

	function setMutationPending(next: boolean) {
		setPending(next);
		onPendingChange(next);
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent className="receipt-print-shell max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
				{mode === "generate" ? (
					<ReceiptIssueForm
						kind="generate"
						paymentId={paymentId}
						studentName={studentName}
						onCancel={onClose}
						onPendingChange={setMutationPending}
						onResolved={(nextReceiptId) => {
							setReceiptId(nextReceiptId);
							setMode("view");
						}}
					/>
				) : receiptId ? (
					<ReceiptDocumentPanel
						key={receiptId}
						organizationId={organizationId}
						receiptId={receiptId}
						mode={mode}
						onClose={onClose}
						onPendingChange={setMutationPending}
						onModeChange={setMode}
						onReceiptChange={(nextReceiptId) => {
							setReceiptId(nextReceiptId);
							setMode("view");
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ReceiptIssueForm({
	kind,
	paymentId,
	studentName,
	source,
	onCancel,
	onPendingChange,
	onResolved,
}: {
	kind: "generate" | "reissue";
	paymentId?: string;
	studentName?: string;
	source?: ReceiptDocumentView;
	onCancel: () => void;
	onPendingChange: (pending: boolean) => void;
	onResolved: (receiptId: string) => void;
}) {
	const [title, setTitle] = useState(
		source?.document.title ?? `${studentName ?? "学员"}收款凭证`,
	);
	const [note, setNote] = useState(source?.document.note ?? "");
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<Partial<Record<IssueField, string>>>({});
	const generateMutation = useMutation(
		orpc.training.finance.receipts.generate.mutationOptions(),
	);
	const reissueMutation = useMutation(
		orpc.training.finance.receipts.reissue.mutationOptions(),
	);
	const isPending = generateMutation.isPending || reissueMutation.isPending;

	function clearError(field: IssueField) {
		if (generateMutation.isError || reissueMutation.isError) {
			setRequestId(crypto.randomUUID());
			generateMutation.reset();
			reissueMutation.reset();
		}
		setErrors((current) => {
			if (!current[field]) return current;
			const next = { ...current };
			delete next[field];
			return next;
		});
	}

	async function finish(receiptId: string, successMessage: string) {
		toast.success(successMessage);
		try {
			await invalidateFinanceQueries();
		} catch {
			toast.warning("凭证已保存，部分页面刷新失败，请稍后手动刷新。");
		} finally {
			onPendingChange(false);
			onResolved(receiptId);
		}
	}

	function fail(error: Error) {
		onPendingChange(false);
		toast.error(
			`${kind === "generate" ? "凭证开具" : "凭证补开"}失败：${error.message}`,
		);
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isPending) return;
		const common = { title, note: note.trim() || null, requestId };

		function handleInvalidResult(
			issues: Array<{ path: PropertyKey[]; message: string }>,
		) {
			const next: Partial<Record<IssueField, string>> = {};
			for (const issue of issues) {
				const field = issue.path[0];
				if (field === "title" || field === "note") {
					next[field] ??= issue.message;
				}
			}
			setErrors(next);
			toast.error("请检查凭证信息");
		}

		if (kind === "generate") {
			const result = generateReceiptDocumentInputSchema.safeParse({
				...common,
				paymentIds: paymentId ? [paymentId] : [],
			});
			if (!result.success) {
				handleInvalidResult(result.error.issues);
				return;
			}
			setErrors({});
			onPendingChange(true);
			generateMutation.mutate(result.data, {
				onSuccess: (value) => finish(value.receiptId, "收款凭证已开具"),
				onError: fail,
			});
			return;
		}
		const result = reissueReceiptDocumentInputSchema.safeParse({
			...common,
			replacesReceiptId: source?.document.id ?? "",
		});
		if (!result.success) {
			handleInvalidResult(result.error.issues);
			return;
		}
		setErrors({});
		onPendingChange(true);
		reissueMutation.mutate(result.data, {
			onSuccess: (value) => finish(value.receiptId, "收款凭证已补开"),
			onError: fail,
		});
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{kind === "generate" ? "开具收款凭证" : "补开收款凭证"}
				</DialogTitle>
				<DialogDescription>
					{kind === "generate"
						? "凭证开具后不可编辑；如信息有误，需要作废后以新编号补开。"
						: "补开会分配新编号，原凭证和资金快照保持不变。只能调整抬头与备注。"}
				</DialogDescription>
			</DialogHeader>
			<form className="grid gap-4" onSubmit={submit} noValidate>
				<Field invalid={Boolean(errors.title)}>
					<FieldLabel htmlFor={`receipt-${kind}-title`}>凭证抬头</FieldLabel>
					<Input
						id={`receipt-${kind}-title`}
						value={title}
						onChange={(event) => {
							setTitle(event.target.value);
							clearError("title");
						}}
						maxLength={100}
						aria-invalid={Boolean(errors.title)}
						required
					/>
					<FieldError match={Boolean(errors.title)}>{errors.title}</FieldError>
				</Field>
				<Field invalid={Boolean(errors.note)}>
					<FieldLabel htmlFor={`receipt-${kind}-note`}>
						凭证备注（可选）
					</FieldLabel>
					<Textarea
						id={`receipt-${kind}-note`}
						value={note}
						onChange={(event) => {
							setNote(event.target.value);
							clearError("note");
						}}
						maxLength={500}
						aria-invalid={Boolean(errors.note)}
					/>
					<FieldError match={Boolean(errors.note)}>{errors.note}</FieldError>
				</Field>
				<DialogFooter className="flex-col sm:flex-row">
					<Button
						type="button"
						variant="outline"
						className="w-full sm:w-auto"
						onClick={onCancel}
						disabled={isPending}
					>
						取消
					</Button>
					<Button
						type="submit"
						className="w-full sm:w-auto"
						disabled={isPending}
					>
						{isPending ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : null}
						{isPending
							? "提交中"
							: kind === "generate"
								? "确认开具"
								: "确认补开"}
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}

function ReceiptDocumentPanel({
	organizationId,
	receiptId,
	mode,
	onClose,
	onPendingChange,
	onModeChange,
	onReceiptChange,
}: {
	organizationId: string;
	receiptId: string;
	mode: "view" | "reissue";
	onClose: () => void;
	onPendingChange: (pending: boolean) => void;
	onModeChange: (mode: ReceiptDocumentDialogMode) => void;
	onReceiptChange: (receiptId: string) => void;
}) {
	const [voidOpen, setVoidOpen] = useState(false);
	const options = orpc.training.finance.receipts.get.queryOptions({
		input: { receiptId },
	});
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, { organizationId }],
	});

	if (query.isPending) return <ReceiptDocumentSkeleton />;
	if (query.isError) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>收款凭证</DialogTitle>
					<DialogDescription>读取凭证详情</DialogDescription>
				</DialogHeader>
				<Empty className="min-h-56 border">
					<EmptyHeader>
						<EmptyTitle>凭证加载失败</EmptyTitle>
						<EmptyDescription>{query.error.message}</EmptyDescription>
					</EmptyHeader>
					<Button onClick={() => query.refetch()}>重试</Button>
				</Empty>
			</>
		);
	}
	if (mode === "reissue") {
		return (
			<ReceiptIssueForm
				kind="reissue"
				source={query.data}
				onCancel={() => onModeChange("view")}
				onPendingChange={onPendingChange}
				onResolved={onReceiptChange}
			/>
		);
	}

	function printReceipt() {
		document.body.classList.add("receipt-printing");
		try {
			window.print();
		} finally {
			document.body.classList.remove("receipt-printing");
		}
	}

	return (
		<>
			<DialogHeader className="receipt-print-controls">
				<div className="flex flex-wrap items-center gap-2">
					<DialogTitle>收款凭证</DialogTitle>
					<Badge
						variant={
							query.data.document.status === "active"
								? "outline"
								: "destructive"
						}
					>
						{query.data.document.status === "active" ? "有效" : "已作废"}
					</Badge>
				</div>
				<DialogDescription>
					凭证编号 {query.data.document.number}
				</DialogDescription>
			</DialogHeader>
			<ReceiptDocumentViewContent view={query.data} />
			<DialogFooter className="receipt-print-controls flex-col sm:flex-row">
				<Button
					type="button"
					variant="outline"
					className="w-full sm:w-auto"
					onClick={onClose}
				>
					关闭
				</Button>
				{query.data.document.status === "active" ? (
					<Button
						type="button"
						variant="outline"
						className="w-full sm:w-auto"
						onClick={() => setVoidOpen(true)}
					>
						<BanIcon data-icon="inline-start" />
						作废
					</Button>
				) : (
					<Button
						type="button"
						variant="outline"
						className="w-full sm:w-auto"
						onClick={() => onModeChange("reissue")}
					>
						<RefreshCwIcon data-icon="inline-start" />
						补开
					</Button>
				)}
				<Button
					type="button"
					className="w-full sm:w-auto"
					onClick={printReceipt}
				>
					<PrinterIcon data-icon="inline-start" />
					打印 / 另存 PDF
				</Button>
			</DialogFooter>
			{voidOpen ? (
				<VoidReceiptDialog
					receipt={query.data}
					onClose={() => setVoidOpen(false)}
					onPendingChange={onPendingChange}
					onVoided={async () => {
						setVoidOpen(false);
						await query.refetch();
					}}
				/>
			) : null}
		</>
	);
}

function VoidReceiptDialog({
	receipt,
	onClose,
	onPendingChange,
	onVoided,
}: {
	receipt: ReceiptDocumentView;
	onClose: () => void;
	onPendingChange: (pending: boolean) => void;
	onVoided: () => Promise<void>;
}) {
	const [reason, setReason] = useState("");
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [error, setError] = useState<string | null>(null);
	const mutation = useMutation(
		orpc.training.finance.receipts.void.mutationOptions({
			onSuccess: async () => {
				toast.success("收款凭证已作废");
				try {
					await invalidateFinanceQueries();
				} catch {
					toast.warning("凭证已作废，部分页面刷新失败，请稍后手动刷新。");
				} finally {
					try {
						await onVoided();
					} finally {
						onPendingChange(false);
					}
				}
			},
			onError: (mutationError) => {
				onPendingChange(false);
				toast.error(`凭证作废失败：${mutationError.message}`);
			},
		}),
	);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;
		const result = voidReceiptDocumentInputSchema.safeParse({
			receiptId: receipt.document.id,
			reason,
			requestId,
		});
		if (!result.success) {
			setError(result.error.issues[0]?.message ?? "请填写作废原因");
			toast.error("请填写作废原因");
			return;
		}
		setError(null);
		onPendingChange(true);
		mutation.mutate(result.data);
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
				<DialogHeader>
					<DialogTitle>确认作废收款凭证</DialogTitle>
					<DialogDescription>
						凭证 {receipt.document.number}{" "}
						将永久标记为已作废，资金事实不会改变。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit} noValidate>
					<Field invalid={Boolean(error)}>
						<FieldLabel htmlFor="receipt-void-reason">作废原因</FieldLabel>
						<Textarea
							id="receipt-void-reason"
							value={reason}
							onChange={(event) => {
								setReason(event.target.value);
								setError(null);
								if (mutation.isError) {
									setRequestId(crypto.randomUUID());
									mutation.reset();
								}
							}}
							maxLength={500}
							aria-invalid={Boolean(error)}
							required
						/>
						<FieldError match={Boolean(error)}>{error}</FieldError>
					</Field>
					<DialogFooter className="flex-col sm:flex-row">
						<Button
							type="button"
							variant="outline"
							className="w-full sm:w-auto"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button
							type="submit"
							variant="destructive"
							className="w-full sm:w-auto"
							disabled={mutation.isPending}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "确认作废"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ReceiptDocumentSkeleton() {
	return (
		<div className="space-y-4" role="status" aria-label="正在加载收款凭证">
			<div className="flex items-center gap-2">
				<ReceiptTextIcon className="size-5 text-muted-foreground" />
				<Skeleton className="h-6 w-36" />
			</div>
			<Skeleton className="h-28 w-full" />
			<Skeleton className="h-48 w-full" />
		</div>
	);
}
