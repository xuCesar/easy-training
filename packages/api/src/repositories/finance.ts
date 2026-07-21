import {
	adjustInvoiceRecord,
	createManualInvoiceRecord,
	createPaymentRecord,
	FinanceError,
	getInvoiceDetailRecord,
	type InvoiceAdjustmentRecord,
	type InvoiceRecord,
	listInvoiceRecords,
	listManualInvoiceOptionRecords,
	listReceiptSummariesByPaymentIds,
	type PaymentRecord,
	type PaymentReversalRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";
import type {
	AdjustInvoiceInput,
	AdjustInvoiceResult,
	CreateManualInvoiceInput,
	CreateManualInvoiceResult,
	CreatePaymentInput,
	CreatePaymentResult,
	InvoiceDetail,
	InvoiceDetailInput,
	InvoiceListInput,
	InvoiceListResult,
	ManualInvoiceOptions,
	ManualInvoiceOptionsInput,
} from "../contracts/training";
import { getInvoiceRefunds } from "./enrollment-finance-adjustments";

type FinanceScope = {
	organizationId: string;
	userId: string;
	campusAccess?: Parameters<typeof listInvoiceRecords>[0]["campusAccess"];
};

const SHANGHAI_OFFSET_IN_MS = 8 * 60 * 60 * 1000;

export function getShanghaiDate(now = new Date()): string {
	return new Date(now.getTime() + SHANGHAI_OFFSET_IN_MS)
		.toISOString()
		.slice(0, 10);
}

function getCanonicalPaidAmount(record: InvoiceRecord): number {
	return record.status === "paid" || record.status === "refunded"
		? Math.max(record.paidAmountInCents, record.amountInCents)
		: record.paidAmountInCents;
}

function toInvoiceSummary(record: InvoiceRecord, today: string) {
	const paidAmountInCents = getCanonicalPaidAmount(record);
	const status: "pending" | "partial" | "paid" | "refunded" =
		record.status === "refunded"
			? "refunded"
			: paidAmountInCents >= record.amountInCents
				? "paid"
				: paidAmountInCents > 0
					? "partial"
					: "pending";

	return {
		id: record.id,
		enrollmentId: record.enrollmentId,
		studentId: record.studentId,
		studentName: record.studentName,
		courseName: record.courseName,
		source: record.source,
		businessActivityType: record.businessActivityType,
		summary: record.summary,
		amountInCents: record.amountInCents,
		paidAmountInCents,
		outstandingAmountInCents: Math.max(
			record.amountInCents - paidAmountInCents,
			0,
		),
		status,
		isOverdue:
			status !== "paid" &&
			status !== "refunded" &&
			(record.status === "overdue" || record.dueDate < today),
		dueDate: record.dueDate,
		issuedAt: record.issuedAt.toISOString(),
		createdByName: record.createdByName,
		version: record.version,
	};
}

function toInvoiceAdjustment(record: InvoiceAdjustmentRecord) {
	return {
		id: record.id,
		beforeVersion: record.beforeVersion,
		afterVersion: record.afterVersion,
		before: {
			amountInCents: record.beforeAmountInCents,
			dueDate: record.beforeDueDate,
			summary: record.beforeSummary,
		},
		after: {
			amountInCents: record.afterAmountInCents,
			dueDate: record.afterDueDate,
			summary: record.afterSummary,
		},
		reason: record.reason,
		operatorName: record.operatorName,
		createdAt: record.createdAt.toISOString(),
	};
}

function toPaymentMethod(
	method: PaymentRecord["method"],
): CreatePaymentInput["method"] {
	return method === "bank_transfer" ? "bankTransfer" : method;
}

function toDatabasePaymentMethod(
	method: CreatePaymentInput["method"],
): PaymentRecord["method"] {
	return method === "bankTransfer" ? "bank_transfer" : method;
}

function toPayment(
	record: PaymentRecord,
	reversals: PaymentReversalRecord[] = [],
	receipt?: {
		id: string;
		number: string;
		status: "active" | "voided";
		generatedAt: Date;
	},
) {
	const paymentReversals = reversals
		.filter((reversal) => reversal.paymentId === record.id)
		.map((reversal) => ({
			id: reversal.id,
			amountInCents: reversal.amountInCents,
			reason: reversal.reason,
			reversedAt: reversal.reversedAt.toISOString(),
			operatorName: reversal.operatorName,
			createdAt: reversal.createdAt.toISOString(),
		}));
	const reversedAmountInCents = paymentReversals.reduce(
		(total, reversal) => total + reversal.amountInCents,
		0,
	);
	return {
		id: record.id,
		amountInCents: record.amountInCents,
		reversedAmountInCents,
		effectiveAmountInCents: Math.max(
			record.amountInCents - reversedAmountInCents,
			0,
		),
		receivedAt: record.receivedAt.toISOString(),
		method: toPaymentMethod(record.method),
		referenceNo: record.referenceNo,
		note: record.note,
		operatorName: record.operatorName,
		createdAt: record.createdAt.toISOString(),
		reversals: paymentReversals,
		receipt: receipt
			? { ...receipt, generatedAt: receipt.generatedAt.toISOString() }
			: null,
	};
}

function throwFinanceError(error: unknown): never {
	if (!(error instanceof FinanceError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理财务请求，请稍后重试。",
		});
	}

	switch (error.code) {
		case "INVOICE_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "账单不存在。" });
		case "INVOICE_NOT_PAYABLE":
			throw new ORPCError("CONFLICT", { message: "该账单当前不可收款。" });
		case "INVALID_PAYMENT_AMOUNT":
			throw new ORPCError("BAD_REQUEST", { message: "收款金额必须大于 0。" });
		case "INVALID_PAYMENT_TIME":
			throw new ORPCError("BAD_REQUEST", {
				message: "收款时间不能晚于当前时间 5 分钟以上。",
			});
		case "PAYMENT_EXCEEDS_OUTSTANDING":
			throw new ORPCError("CONFLICT", {
				message: "收款金额超过账单待收金额。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该请求标识已用于不同的收款内容。",
			});
		case "RESOURCE_UNAVAILABLE":
			throw new ORPCError("CONFLICT", {
				message: "关联资源已发生变化，请刷新后重试。",
			});
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续收款。",
			});
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "你没有权限操作该校区的财务数据。",
			});
		case "STUDENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "学员不存在。" });
		case "ENROLLMENT_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "报名不存在。" });
		case "ENROLLMENT_STUDENT_MISMATCH":
			throw new ORPCError("BAD_REQUEST", {
				message: "所选报名不属于该学员。",
			});
		case "ENROLLMENT_NOT_LINKABLE":
			throw new ORPCError("CONFLICT", {
				message: "该报名当前不能关联新账单。",
			});
		case "INVALID_INVOICE_INPUT":
			throw new ORPCError("BAD_REQUEST", {
				message: "请检查账单金额、日期和文字内容。",
			});
		case "INVOICE_NOT_ADJUSTABLE":
			throw new ORPCError("CONFLICT", {
				message: "已结清或已退款账单不能再调整。",
			});
		case "INVOICE_AMOUNT_LOCKED":
			throw new ORPCError("CONFLICT", {
				message: "该账单已有收款，金额不能直接调整。",
			});
		case "INVOICE_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "账单已被其他人更新，请加载最新内容后重试。",
			});
		case "NO_ADJUSTMENT_CHANGES":
			throw new ORPCError("BAD_REQUEST", {
				message: "账单内容没有发生变化。",
			});
		case "INVALID_CURSOR":
			throw new ORPCError("BAD_REQUEST", {
				message: "分页位置无效，请重新加载学员列表。",
			});
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "暂时无法处理财务请求，请稍后重试。",
	});
}

export async function listInvoices(
	scope: FinanceScope,
	input: InvoiceListInput,
): Promise<InvoiceListResult> {
	try {
		const result = await listInvoiceRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess ?? { kind: "all" },
			query: input.query,
			status: input.status,
		});
		const today = getShanghaiDate();
		return {
			total: result.total,
			items: result.items.map((item) => toInvoiceSummary(item, today)),
		};
	} catch (error) {
		return throwFinanceError(error);
	}
}

export async function getInvoiceDetail(
	scope: FinanceScope,
	input: InvoiceDetailInput,
): Promise<InvoiceDetail> {
	try {
		const result = await getInvoiceDetailRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess ?? { kind: "all" },
			id: input.id,
		});
		if (!result) {
			throw new FinanceError("INVOICE_NOT_FOUND");
		}

		const invoiceSummary = toInvoiceSummary(result.invoice, getShanghaiDate());
		const receiptSummaries = await listReceiptSummariesByPaymentIds({
			organizationId: scope.organizationId,
			paymentIds: result.payments.map((item) => item.id),
		});
		const payments = result.payments.map((paymentRecord) =>
			toPayment(
				paymentRecord,
				result.paymentReversals,
				receiptSummaries.get(paymentRecord.id),
			),
		);
		return {
			invoice: invoiceSummary,
			payments,
			refunds: await getInvoiceRefunds(scope, input.id),
			adjustments: result.adjustments.map(toInvoiceAdjustment),
			capabilities: {
				canAdjustAmount:
					invoiceSummary.status === "pending" &&
					invoiceSummary.paidAmountInCents === 0,
				canAdjustDueDate:
					invoiceSummary.status !== "paid" &&
					invoiceSummary.status !== "refunded",
				canAdjustSummary:
					invoiceSummary.status !== "paid" &&
					invoiceSummary.status !== "refunded",
			},
			historicalPaidAmountInCents: Math.max(
				invoiceSummary.paidAmountInCents -
					payments.reduce(
						(total, paymentRecord) =>
							total + paymentRecord.effectiveAmountInCents,
						0,
					),
				0,
			),
		};
	} catch (error) {
		return throwFinanceError(error);
	}
}

export async function getManualInvoiceOptions(
	scope: FinanceScope,
	input: ManualInvoiceOptionsInput,
): Promise<ManualInvoiceOptions> {
	try {
		const result = await listManualInvoiceOptionRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess ?? { kind: "all" },
			query: input.query,
			cursor: input.cursor,
			pageSize: input.pageSize,
		});
		return {
			students: result.items,
			nextCursor: result.nextCursor,
		};
	} catch (error) {
		return throwFinanceError(error);
	}
}

export async function createManualInvoice(
	scope: FinanceScope,
	input: CreateManualInvoiceInput,
): Promise<CreateManualInvoiceResult> {
	try {
		return await createManualInvoiceRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwFinanceError(error);
	}
}

export async function adjustInvoice(
	scope: FinanceScope,
	input: AdjustInvoiceInput,
): Promise<AdjustInvoiceResult> {
	try {
		const result = await adjustInvoiceRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			...input,
		});
		return {
			adjustment: {
				id: result.adjustment.id,
				invoiceId: result.adjustment.invoiceId,
				beforeVersion: result.adjustment.beforeVersion,
				afterVersion: result.adjustment.afterVersion,
				createdAt: result.adjustment.createdAt.toISOString(),
			},
			replayed: result.replayed,
		};
	} catch (error) {
		return throwFinanceError(error);
	}
}

export async function createPayment(
	scope: FinanceScope,
	input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
	try {
		const result = await createPaymentRecord({
			organizationId: scope.organizationId,
			operatorUserId: scope.userId,
			invoiceId: input.invoiceId,
			amountInCents: input.amountInCents,
			receivedAt: new Date(input.receivedAt),
			method: toDatabasePaymentMethod(input.method),
			referenceNo: input.referenceNo,
			note: input.note,
			requestId: input.requestId,
		});

		return {
			payment: toPayment(result.payment),
		};
	} catch (error) {
		return throwFinanceError(error);
	}
}
