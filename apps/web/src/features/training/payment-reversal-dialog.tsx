import {
	type CreatePaymentReversalInput,
	createPaymentReversalInputSchema,
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
import {
	formatCentsAsYuan,
	getShanghaiCurrentDateTime,
	parseYuanToCents,
	shanghaiDateTimeToIso,
} from "./finance-form-utils";
import { invalidateFinanceQueries } from "./finance-query-utils";
import { formatCentsToCurrency } from "./format";

type PaymentRecord = InvoiceDetail["payments"][number];
type ReversalField = "amountInCents" | "reason" | "reversedAt";

export function PaymentReversalDialog({
	payment,
	onClose,
	onReversed,
	onPendingChange,
}: {
	payment: PaymentRecord;
	onClose: () => void;
	onReversed: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [amountInYuan, setAmountInYuan] = useState(() =>
		formatCentsAsYuan(payment.effectiveAmountInCents),
	);
	const [reason, setReason] = useState("");
	const [reversedAt, setReversedAt] = useState(getShanghaiCurrentDateTime);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<Partial<Record<ReversalField, string>>>(
		{},
	);
	const mutation = useMutation(
		orpc.training.finance.paymentReversals.create.mutationOptions({
			onSuccess: async () => {
				toast.success("收款冲正成功");
				try {
					await invalidateFinanceQueries();
				} finally {
					onPendingChange(false);
					onReversed();
				}
			},
			onError: (error) => {
				onPendingChange(false);
				toast.error(`收款冲正失败：${error.message}`);
			},
		}),
	);

	function clearError(field: ReversalField) {
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
		const reversedAtIso = shanghaiDateTimeToIso(reversedAt);
		const candidate: CreatePaymentReversalInput = {
			paymentId: payment.id,
			amountInCents: amountInCents ?? 0,
			reason,
			reversedAt: reversedAtIso ?? "",
			requestId,
		};
		const result = createPaymentReversalInputSchema.safeParse(candidate);
		if (
			!result.success ||
			amountInCents === null ||
			amountInCents > payment.effectiveAmountInCents ||
			!reversedAtIso
		) {
			const next: Partial<Record<ReversalField, string>> = {};
			for (const issue of result.success ? [] : result.error.issues) {
				const field = issue.path[0];
				if (
					field === "amountInCents" ||
					field === "reason" ||
					field === "reversedAt"
				)
					next[field] ??= issue.message;
			}
			if (amountInCents === null) next.amountInCents = "请输入有效金额";
			else if (amountInCents > payment.effectiveAmountInCents)
				next.amountInCents = "冲正金额不能超过当前有效金额";
			if (!reversedAtIso) next.reversedAt = "请选择有效的冲正时间";
			setErrors(next);
			toast.error("请检查冲正信息");
			return;
		}

		setErrors({});
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
					<DialogTitle>冲正收款</DialogTitle>
					<DialogDescription>
						原收款与冲正流水都会永久保留，当前最多可冲正{" "}
						{formatCentsToCurrency(payment.effectiveAmountInCents)}。
					</DialogDescription>
				</DialogHeader>
				<div className="border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
					<p className="font-medium">冲正不等于退款</p>
					<p className="mt-1 text-muted-foreground text-xs">
						该操作只纠正系统内的错误收款录入，不会向家长付款；实际退钱请走退款审批。
					</p>
				</div>
				<form className="grid gap-4" onSubmit={submit} noValidate>
					<Field invalid={Boolean(errors.amountInCents)}>
						<FieldLabel htmlFor="payment-reversal-amount">
							冲正金额（元）
						</FieldLabel>
						<Input
							id="payment-reversal-amount"
							inputMode="decimal"
							value={amountInYuan}
							onChange={(event) => {
								setAmountInYuan(event.target.value);
								clearError("amountInCents");
							}}
							aria-invalid={Boolean(errors.amountInCents)}
							required
						/>
						<FieldError match={Boolean(errors.amountInCents)}>
							{errors.amountInCents}
						</FieldError>
					</Field>
					<Field invalid={Boolean(errors.reversedAt)}>
						<FieldLabel htmlFor="payment-reversal-time">冲正时间</FieldLabel>
						<Input
							id="payment-reversal-time"
							type="datetime-local"
							value={reversedAt}
							onChange={(event) => {
								setReversedAt(event.target.value);
								clearError("reversedAt");
							}}
							aria-invalid={Boolean(errors.reversedAt)}
							required
						/>
						<FieldError match={Boolean(errors.reversedAt)}>
							{errors.reversedAt}
						</FieldError>
					</Field>
					<Field invalid={Boolean(errors.reason)}>
						<FieldLabel htmlFor="payment-reversal-reason">冲正原因</FieldLabel>
						<Textarea
							id="payment-reversal-reason"
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
							className="w-full sm:w-auto"
							disabled={mutation.isPending}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "确认冲正"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
