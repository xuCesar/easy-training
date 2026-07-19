import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	ne,
	or,
	sql,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	course,
	enrollment,
	invoice,
	payment,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";

export type FinanceErrorCode =
	| "INVOICE_NOT_FOUND"
	| "INVOICE_NOT_PAYABLE"
	| "INVALID_PAYMENT_AMOUNT"
	| "INVALID_PAYMENT_TIME"
	| "PAYMENT_EXCEEDS_OUTSTANDING"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE"
	| "CAMPUS_INACTIVE";

export class FinanceError extends Error {
	constructor(public readonly code: FinanceErrorCode) {
		super(code);
		this.name = "FinanceError";
	}
}

export type InvoiceRecord = {
	id: string;
	studentId: string;
	studentName: string;
	courseName: string | null;
	amountInCents: number;
	paidAmountInCents: number;
	status: (typeof invoice.$inferSelect)["status"];
	dueDate: string;
	issuedAt: Date;
};

export type PaymentRecord = {
	id: string;
	invoiceId: string;
	amountInCents: number;
	receivedAt: Date;
	method: (typeof payment.$inferSelect)["method"];
	referenceNo: string | null;
	note: string | null;
	operatorUserId: string;
	operatorName: string;
	requestId: string;
	createdAt: Date;
};

export type CreatePaymentRecordInput = {
	organizationId: string;
	operatorUserId: string;
	campusAccess: CampusAccess;
	invoiceId: string;
	amountInCents: number;
	receivedAt: Date;
	method: (typeof payment.$inferInsert)["method"];
	referenceNo: string | null;
	note: string | null;
	requestId: string;
};

function campusAccessCondition(campusAccess: CampusAccess) {
	if (campusAccess.kind === "none") return sql`false`;
	if (campusAccess.kind === "selected") {
		return inArray(student.campusId, campusAccess.campusIds);
	}
	return sql`true`;
}

const invoiceRecordSelection = {
	id: invoice.id,
	studentId: invoice.studentId,
	studentName: student.name,
	courseName: course.name,
	amountInCents: invoice.amountInCents,
	paidAmountInCents: invoice.paidAmountInCents,
	status: invoice.status,
	dueDate: invoice.dueDate,
	issuedAt: invoice.issuedAt,
};

const paymentRecordSelection = {
	id: payment.id,
	invoiceId: payment.invoiceId,
	amountInCents: payment.amountInCents,
	receivedAt: payment.receivedAt,
	method: payment.method,
	referenceNo: payment.referenceNo,
	note: payment.note,
	operatorUserId: payment.operatorUserId,
	operatorName: payment.operatorName,
	requestId: payment.requestId,
	createdAt: payment.createdAt,
};

export async function listInvoiceRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	query?: string;
	status: "all" | "open" | "pending" | "partial" | "paid";
}): Promise<{ items: InvoiceRecord[]; total: number }> {
	const filters = [
		eq(invoice.organizationId, input.organizationId),
		ne(invoice.status, "refunded"),
		campusAccessCondition(input.campusAccess),
	];

	switch (input.status) {
		case "open":
			filters.push(ne(invoice.status, "paid"));
			filters.push(
				sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
			);
			break;
		case "pending":
			filters.push(ne(invoice.status, "paid"));
			filters.push(sql`${invoice.paidAmountInCents} <= 0`);
			filters.push(
				sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
			);
			break;
		case "partial":
			filters.push(ne(invoice.status, "paid"));
			filters.push(sql`${invoice.paidAmountInCents} > 0`);
			filters.push(
				sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
			);
			break;
		case "paid":
			filters.push(
				sql`${invoice.status} = 'paid' or ${invoice.paidAmountInCents} >= ${invoice.amountInCents}`,
			);
			break;
		case "all":
			break;
	}

	if (input.query) {
		const pattern = `%${input.query}%`;
		const search = or(
			ilike(student.name, pattern),
			ilike(course.name, pattern),
		);
		if (search) {
			filters.push(search);
		}
	}

	const where = and(...filters);
	const [items, totalRows] = await Promise.all([
		db
			.select(invoiceRecordSelection)
			.from(invoice)
			.innerJoin(
				student,
				and(
					eq(student.id, invoice.studentId),
					eq(student.organizationId, invoice.organizationId),
				),
			)
			.leftJoin(
				enrollment,
				and(
					eq(enrollment.id, invoice.enrollmentId),
					eq(enrollment.organizationId, invoice.organizationId),
				),
			)
			.leftJoin(
				course,
				and(
					eq(course.id, enrollment.courseId),
					eq(course.organizationId, invoice.organizationId),
				),
			)
			.where(where)
			.orderBy(asc(invoice.dueDate), desc(invoice.issuedAt), asc(invoice.id)),
		db
			.select({ value: count() })
			.from(invoice)
			.innerJoin(
				student,
				and(
					eq(student.id, invoice.studentId),
					eq(student.organizationId, invoice.organizationId),
				),
			)
			.leftJoin(
				enrollment,
				and(
					eq(enrollment.id, invoice.enrollmentId),
					eq(enrollment.organizationId, invoice.organizationId),
				),
			)
			.leftJoin(
				course,
				and(
					eq(course.id, enrollment.courseId),
					eq(course.organizationId, invoice.organizationId),
				),
			)
			.where(where),
	]);

	return { items, total: totalRows[0]?.value ?? 0 };
}

export async function getInvoiceDetailRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	id: string;
}): Promise<{ invoice: InvoiceRecord; payments: PaymentRecord[] } | null> {
	const [invoiceRecord] = await db
		.select(invoiceRecordSelection)
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.leftJoin(
			enrollment,
			and(
				eq(enrollment.id, invoice.enrollmentId),
				eq(enrollment.organizationId, invoice.organizationId),
			),
		)
		.leftJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.id, input.id),
				eq(invoice.organizationId, input.organizationId),
				ne(invoice.status, "refunded"),
				campusAccessCondition(input.campusAccess),
			),
		)
		.limit(1);

	if (!invoiceRecord) {
		return null;
	}

	const payments = await db
		.select(paymentRecordSelection)
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, input.organizationId),
				eq(payment.invoiceId, input.id),
			),
		)
		.orderBy(
			desc(payment.receivedAt),
			desc(payment.createdAt),
			desc(payment.id),
		);

	return { invoice: invoiceRecord, payments };
}

function paymentPayloadMatches(
	record: Pick<
		PaymentRecord,
		| "invoiceId"
		| "amountInCents"
		| "receivedAt"
		| "method"
		| "referenceNo"
		| "note"
	>,
	input: CreatePaymentRecordInput,
): boolean {
	return (
		record.invoiceId === input.invoiceId &&
		record.amountInCents === input.amountInCents &&
		record.receivedAt.getTime() === input.receivedAt.getTime() &&
		record.method === input.method &&
		record.referenceNo === input.referenceNo &&
		record.note === input.note
	);
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}
	if ("code" in error) {
		return error;
	}
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

async function findPaymentByRequest(input: {
	organizationId: string;
	requestId: string;
}): Promise<PaymentRecord | null> {
	const [record] = await db
		.select(paymentRecordSelection)
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, input.organizationId),
				eq(payment.requestId, input.requestId),
			),
		)
		.limit(1);
	return record ?? null;
}

async function getPaymentRecord(input: {
	organizationId: string;
	paymentId: string;
}): Promise<PaymentRecord> {
	const [paymentRecord] = await db
		.select(paymentRecordSelection)
		.from(payment)
		.where(
			and(
				eq(payment.id, input.paymentId),
				eq(payment.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!paymentRecord) {
		throw new Error("Payment result could not be loaded.");
	}

	return paymentRecord;
}

export async function createPaymentRecord(
	input: CreatePaymentRecordInput,
): Promise<{ payment: PaymentRecord }> {
	if (!Number.isSafeInteger(input.amountInCents) || input.amountInCents <= 0) {
		throw new FinanceError("INVALID_PAYMENT_AMOUNT");
	}
	if (
		Number.isNaN(input.receivedAt.getTime()) ||
		input.receivedAt.getTime() > Date.now() + 5 * 60 * 1000
	) {
		throw new FinanceError("INVALID_PAYMENT_TIME");
	}

	try {
		const paymentId = await db.transaction(async (tx) => {
			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					enrollmentId: invoice.enrollmentId,
					studentId: invoice.studentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
				})
				.from(invoice)
				.where(
					and(
						eq(invoice.id, input.invoiceId),
						eq(invoice.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");

			if (!invoiceRecord) {
				throw new FinanceError("INVOICE_NOT_FOUND");
			}
			const [studentRecord] = await tx
				.select({ campusId: student.campusId })
				.from(student)
				.where(
					and(
						eq(student.id, invoiceRecord.studentId),
						eq(student.organizationId, input.organizationId),
						campusAccessCondition(input.campusAccess),
					),
				)
				.limit(1)
				.for("key share");
			if (!studentRecord) throw new FinanceError("INVOICE_NOT_FOUND");
			const [campusRecord] = await tx
				.select({ id: campus.id })
				.from(campus)
				.where(
					and(
						eq(campus.id, studentRecord.campusId),
						eq(campus.organizationId, input.organizationId),
						eq(campus.isActive, true),
					),
				)
				.limit(1)
				.for("update");
			if (!campusRecord) throw new FinanceError("CAMPUS_INACTIVE");

			const [existingPayment] = await tx
				.select({
					id: payment.id,
					invoiceId: payment.invoiceId,
					amountInCents: payment.amountInCents,
					receivedAt: payment.receivedAt,
					method: payment.method,
					referenceNo: payment.referenceNo,
					note: payment.note,
				})
				.from(payment)
				.where(
					and(
						eq(payment.organizationId, input.organizationId),
						eq(payment.requestId, input.requestId),
					),
				)
				.limit(1);

			if (existingPayment) {
				if (!paymentPayloadMatches(existingPayment, input)) {
					throw new FinanceError("IDEMPOTENCY_CONFLICT");
				}
				return existingPayment.id;
			}

			const outstandingAmount =
				invoiceRecord.amountInCents - invoiceRecord.paidAmountInCents;
			if (
				invoiceRecord.status === "paid" ||
				invoiceRecord.status === "refunded" ||
				outstandingAmount <= 0
			) {
				throw new FinanceError("INVOICE_NOT_PAYABLE");
			}
			if (input.amountInCents > outstandingAmount) {
				throw new FinanceError("PAYMENT_EXCEEDS_OUTSTANDING");
			}

			if (invoiceRecord.enrollmentId) {
				await tx
					.select({ id: enrollment.id })
					.from(enrollment)
					.where(
						and(
							eq(enrollment.id, invoiceRecord.enrollmentId),
							eq(enrollment.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update");
			}

			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.operatorUserId))
				.limit(1);
			if (!operator) {
				throw new FinanceError("RESOURCE_UNAVAILABLE");
			}

			const [createdPayment] = await tx
				.insert(payment)
				.values({ ...input, operatorName: operator.name })
				.returning({ id: payment.id });
			if (!createdPayment) {
				throw new Error("Payment creation did not return a record.");
			}

			const paidAmountInCents =
				invoiceRecord.paidAmountInCents + input.amountInCents;
			const isPaid = paidAmountInCents === invoiceRecord.amountInCents;
			await tx
				.update(invoice)
				.set({
					paidAmountInCents,
					status: isPaid ? "paid" : "partial",
					paidAt: isPaid ? input.receivedAt : null,
				})
				.where(
					and(
						eq(invoice.id, invoiceRecord.id),
						eq(invoice.organizationId, input.organizationId),
					),
				);

			if (invoiceRecord.enrollmentId) {
				const [snapshot] = await tx
					.select({
						value:
							sql<number>`coalesce(sum(${invoice.paidAmountInCents}), 0)`.mapWith(
								Number,
							),
					})
					.from(invoice)
					.where(
						and(
							eq(invoice.organizationId, input.organizationId),
							eq(invoice.enrollmentId, invoiceRecord.enrollmentId),
							ne(invoice.status, "refunded"),
						),
					);
				await tx
					.update(enrollment)
					.set({ paidAmountInCents: snapshot?.value ?? 0 })
					.where(
						and(
							eq(enrollment.id, invoiceRecord.enrollmentId),
							eq(enrollment.organizationId, input.organizationId),
						),
					);
			}

			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "payment_created",
				entityType: "payment",
				entityId: createdPayment.id,
				actorUserId: input.operatorUserId,
				campusId: studentRecord.campusId,
				after: {
					invoiceId: invoiceRecord.id,
					enrollmentId: invoiceRecord.enrollmentId,
					amountInCents: input.amountInCents,
					method: input.method,
					paidAt: input.receivedAt.toISOString(),
					requestId: input.requestId,
				},
			});

			return createdPayment.id;
		});

		return {
			payment: await getPaymentRecord({
				organizationId: input.organizationId,
				paymentId,
			}),
		};
	} catch (error) {
		if (error instanceof FinanceError) {
			throw error;
		}

		const databaseError = getDatabaseError(error);
		if (
			databaseError?.code === "23505" &&
			databaseError.constraint === "payment_org_request_uidx"
		) {
			const existingPayment = await findPaymentByRequest(input);
			if (!existingPayment || !paymentPayloadMatches(existingPayment, input)) {
				throw new FinanceError("IDEMPOTENCY_CONFLICT");
			}
			return { payment: existingPayment };
		}
		if (databaseError?.code === "23503") {
			throw new FinanceError("RESOURCE_UNAVAILABLE");
		}

		throw error;
	}
}
