import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
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
	invoiceAdjustment,
	manualInvoiceCreation,
	payment,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	type FinanceTransaction,
	getCurrentFinanceWriteCampusAccess,
} from "./finance-access";
import type { CampusAccess } from "./organization";

export type FinanceErrorCode =
	| "INVOICE_NOT_FOUND"
	| "INVOICE_NOT_PAYABLE"
	| "INVALID_PAYMENT_AMOUNT"
	| "INVALID_PAYMENT_TIME"
	| "PAYMENT_EXCEEDS_OUTSTANDING"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE"
	| "CAMPUS_INACTIVE"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "STUDENT_NOT_FOUND"
	| "ENROLLMENT_NOT_FOUND"
	| "ENROLLMENT_STUDENT_MISMATCH"
	| "ENROLLMENT_NOT_LINKABLE"
	| "INVALID_INVOICE_INPUT"
	| "INVOICE_NOT_ADJUSTABLE"
	| "INVOICE_AMOUNT_LOCKED"
	| "INVOICE_VERSION_CONFLICT"
	| "NO_ADJUSTMENT_CHANGES"
	| "INVALID_CURSOR";

export class FinanceError extends Error {
	constructor(public readonly code: FinanceErrorCode) {
		super(code);
		this.name = "FinanceError";
	}
}

export type InvoiceRecord = {
	id: string;
	enrollmentId: string | null;
	studentId: string;
	studentName: string;
	courseName: string | null;
	source: (typeof invoice.$inferSelect)["source"];
	businessActivityType: (typeof invoice.$inferSelect)["businessActivityType"];
	summary: string;
	amountInCents: number;
	paidAmountInCents: number;
	status: (typeof invoice.$inferSelect)["status"];
	dueDate: string;
	issuedAt: Date;
	createdByName: string | null;
	version: number;
};

export type InvoiceAdjustmentRecord = {
	id: string;
	invoiceId: string;
	beforeVersion: number;
	afterVersion: number;
	beforeAmountInCents: number;
	afterAmountInCents: number;
	beforeDueDate: string;
	afterDueDate: string;
	beforeSummary: string;
	afterSummary: string;
	reason: string;
	operatorName: string;
	createdAt: Date;
};

export type ManualInvoiceOptionRecord = {
	id: string;
	name: string;
	campusId: string;
	campusName: string;
	enrollments: Array<{
		id: string;
		courseId: string;
		courseName: string;
		status: "active" | "frozen";
	}>;
};

type ManualInvoiceOptionCursor = Pick<ManualInvoiceOptionRecord, "id" | "name">;

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
	enrollmentId: invoice.enrollmentId,
	studentId: invoice.studentId,
	studentName: student.name,
	courseName: course.name,
	source: invoice.source,
	businessActivityType: invoice.businessActivityType,
	summary: invoice.summary,
	amountInCents: invoice.amountInCents,
	paidAmountInCents: invoice.paidAmountInCents,
	status: invoice.status,
	dueDate: invoice.dueDate,
	issuedAt: invoice.issuedAt,
	createdByName: invoice.createdByName,
	version: invoice.version,
};

const invoiceAdjustmentRecordSelection = {
	id: invoiceAdjustment.id,
	invoiceId: invoiceAdjustment.invoiceId,
	beforeVersion: invoiceAdjustment.beforeVersion,
	afterVersion: invoiceAdjustment.afterVersion,
	beforeAmountInCents: invoiceAdjustment.beforeAmountInCents,
	afterAmountInCents: invoiceAdjustment.afterAmountInCents,
	beforeDueDate: invoiceAdjustment.beforeDueDate,
	afterDueDate: invoiceAdjustment.afterDueDate,
	beforeSummary: invoiceAdjustment.beforeSummary,
	afterSummary: invoiceAdjustment.afterSummary,
	reason: invoiceAdjustment.reason,
	operatorName: invoiceAdjustment.operatorName,
	createdAt: invoiceAdjustment.createdAt,
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
			ilike(invoice.summary, pattern),
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
}): Promise<{
	invoice: InvoiceRecord;
	payments: PaymentRecord[];
	adjustments: InvoiceAdjustmentRecord[];
} | null> {
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

	const [payments, adjustments] = await Promise.all([
		db
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
			),
		db
			.select(invoiceAdjustmentRecordSelection)
			.from(invoiceAdjustment)
			.where(
				and(
					eq(invoiceAdjustment.organizationId, input.organizationId),
					eq(invoiceAdjustment.invoiceId, input.id),
				),
			)
			.orderBy(desc(invoiceAdjustment.createdAt), desc(invoiceAdjustment.id)),
	]);

	return { invoice: invoiceRecord, payments, adjustments };
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
							inArray(invoice.source, ["enrollment", "renewal"]),
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

export type ManualInvoiceBusinessActivityType =
	| "material_fee"
	| "exam_fee"
	| "price_difference"
	| "other";

export type CreateManualInvoiceRecordInput = {
	organizationId: string;
	operatorUserId: string;
	studentId: string;
	enrollmentId: string | null;
	businessActivityType: ManualInvoiceBusinessActivityType;
	summary: string;
	amountInCents: number;
	dueDate: string;
	requestId: string;
};

export type AdjustInvoiceRecordInput = {
	organizationId: string;
	operatorUserId: string;
	invoiceId: string;
	amountInCents?: number;
	dueDate?: string;
	summary?: string;
	reason: string;
	expectedVersion: number;
	requestId: string;
};

const manualInvoiceBusinessActivityTypes =
	new Set<ManualInvoiceBusinessActivityType>([
		"material_fee",
		"exam_fee",
		"price_difference",
		"other",
	]);

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function assertValidBusinessDate(value: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new FinanceError("INVALID_INVOICE_INPUT");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new FinanceError("INVALID_INVOICE_INPUT");
	}
}

function createInputHash(payload: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function encodeManualInvoiceOptionCursor(
	cursor: ManualInvoiceOptionCursor,
): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeManualInvoiceOptionCursor(
	cursor: string | undefined,
): ManualInvoiceOptionCursor | undefined {
	if (!cursor) return undefined;

	try {
		const value: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof value !== "object" ||
			value === null ||
			!("id" in value) ||
			!("name" in value) ||
			typeof value.id !== "string" ||
			typeof value.name !== "string" ||
			value.id.length === 0 ||
			value.name.length === 0
		) {
			throw new Error("Invalid manual invoice option cursor.");
		}
		return { id: value.id, name: value.name };
	} catch {
		throw new FinanceError("INVALID_CURSOR");
	}
}

async function assertActiveAccessibleCampus(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		campusId: string;
		access: CampusAccess;
	},
): Promise<void> {
	if (!isCampusAccessible(input.access, input.campusId)) {
		throw new FinanceError("CAMPUS_OUT_OF_SCOPE");
	}
	const [record] = await tx
		.select({ isActive: campus.isActive })
		.from(campus)
		.where(
			and(
				eq(campus.id, input.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!record?.isActive) {
		throw new FinanceError("CAMPUS_INACTIVE");
	}
}

async function getOperatorName(
	tx: FinanceTransaction,
	operatorUserId: string,
): Promise<string> {
	const [operator] = await tx
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, operatorUserId))
		.limit(1);
	if (!operator) throw new FinanceError("RESOURCE_UNAVAILABLE");
	return operator.name;
}

export async function listManualInvoiceOptionRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	query?: string;
	cursor?: string;
	pageSize: number;
}): Promise<{
	items: ManualInvoiceOptionRecord[];
	nextCursor: string | null;
}> {
	const cursor = decodeManualInvoiceOptionCursor(input.cursor);
	if (input.campusAccess.kind === "none") {
		return { items: [], nextCursor: null };
	}
	const filters = [
		eq(student.organizationId, input.organizationId),
		eq(campus.organizationId, input.organizationId),
		eq(campus.isActive, true),
		campusAccessCondition(input.campusAccess),
	];
	if (input.query) filters.push(ilike(student.name, `%${input.query}%`));
	if (cursor) {
		const cursorFilter = or(
			gt(student.name, cursor.name),
			and(eq(student.name, cursor.name), gt(student.id, cursor.id)),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}
	const studentRows = await db
		.select({
			id: student.id,
			name: student.name,
			campusId: campus.id,
			campusName: campus.name,
		})
		.from(student)
		.innerJoin(
			campus,
			and(
				eq(campus.id, student.campusId),
				eq(campus.organizationId, student.organizationId),
			),
		)
		.where(and(...filters))
		.orderBy(asc(student.name), asc(student.id))
		.limit(input.pageSize + 1);
	const students = studentRows.slice(0, input.pageSize);
	if (students.length === 0) return { items: [], nextCursor: null };
	const enrollments = await db
		.select({
			id: enrollment.id,
			studentId: enrollment.studentId,
			courseId: course.id,
			courseName: course.name,
			status: enrollment.status,
		})
		.from(enrollment)
		.innerJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, enrollment.organizationId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				inArray(
					enrollment.studentId,
					students.map((item) => item.id),
				),
				inArray(enrollment.status, ["active", "frozen"]),
			),
		)
		.orderBy(asc(course.name), asc(enrollment.id));

	const items = students.map((studentRecord) => ({
		...studentRecord,
		enrollments: enrollments
			.filter((item) => item.studentId === studentRecord.id)
			.map(({ studentId: _studentId, ...item }) => ({
				...item,
				status: item.status as "active" | "frozen",
			})),
	}));
	const lastItem = items.at(-1);

	return {
		items,
		nextCursor:
			studentRows.length > input.pageSize && lastItem
				? encodeManualInvoiceOptionCursor(lastItem)
				: null,
	};
}

export async function createManualInvoiceRecord(
	input: CreateManualInvoiceRecordInput,
): Promise<{ invoiceId: string; replayed: boolean }> {
	const summary = input.summary.trim();
	if (
		!manualInvoiceBusinessActivityTypes.has(input.businessActivityType) ||
		!Number.isSafeInteger(input.amountInCents) ||
		input.amountInCents <= 0 ||
		input.amountInCents > 100_000_000 ||
		summary.length === 0 ||
		summary.length > 200
	) {
		throw new FinanceError("INVALID_INVOICE_INPUT");
	}
	assertValidBusinessDate(input.dueDate);
	const inputHash = createInputHash({
		studentId: input.studentId,
		enrollmentId: input.enrollmentId,
		businessActivityType: input.businessActivityType,
		summary,
		amountInCents: input.amountInCents,
		dueDate: input.dueDate,
	});

	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentFinanceWriteCampusAccess(
				tx,
				{
					organizationId: input.organizationId,
					userId: input.operatorUserId,
				},
				() => new FinanceError("MEMBER_FORBIDDEN"),
			);
			const [studentRecord] = await tx
				.select({ id: student.id, campusId: student.campusId })
				.from(student)
				.where(
					and(
						eq(student.id, input.studentId),
						eq(student.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!studentRecord) throw new FinanceError("STUDENT_NOT_FOUND");
			await assertActiveAccessibleCampus(tx, {
				organizationId: input.organizationId,
				campusId: studentRecord.campusId,
				access,
			});

			const [existing] = await tx
				.select({
					invoiceId: manualInvoiceCreation.invoiceId,
					inputHash: manualInvoiceCreation.inputHash,
				})
				.from(manualInvoiceCreation)
				.where(
					and(
						eq(manualInvoiceCreation.organizationId, input.organizationId),
						eq(manualInvoiceCreation.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (existing.inputHash !== inputHash) {
					throw new FinanceError("IDEMPOTENCY_CONFLICT");
				}
				return { invoiceId: existing.invoiceId, replayed: true };
			}

			if (input.enrollmentId) {
				const [enrollmentRecord] = await tx
					.select({
						studentId: enrollment.studentId,
						status: enrollment.status,
					})
					.from(enrollment)
					.where(
						and(
							eq(enrollment.id, input.enrollmentId),
							eq(enrollment.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update");
				if (!enrollmentRecord) {
					throw new FinanceError("ENROLLMENT_NOT_FOUND");
				}
				if (enrollmentRecord.studentId !== input.studentId) {
					throw new FinanceError("ENROLLMENT_STUDENT_MISMATCH");
				}
				if (
					enrollmentRecord.status !== "active" &&
					enrollmentRecord.status !== "frozen"
				) {
					throw new FinanceError("ENROLLMENT_NOT_LINKABLE");
				}
			}

			const operatorName = await getOperatorName(tx, input.operatorUserId);
			const [createdInvoice] = await tx
				.insert(invoice)
				.values({
					organizationId: input.organizationId,
					studentId: input.studentId,
					enrollmentId: input.enrollmentId,
					source: "manual",
					businessActivityType: input.businessActivityType,
					summary,
					amountInCents: input.amountInCents,
					status: "pending",
					dueDate: input.dueDate,
					createdByUserId: input.operatorUserId,
					createdByName: operatorName,
				})
				.returning({ id: invoice.id });
			if (!createdInvoice) throw new FinanceError("RESOURCE_UNAVAILABLE");
			const [creation] = await tx
				.insert(manualInvoiceCreation)
				.values({
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash,
					invoiceId: createdInvoice.id,
					studentId: input.studentId,
					enrollmentId: input.enrollmentId,
					campusId: studentRecord.campusId,
					operatorUserId: input.operatorUserId,
					operatorName,
				})
				.returning({ id: manualInvoiceCreation.id });
			if (!creation) throw new FinanceError("RESOURCE_UNAVAILABLE");
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "manual_invoice_created",
				entityType: "manual_invoice_creation",
				entityId: creation.id,
				actorUserId: input.operatorUserId,
				campusId: studentRecord.campusId,
				after: {
					invoiceId: createdInvoice.id,
					studentId: input.studentId,
					enrollmentId: input.enrollmentId,
					source: "manual",
					businessActivityType: input.businessActivityType,
					amountInCents: input.amountInCents,
					dueDate: input.dueDate,
					requestId: input.requestId,
				},
			});
			return { invoiceId: createdInvoice.id, replayed: false };
		});
	} catch (error) {
		if (error instanceof FinanceError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			throw new FinanceError("IDEMPOTENCY_CONFLICT");
		}
		if (databaseError?.code === "23503") {
			throw new FinanceError("RESOURCE_UNAVAILABLE");
		}
		throw error;
	}
}

export async function adjustInvoiceRecord(
	input: AdjustInvoiceRecordInput,
): Promise<{ adjustment: InvoiceAdjustmentRecord; replayed: boolean }> {
	const summary = input.summary?.trim();
	const reason = input.reason.trim();
	if (
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion <= 0 ||
		reason.length === 0 ||
		reason.length > 500 ||
		(summary !== undefined && (summary.length === 0 || summary.length > 200)) ||
		(input.amountInCents !== undefined &&
			(!Number.isSafeInteger(input.amountInCents) ||
				input.amountInCents <= 0 ||
				input.amountInCents > 100_000_000))
	) {
		throw new FinanceError("INVALID_INVOICE_INPUT");
	}
	if (input.dueDate !== undefined) assertValidBusinessDate(input.dueDate);
	const inputHash = createInputHash({
		invoiceId: input.invoiceId,
		amountInCents: input.amountInCents ?? null,
		dueDate: input.dueDate ?? null,
		summary: summary ?? null,
		reason,
		expectedVersion: input.expectedVersion,
	});

	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentFinanceWriteCampusAccess(
				tx,
				{
					organizationId: input.organizationId,
					userId: input.operatorUserId,
				},
				() => new FinanceError("MEMBER_FORBIDDEN"),
			);
			const [invoiceRecord] = await tx
				.select({
					id: invoice.id,
					studentId: invoice.studentId,
					amountInCents: invoice.amountInCents,
					paidAmountInCents: invoice.paidAmountInCents,
					status: invoice.status,
					dueDate: invoice.dueDate,
					summary: invoice.summary,
					version: invoice.version,
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
			if (!invoiceRecord) throw new FinanceError("INVOICE_NOT_FOUND");
			const [studentRecord] = await tx
				.select({ campusId: student.campusId })
				.from(student)
				.where(
					and(
						eq(student.id, invoiceRecord.studentId),
						eq(student.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("key share");
			if (!studentRecord) throw new FinanceError("INVOICE_NOT_FOUND");
			await assertActiveAccessibleCampus(tx, {
				organizationId: input.organizationId,
				campusId: studentRecord.campusId,
				access,
			});

			const [existing] = await tx
				.select(invoiceAdjustmentRecordSelection)
				.from(invoiceAdjustment)
				.where(
					and(
						eq(invoiceAdjustment.organizationId, input.organizationId),
						eq(invoiceAdjustment.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				const [fingerprint] = await tx
					.select({ inputHash: invoiceAdjustment.inputHash })
					.from(invoiceAdjustment)
					.where(eq(invoiceAdjustment.id, existing.id))
					.limit(1);
				if (fingerprint?.inputHash !== inputHash) {
					throw new FinanceError("IDEMPOTENCY_CONFLICT");
				}
				return { adjustment: existing, replayed: true };
			}
			if (invoiceRecord.version !== input.expectedVersion) {
				throw new FinanceError("INVOICE_VERSION_CONFLICT");
			}
			const nextAmountInCents =
				input.amountInCents ?? invoiceRecord.amountInCents;
			const nextDueDate = input.dueDate ?? invoiceRecord.dueDate;
			const nextSummary = summary ?? invoiceRecord.summary;
			const amountChanged = nextAmountInCents !== invoiceRecord.amountInCents;
			const dueDateChanged = nextDueDate !== invoiceRecord.dueDate;
			const summaryChanged = nextSummary !== invoiceRecord.summary;
			if (!amountChanged && !dueDateChanged && !summaryChanged) {
				throw new FinanceError("NO_ADJUSTMENT_CHANGES");
			}
			const fullySettled =
				invoiceRecord.status === "paid" ||
				invoiceRecord.status === "refunded" ||
				invoiceRecord.paidAmountInCents >= invoiceRecord.amountInCents;
			if (fullySettled) {
				throw new FinanceError("INVOICE_NOT_ADJUSTABLE");
			}
			if (amountChanged) {
				const [existingPayment] = await tx
					.select({ id: payment.id })
					.from(payment)
					.where(
						and(
							eq(payment.organizationId, input.organizationId),
							eq(payment.invoiceId, input.invoiceId),
						),
					)
					.limit(1);
				if (invoiceRecord.paidAmountInCents > 0 || existingPayment) {
					throw new FinanceError("INVOICE_AMOUNT_LOCKED");
				}
			}

			const operatorName = await getOperatorName(tx, input.operatorUserId);
			const afterVersion = invoiceRecord.version + 1;
			const [updated] = await tx
				.update(invoice)
				.set({
					amountInCents: nextAmountInCents,
					dueDate: nextDueDate,
					summary: nextSummary,
					version: afterVersion,
				})
				.where(
					and(
						eq(invoice.id, input.invoiceId),
						eq(invoice.organizationId, input.organizationId),
						eq(invoice.version, input.expectedVersion),
					),
				)
				.returning({ id: invoice.id });
			if (!updated) throw new FinanceError("INVOICE_VERSION_CONFLICT");
			const [adjustment] = await tx
				.insert(invoiceAdjustment)
				.values({
					organizationId: input.organizationId,
					invoiceId: input.invoiceId,
					campusId: studentRecord.campusId,
					requestId: input.requestId,
					inputHash,
					beforeVersion: invoiceRecord.version,
					afterVersion,
					beforeAmountInCents: invoiceRecord.amountInCents,
					afterAmountInCents: nextAmountInCents,
					beforeDueDate: invoiceRecord.dueDate,
					afterDueDate: nextDueDate,
					beforeSummary: invoiceRecord.summary,
					afterSummary: nextSummary,
					reason,
					operatorUserId: input.operatorUserId,
					operatorName,
				})
				.returning(invoiceAdjustmentRecordSelection);
			if (!adjustment) throw new FinanceError("RESOURCE_UNAVAILABLE");
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "invoice_adjusted",
				entityType: "invoice_adjustment",
				entityId: adjustment.id,
				actorUserId: input.operatorUserId,
				campusId: studentRecord.campusId,
				before: {
					amountInCents: invoiceRecord.amountInCents,
					dueDate: invoiceRecord.dueDate,
					version: invoiceRecord.version,
				},
				after: {
					invoiceId: input.invoiceId,
					amountInCents: nextAmountInCents,
					dueDate: nextDueDate,
					version: afterVersion,
					summaryChanged,
					requestId: input.requestId,
				},
			});
			return { adjustment, replayed: false };
		});
	} catch (error) {
		if (error instanceof FinanceError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505") {
			throw new FinanceError("IDEMPOTENCY_CONFLICT");
		}
		if (databaseError?.code === "23503") {
			throw new FinanceError("RESOURCE_UNAVAILABLE");
		}
		throw error;
	}
}
