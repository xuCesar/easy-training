import {
	type AdjustInvoiceInput,
	adjustInvoiceInputSchema,
	type InvoiceDetail,
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
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { formatCentsAsYuan, parseYuanToCents } from "./finance-form-utils";

type AdjustmentField = "amountInCents" | "dueDate" | "summary" | "reason";

export function InvoiceAdjustmentDialog({
	detail,
	onClose,
	onAdjusted,
}: {
	detail: InvoiceDetail;
	onClose: () => void;
	onAdjusted: () => void;
}) {
	const { invoice, capabilities } = detail;
	const [amountInYuan, setAmountInYuan] = useState(() =>
		formatCentsAsYuan(invoice.amountInCents),
	);
	const [dueDate, setDueDate] = useState(invoice.dueDate);
	const [summary, setSummary] = useState(invoice.summary);
	const [reason, setReason] = useState("");
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<
		Partial<Record<AdjustmentField, string>>
	>({});
	const mutation = useMutation(
		orpc.training.finance.invoices.adjust.mutationOptions({
			onSuccess: () => {
				toast.success("账单已调整");
				onAdjusted();
			},
			onError: (error) => toast.error(`账单调整失败：${error.message}`),
		}),
	);

	function clearError(field: AdjustmentField) {
		if (mutation.isError) {
			setRequestId(crypto.randomUUID());
			mutation.reset();
		}
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
		const amountInCents = parseYuanToCents(amountInYuan);
		const hasChanges =
			(capabilities.canAdjustAmount &&
				amountInCents !== null &&
				amountInCents !== invoice.amountInCents) ||
			(capabilities.canAdjustDueDate && dueDate !== invoice.dueDate) ||
			(capabilities.canAdjustSummary && summary.trim() !== invoice.summary);
		const candidate: AdjustInvoiceInput = {
			invoiceId: invoice.id,
			reason,
			expectedVersion: invoice.version,
			requestId,
			...(capabilities.canAdjustAmount &&
			amountInCents !== invoice.amountInCents
				? { amountInCents: amountInCents ?? 0 }
				: {}),
			...(capabilities.canAdjustDueDate && dueDate !== invoice.dueDate
				? { dueDate }
				: {}),
			...(capabilities.canAdjustSummary && summary.trim() !== invoice.summary
				? { summary }
				: {}),
		};
		const result = adjustInvoiceInputSchema.safeParse(candidate);
		if (
			!result.success ||
			(capabilities.canAdjustAmount && amountInCents === null)
		) {
			const next: Partial<Record<AdjustmentField, string>> = {};
			for (const issue of result.success ? [] : result.error.issues) {
				const field = issue.path[0];
				if (
					field === "amountInCents" ||
					field === "dueDate" ||
					field === "summary" ||
					field === "reason"
				)
					next[field] ??= issue.message;
			}
			if (capabilities.canAdjustAmount && amountInCents === null)
				next.amountInCents = "请输入有效金额";
			if (
				!hasChanges &&
				!(capabilities.canAdjustAmount && amountInCents === null)
			)
				next.summary = "请至少修改一个账单字段";
			setErrors(next);
			toast.error("请修改账单内容并填写原因");
			return;
		}
		setErrors({});
		mutation.mutate(result.data);
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>调整账单</DialogTitle>
					<DialogDescription>
						修改会留下完整前后值、原因和操作人记录。
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4 sm:grid-cols-2"
					onSubmit={submit}
					noValidate
				>
					<Field invalid={Boolean(errors.amountInCents)}>
						<FieldLabel htmlFor="adjust-invoice-amount">金额（元）</FieldLabel>
						<Input
							id="adjust-invoice-amount"
							inputMode="decimal"
							value={amountInYuan}
							disabled={!capabilities.canAdjustAmount}
							onChange={(event) => {
								setAmountInYuan(event.target.value);
								clearError("amountInCents");
							}}
							aria-invalid={Boolean(errors.amountInCents)}
						/>
						{!capabilities.canAdjustAmount ? (
							<p className="text-muted-foreground text-xs">
								该账单已有收款，金额已冻结。
							</p>
						) : null}
						<FieldError match={Boolean(errors.amountInCents)}>
							{errors.amountInCents}
						</FieldError>
					</Field>
					<Field invalid={Boolean(errors.dueDate)}>
						<FieldLabel htmlFor="adjust-invoice-due">付款到期日</FieldLabel>
						<Input
							id="adjust-invoice-due"
							type="date"
							value={dueDate}
							disabled={!capabilities.canAdjustDueDate}
							onChange={(event) => {
								setDueDate(event.target.value);
								clearError("dueDate");
							}}
							aria-invalid={Boolean(errors.dueDate)}
							required={capabilities.canAdjustDueDate}
						/>
						<FieldError match={Boolean(errors.dueDate)}>
							{errors.dueDate}
						</FieldError>
					</Field>
					<Field className="sm:col-span-2" invalid={Boolean(errors.summary)}>
						<FieldLabel htmlFor="adjust-invoice-summary">摘要</FieldLabel>
						<Textarea
							id="adjust-invoice-summary"
							value={summary}
							disabled={!capabilities.canAdjustSummary}
							onChange={(event) => {
								setSummary(event.target.value);
								clearError("summary");
							}}
							maxLength={200}
							aria-invalid={Boolean(errors.summary)}
							required={capabilities.canAdjustSummary}
						/>
						<FieldError match={Boolean(errors.summary)}>
							{errors.summary}
						</FieldError>
					</Field>
					<Field className="sm:col-span-2" invalid={Boolean(errors.reason)}>
						<FieldLabel htmlFor="adjust-invoice-reason">调整原因</FieldLabel>
						<Textarea
							id="adjust-invoice-reason"
							value={reason}
							onChange={(event) => {
								setReason(event.target.value);
								clearError("reason");
							}}
							maxLength={500}
							aria-invalid={Boolean(errors.reason)}
							required
						/>
						<FieldError match={Boolean(errors.reason)}>
							{errors.reason}
						</FieldError>
					</Field>
					<DialogFooter className="flex-col sm:col-span-2 sm:flex-row">
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
							className="w-full sm:w-auto"
							disabled={mutation.isPending}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "确认调整"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
