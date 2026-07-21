import {
	createPaymentReversalRecord,
	PaymentReversalError,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";
import type {
	CreatePaymentReversalInput,
	CreatePaymentReversalResult,
} from "../contracts/training";

type PaymentReversalScope = {
	organizationId: string;
	userId: string;
};

function throwPaymentReversalError(error: unknown): never {
	if (!(error instanceof PaymentReversalError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理收款冲正，请稍后重试。",
		});
	}

	switch (error.code) {
		case "PAYMENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "原收款不存在。" });
		case "INVALID_REVERSAL_AMOUNT":
			throw new ORPCError("BAD_REQUEST", {
				message: "冲正金额必须大于 0。",
			});
		case "INVALID_REVERSAL_TIME":
			throw new ORPCError("BAD_REQUEST", {
				message: "冲正时间不能晚于当前时间 5 分钟以上。",
			});
		case "INVALID_REVERSAL_REASON":
			throw new ORPCError("BAD_REQUEST", { message: "请填写冲正原因。" });
		case "REVERSAL_EXCEEDS_AVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "冲正金额超过该收款当前有效金额。",
			});
		case "PAYMENT_ALREADY_REVERSED":
			throw new ORPCError("CONFLICT", { message: "该收款已全部冲正。" });
		case "INVOICE_HAS_REFUND":
			throw new ORPCError("CONFLICT", {
				message: "该账单已发生退款，不能再冲正收款。",
			});
		case "REVERSAL_STALE_STATE":
			throw new ORPCError("CONFLICT", {
				message: "账单资金状态已变化，请刷新后重试。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该请求标识已用于不同的冲正内容。",
			});
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能执行收款冲正。",
			});
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "你没有权限操作该校区的财务数据。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已发生变化，请刷新后重试。",
			});
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "暂时无法处理收款冲正，请稍后重试。",
	});
}

export async function createPaymentReversal(
	scope: PaymentReversalScope,
	input: CreatePaymentReversalInput,
): Promise<CreatePaymentReversalResult> {
	try {
		const result = await createPaymentReversalRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			paymentId: input.paymentId,
			amountInCents: input.amountInCents,
			reason: input.reason,
			reversedAt: new Date(input.reversedAt),
			requestId: input.requestId,
		});
		const status =
			result.invoice.status === "paid"
				? "paid"
				: result.invoice.status === "partial"
					? "partial"
					: "pending";
		return {
			reversal: {
				id: result.reversal.id,
				invoiceId: result.reversal.invoiceId,
				paymentId: result.reversal.paymentId,
				amountInCents: result.reversal.amountInCents,
				reason: result.reversal.reason,
				reversedAt: result.reversal.reversedAt.toISOString(),
				operatorName: result.reversal.operatorName,
				createdAt: result.reversal.createdAt.toISOString(),
			},
			payment: result.payment,
			invoice: {
				id: result.invoice.id,
				paidAmountInCents: result.invoice.paidAmountInCents,
				status,
				paidAt: result.invoice.paidAt?.toISOString() ?? null,
			},
			replayed: result.replayed,
		};
	} catch (error) {
		return throwPaymentReversalError(error);
	}
}
