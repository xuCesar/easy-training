import {
	createPaymentRecord,
	FinanceError,
	getInvoiceDetailRecord,
	type InvoiceRecord,
	listInvoiceRecords,
	type PaymentRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CreatePaymentInput,
	CreatePaymentResult,
	InvoiceDetail,
	InvoiceDetailInput,
	InvoiceListInput,
	InvoiceListResult,
} from "../contracts/training";

type FinanceScope = {
	organizationId: string;
	userId: string;
};

const SHANGHAI_OFFSET_IN_MS = 8 * 60 * 60 * 1000;

export function getShanghaiDate(now = new Date()): string {
	return new Date(now.getTime() + SHANGHAI_OFFSET_IN_MS)
		.toISOString()
		.slice(0, 10);
}

function getCanonicalPaidAmount(record: InvoiceRecord): number {
	return record.status === "paid"
		? Math.max(record.paidAmountInCents, record.amountInCents)
		: record.paidAmountInCents;
}

function toInvoiceSummary(record: InvoiceRecord, today: string) {
	if (record.status === "refunded") {
		throw new Error("Excluded invoice status reached the API mapper.");
	}
	const paidAmountInCents = getCanonicalPaidAmount(record);
	const status: "pending" | "partial" | "paid" =
		paidAmountInCents >= record.amountInCents
			? "paid"
			: paidAmountInCents > 0
				? "partial"
				: "pending";

	return {
		id: record.id,
		studentId: record.studentId,
		studentName: record.studentName,
		courseName: record.courseName,
		amountInCents: record.amountInCents,
		paidAmountInCents,
		outstandingAmountInCents: Math.max(
			record.amountInCents - paidAmountInCents,
			0,
		),
		status,
		isOverdue:
			status !== "paid" &&
			(record.status === "overdue" || record.dueDate < today),
		dueDate: record.dueDate,
		issuedAt: record.issuedAt.toISOString(),
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

function toPayment(record: PaymentRecord) {
	return {
		id: record.id,
		amountInCents: record.amountInCents,
		receivedAt: record.receivedAt.toISOString(),
		method: toPaymentMethod(record.method),
		referenceNo: record.referenceNo,
		note: record.note,
		operatorName: record.operatorName,
		createdAt: record.createdAt.toISOString(),
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
	}
}

export async function listInvoices(
	scope: FinanceScope,
	input: InvoiceListInput,
): Promise<InvoiceListResult> {
	try {
		const result = await listInvoiceRecords({
			organizationId: scope.organizationId,
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
			id: input.id,
		});
		if (!result) {
			throw new FinanceError("INVOICE_NOT_FOUND");
		}

		const invoiceSummary = toInvoiceSummary(result.invoice, getShanghaiDate());
		return {
			invoice: invoiceSummary,
			payments: result.payments.map(toPayment),
			historicalPaidAmountInCents: Math.max(
				invoiceSummary.paidAmountInCents -
					result.payments.reduce(
						(total, paymentRecord) => total + paymentRecord.amountInCents,
						0,
					),
				0,
			),
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
