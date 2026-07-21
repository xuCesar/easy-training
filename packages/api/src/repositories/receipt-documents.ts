import {
	generateReceiptDocumentRecord,
	getReceiptDocumentRecord,
	getReceiptSummaryByPaymentId,
	ReceiptDocumentError,
	reissueReceiptDocumentRecord,
	voidReceiptDocumentRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	GenerateReceiptDocumentInput,
	GetReceiptByPaymentInput,
	GetReceiptByPaymentResult,
	GetReceiptDocumentInput,
	ReceiptDocumentMutationResult,
	ReceiptDocumentView,
	ReissueReceiptDocumentInput,
	VoidReceiptDocumentInput,
} from "../contracts/training";

type FinanceScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof getReceiptDocumentRecord>[0]["campusAccess"];
};

function throwReceiptError(error: unknown): never {
	if (!(error instanceof ReceiptDocumentError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理收款凭证，请稍后重试。",
		});
	}
	switch (error.code) {
		case "INVALID_INPUT":
			throw new ORPCError("BAD_REQUEST", { message: "请检查凭证信息。" });
		case "PAYMENT_NOT_FOUND":
		case "RECEIPT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "收款或凭证不存在。" });
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权操作该凭证。" });
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能开具凭证。",
			});
		case "RECEIPT_ALREADY_EXISTS":
			throw new ORPCError("CONFLICT", {
				message: error.existingReceiptId
					? `该收款已有有效凭证：${error.existingReceiptId}`
					: "该收款已有有效凭证。",
			});
		case "RECEIPT_NOT_ACTIVE":
			throw new ORPCError("CONFLICT", { message: "该凭证已作废。" });
		case "RECEIPT_NOT_VOIDED":
			throw new ORPCError("CONFLICT", { message: "只有已作废凭证可以补开。" });
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该请求标识已用于不同的凭证操作。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "凭证资源已变化，请刷新后重试。",
			});
	}
}

function toPaymentMethod(
	method: "cash" | "wechat" | "alipay" | "bank_transfer" | "pos" | "other",
) {
	return method === "bank_transfer" ? ("bankTransfer" as const) : method;
}

export async function getReceiptDocument(
	scope: FinanceScope,
	input: GetReceiptDocumentInput,
): Promise<ReceiptDocumentView> {
	const record = await getReceiptDocumentRecord({
		organizationId: scope.organizationId,
		campusAccess: scope.campusAccess,
		receiptId: input.receiptId,
	});
	if (!record) throw new ORPCError("NOT_FOUND", { message: "凭证不存在。" });
	return {
		document: {
			...record.document,
			generatedAt: record.document.generatedAt.toISOString(),
			voidedAt: record.document.voidedAt?.toISOString() ?? null,
		},
		payments: record.payments.map((item) => ({
			...item,
			receivedAt: item.receivedAt.toISOString(),
			method: toPaymentMethod(item.method),
		})),
		currentFinancialStatus: {
			...record.currentFinancialStatus,
			queriedAt: record.currentFinancialStatus.queriedAt.toISOString(),
		},
	};
}

export async function getReceiptByPayment(
	scope: FinanceScope,
	input: GetReceiptByPaymentInput,
): Promise<GetReceiptByPaymentResult> {
	const receipt = await getReceiptSummaryByPaymentId({
		organizationId: scope.organizationId,
		campusAccess: scope.campusAccess,
		paymentId: input.paymentId,
	});
	if (receipt === undefined)
		throw new ORPCError("NOT_FOUND", { message: "收款不存在。" });
	return {
		receipt: receipt
			? { ...receipt, generatedAt: receipt.generatedAt.toISOString() }
			: null,
	};
}

export async function generateReceiptDocument(
	scope: FinanceScope,
	input: GenerateReceiptDocumentInput,
): Promise<ReceiptDocumentMutationResult> {
	try {
		return await generateReceiptDocumentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwReceiptError(error);
	}
}

export async function voidReceiptDocument(
	scope: FinanceScope,
	input: VoidReceiptDocumentInput,
): Promise<ReceiptDocumentMutationResult> {
	try {
		return await voidReceiptDocumentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwReceiptError(error);
	}
}

export async function reissueReceiptDocument(
	scope: FinanceScope,
	input: ReissueReceiptDocumentInput,
): Promise<ReceiptDocumentMutationResult> {
	try {
		return await reissueReceiptDocumentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwReceiptError(error);
	}
}
