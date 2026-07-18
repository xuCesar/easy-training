import {
	createInvoiceFollowUpRecord,
	createRefundRecord,
	EnrollmentFinanceAdjustmentError,
	listArrearsRecords,
	listEnrollmentAdjustmentCourseRecords,
	listEnrollmentAdjustmentRecords,
	listRefundRecords,
	renewEnrollmentRecord,
	transferEnrollmentRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	ArrearsListResult,
	CreateInvoiceFollowUpInput,
	CreateInvoiceFollowUpResult,
	CreateRefundInput,
	CreateRefundResult,
	EnrollmentAdjustmentListResult,
	RenewEnrollmentInput,
	RenewEnrollmentResult,
	TransferEnrollmentInput,
	TransferEnrollmentResult,
} from "../contracts/training";

const SHANGHAI_OFFSET_IN_MS = 8 * 60 * 60 * 1000;

function getShanghaiDate(now = new Date()): string {
	return new Date(now.getTime() + SHANGHAI_OFFSET_IN_MS)
		.toISOString()
		.slice(0, 10);
}

type FinanceScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<
		typeof listEnrollmentAdjustmentRecords
	>[0]["campusAccess"];
};

function toDatabasePaymentMethod(
	method: CreateRefundInput["method"],
): "cash" | "wechat" | "alipay" | "bank_transfer" | "pos" | "other" {
	return method === "bankTransfer" ? "bank_transfer" : method;
}

function toPaymentMethod(
	method: "cash" | "wechat" | "alipay" | "bank_transfer" | "pos" | "other",
): CreateRefundInput["method"] {
	return method === "bank_transfer" ? "bankTransfer" : method;
}

function throwAdjustmentError(error: unknown): never {
	if (!(error instanceof EnrollmentFinanceAdjustmentError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理报名财务变更，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权操作该资源。" });
		case "ENROLLMENT_NOT_FOUND":
		case "INVOICE_NOT_FOUND":
		case "COURSE_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标资源不存在。" });
		case "INVALID_INPUT":
			throw new ORPCError("BAD_REQUEST", { message: "请检查提交的信息。" });
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续操作。",
			});
		case "COURSE_INACTIVE":
			throw new ORPCError("CONFLICT", { message: "目标课程已停用。" });
		case "ENROLLMENT_NOT_ACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "该报名已不处于可变更状态。",
			});
		case "TRANSFER_SAME_COURSE":
			throw new ORPCError("CONFLICT", {
				message: "目标课程不能与来源课程相同。",
			});
		case "TRANSFER_NO_REMAINING_LESSONS":
			throw new ORPCError("CONFLICT", {
				message: "来源报名没有可转移的剩余课时。",
			});
		case "TRANSFER_OUTSTANDING_INVOICE":
			throw new ORPCError("CONFLICT", {
				message: "来源报名存在未结清账单，不能转课。",
			});
		case "INVOICE_NOT_REFUNDABLE":
			throw new ORPCError("CONFLICT", { message: "仅已结清账单可以退费。" });
		case "REFUND_EXCEEDS_PAID":
			throw new ORPCError("CONFLICT", {
				message: "累计退款不能超过账单已收金额。",
			});
		case "FOLLOW_UP_NOT_ALLOWED":
			throw new ORPCError("CONFLICT", { message: "当前账单无需欠费跟进。" });
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该请求标识已用于不同的业务操作。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已变化，请刷新后重试。",
			});
	}
}

export async function listEnrollmentAdjustments(
	scope: FinanceScope,
): Promise<EnrollmentAdjustmentListResult> {
	try {
		return {
			items: await listEnrollmentAdjustmentRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
			}),
			courses: await listEnrollmentAdjustmentCourseRecords({
				organizationId: scope.organizationId,
			}),
		};
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function renewEnrollment(
	scope: FinanceScope,
	input: RenewEnrollmentInput,
): Promise<RenewEnrollmentResult> {
	try {
		return await renewEnrollmentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function transferEnrollment(
	scope: FinanceScope,
	input: TransferEnrollmentInput,
): Promise<TransferEnrollmentResult> {
	try {
		return await transferEnrollmentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function createRefund(
	scope: FinanceScope,
	input: CreateRefundInput,
): Promise<CreateRefundResult> {
	try {
		const result = await createRefundRecord({
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
			refund: {
				...result.refund,
				refundedAt: result.refund.refundedAt.toISOString(),
				method: toPaymentMethod(result.refund.method),
				createdAt: result.refund.createdAt.toISOString(),
			},
		};
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function listArrears(
	scope: FinanceScope,
): Promise<ArrearsListResult> {
	try {
		const records = await listArrearsRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			today: getShanghaiDate(),
		});
		return {
			items: records.map((record) => ({
				...record,
				lastFollowUpAt: record.lastFollowUpAt?.toISOString() ?? null,
			})),
		};
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function createInvoiceFollowUp(
	scope: FinanceScope,
	input: CreateInvoiceFollowUpInput,
): Promise<CreateInvoiceFollowUpResult> {
	try {
		const result = await createInvoiceFollowUpRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			invoiceId: input.invoiceId,
			note: input.note,
			followedUpAt: new Date(input.followedUpAt),
			requestId: input.requestId,
		});
		return { ...result, followedUpAt: result.followedUpAt.toISOString() };
	} catch (error) {
		return throwAdjustmentError(error);
	}
}

export async function getInvoiceRefunds(
	scope: Pick<FinanceScope, "organizationId">,
	invoiceId: string,
) {
	try {
		const refunds = await listRefundRecords({
			organizationId: scope.organizationId,
			invoiceId,
		});
		return refunds.map((record) => ({
			id: record.id,
			amountInCents: record.amountInCents,
			refundedAt: record.refundedAt.toISOString(),
			method: toPaymentMethod(record.method),
			reason: record.reason,
			operatorName: record.operatorName,
			createdAt: record.createdAt.toISOString(),
		}));
	} catch (error) {
		return throwAdjustmentError(error);
	}
}
