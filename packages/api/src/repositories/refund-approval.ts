import {
	cancelRefundRequestRecord,
	createRefundRequestRecord,
	decideRefundRequestRecord,
	listInvoiceRefundRequestRecords,
	RefundApprovalError,
	type RefundRequestRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CancelRefundRequestInput,
	CancelRefundRequestResult,
	CreateRefundRequestInput,
	CreateRefundRequestResult,
	DecideRefundRequestInput,
	DecideRefundRequestResult,
	RefundRequestListInput,
	RefundRequestListResult,
} from "../contracts/training";

type FinanceScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<
		typeof listInvoiceRefundRequestRecords
	>[0]["campusAccess"];
};

function toDatabasePaymentMethod(
	method: CreateRefundRequestInput["method"],
): RefundRequestRecord["method"] {
	return method === "bankTransfer" ? "bank_transfer" : method;
}

function toPaymentMethod(
	method: RefundRequestRecord["method"],
): CreateRefundRequestInput["method"] {
	return method === "bank_transfer" ? "bankTransfer" : method;
}

function toRefundRequest(record: RefundRequestRecord) {
	return {
		...record,
		refundedAt: record.refundedAt.toISOString(),
		method: toPaymentMethod(record.method),
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
		events: record.events.map((event) => ({
			...event,
			createdAt: event.createdAt.toISOString(),
		})),
	};
}

function throwRefundApprovalError(error: unknown): never {
	if (!(error instanceof RefundApprovalError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理退款审批，请稍后重试。",
		});
	}

	switch (error.code) {
		case "INVOICE_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "账单不存在。" });
		case "REFUND_REQUEST_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "退款申请不存在。" });
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "你没有权限操作该校区的退款申请。",
			});
		case "SELF_APPROVAL_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "申请人不能审批自己的退款申请。",
			});
		case "CANCELLATION_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "你没有权限取消该退款申请。",
			});
		case "INVALID_INPUT":
			throw new ORPCError("BAD_REQUEST", {
				message: "请检查退款金额、时间、方式和原因。",
			});
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续处理退款申请。",
			});
		case "INVOICE_NOT_REFUNDABLE":
			throw new ORPCError("CONFLICT", {
				message: "仅已结清且未全额退款的账单可以申请退款。",
			});
		case "REFUND_EXCEEDS_PAID":
			throw new ORPCError("CONFLICT", {
				message: "申请金额超过账单当前可退款余额。",
			});
		case "PENDING_REQUEST_EXISTS":
			throw new ORPCError("CONFLICT", {
				message: "该账单已有待审批退款申请。",
			});
		case "REQUEST_NOT_PENDING":
			throw new ORPCError("CONFLICT", {
				message: "该退款申请已处理，请刷新后查看最新状态。",
			});
		case "REQUEST_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "退款申请已被其他人更新，请刷新后重试。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该请求标识已用于不同的退款审批操作。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已发生变化，请刷新后重试。",
			});
	}
}

export async function listRefundRequests(
	scope: FinanceScope,
	input: RefundRequestListInput,
): Promise<RefundRequestListResult> {
	try {
		const records = await listInvoiceRefundRequestRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			invoiceId: input.invoiceId,
		});
		if (!records) throw new RefundApprovalError("INVOICE_NOT_FOUND");
		return { items: records.map(toRefundRequest) };
	} catch (error) {
		return throwRefundApprovalError(error);
	}
}

export async function createRefundRequest(
	scope: FinanceScope,
	input: CreateRefundRequestInput,
): Promise<CreateRefundRequestResult> {
	try {
		const result = await createRefundRequestRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			invoiceId: input.invoiceId,
			amountInCents: input.amountInCents,
			refundedAt: new Date(input.refundedAt),
			method: toDatabasePaymentMethod(input.method),
			reason: input.reason,
			requestId: input.requestId,
		});
		return {
			request: toRefundRequest(result.request),
			replayed: result.replayed,
		};
	} catch (error) {
		return throwRefundApprovalError(error);
	}
}

export async function decideRefundRequest(
	scope: FinanceScope,
	input: DecideRefundRequestInput,
): Promise<DecideRefundRequestResult> {
	try {
		const result = await decideRefundRequestRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
		return {
			request: toRefundRequest(result.request),
			replayed: result.replayed,
		};
	} catch (error) {
		return throwRefundApprovalError(error);
	}
}

export async function cancelRefundRequest(
	scope: FinanceScope,
	input: CancelRefundRequestInput,
): Promise<CancelRefundRequestResult> {
	try {
		const result = await cancelRefundRequestRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
		return {
			request: toRefundRequest(result.request),
			replayed: result.replayed,
		};
	} catch (error) {
		return throwRefundApprovalError(error);
	}
}
