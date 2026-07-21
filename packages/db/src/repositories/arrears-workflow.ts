import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	course,
	enrollment,
	invoice,
	invoiceArrearsCycle,
	invoiceArrearsEvent,
	student,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	type FinanceTransaction,
	getCurrentFinanceWriteCampusAccess,
} from "./finance-access";
import type { CampusAccess } from "./organization";

export type ArrearsWorkflowErrorCode =
	| "INVOICE_NOT_FOUND"
	| "ARREARS_NOT_ACTIVE"
	| "ARREARS_CYCLE_MISSING"
	| "ARREARS_VERSION_CONFLICT"
	| "ARREARS_TRANSITION_INVALID"
	| "INVALID_ARREARS_INPUT"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE"
	| "CAMPUS_INACTIVE"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE";

export class ArrearsWorkflowError extends Error {
	constructor(public readonly code: ArrearsWorkflowErrorCode) {
		super(code);
		this.name = "ArrearsWorkflowError";
	}
}

export type ArrearsStatus = (typeof invoiceArrearsCycle.$inferSelect)["status"];
export type ArrearsEventType =
	(typeof invoiceArrearsEvent.$inferSelect)["eventType"];

export type ArrearsCycleRecord = {
	id: string;
	invoiceId: string;
	cycleNumber: number;
	status: ArrearsStatus;
	version: number;
	startedAt: Date;
	resolvedAt: Date | null;
	promisedPaymentDate: string | null;
	resumeDate: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type ArrearsEventRecord = {
	id: string;
	cycleId: string;
	eventType: ArrearsEventType;
	fromStatus: ArrearsStatus | null;
	toStatus: ArrearsStatus | null;
	promisedPaymentDate: string | null;
	resumeDate: string | null;
	reason: string | null;
	note: string | null;
	operatorName: string | null;
	sourceType: string;
	createdAt: Date;
};

export type ArrearsWorkflowRecord = {
	invoiceId: string;
	studentName: string;
	courseName: string | null;
	source: (typeof invoice.$inferSelect)["source"];
	summary: string;
	amountInCents: number;
	paidAmountInCents: number;
	outstandingAmountInCents: number;
	dueDate: string;
	isOverdue: boolean;
	cycle: Pick<
		ArrearsCycleRecord,
		| "id"
		| "cycleNumber"
		| "status"
		| "version"
		| "promisedPaymentDate"
		| "resumeDate"
	>;
	latestEvent: Pick<
		ArrearsEventRecord,
		"eventType" | "operatorName" | "createdAt"
	> | null;
};

const cycleSelection = {
	id: invoiceArrearsCycle.id,
	invoiceId: invoiceArrearsCycle.invoiceId,
	cycleNumber: invoiceArrearsCycle.cycleNumber,
	status: invoiceArrearsCycle.status,
	version: invoiceArrearsCycle.version,
	startedAt: invoiceArrearsCycle.startedAt,
	resolvedAt: invoiceArrearsCycle.resolvedAt,
	promisedPaymentDate: invoiceArrearsCycle.promisedPaymentDate,
	resumeDate: invoiceArrearsCycle.resumeDate,
	createdAt: invoiceArrearsCycle.createdAt,
	updatedAt: invoiceArrearsCycle.updatedAt,
};

const eventSelection = {
	id: invoiceArrearsEvent.id,
	cycleId: invoiceArrearsEvent.cycleId,
	eventType: invoiceArrearsEvent.eventType,
	fromStatus: invoiceArrearsEvent.fromStatus,
	toStatus: invoiceArrearsEvent.toStatus,
	promisedPaymentDate: invoiceArrearsEvent.promisedPaymentDate,
	resumeDate: invoiceArrearsEvent.resumeDate,
	reason: invoiceArrearsEvent.reason,
	note: invoiceArrearsEvent.note,
	operatorName: invoiceArrearsEvent.operatorName,
	sourceType: invoiceArrearsEvent.sourceType,
	createdAt: invoiceArrearsEvent.createdAt,
};

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function campusAccessCondition(access: CampusAccess) {
	if (access.kind === "none") return sql`false`;
	return access.kind === "selected"
		? inArray(student.campusId, access.campusIds)
		: sql`true`;
}

function getShanghaiDate(now = new Date()): string {
	const values = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	})
		.formatToParts(now)
		.reduce<Record<string, string>>((result, item) => {
			if (item.type !== "literal") result[item.type] = item.value;
			return result;
		}, {});
	return `${values.year}-${values.month}-${values.day}`;
}

function assertBusinessDate(value: string | null | undefined): void {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	}
}

function assertNotBeforeToday(
	value: string | null | undefined,
	today: string,
): void {
	assertBusinessDate(value);
	if ((value ?? "") < today) {
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	}
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error;
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

async function assertActiveAccessibleCampus(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		campusId: string;
		campusAccess: CampusAccess;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new ArrearsWorkflowError("CAMPUS_OUT_OF_SCOPE");
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
	if (!record?.isActive) throw new ArrearsWorkflowError("CAMPUS_INACTIVE");
}

async function getInvoiceForWorkflow(
	tx: FinanceTransaction,
	input: { organizationId: string; invoiceId: string; lock?: boolean },
) {
	const query = tx
		.select({
			id: invoice.id,
			studentId: invoice.studentId,
			amountInCents: invoice.amountInCents,
			paidAmountInCents: invoice.paidAmountInCents,
			status: invoice.status,
			campusId: student.campusId,
		})
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				eq(invoice.id, input.invoiceId),
			),
		)
		.limit(1);
	const [record] = input.lock ? await query.for("update") : await query;
	return record ?? null;
}

async function getOpenCycle(
	tx: FinanceTransaction,
	input: { organizationId: string; invoiceId: string; lock?: boolean },
): Promise<ArrearsCycleRecord | null> {
	const query = tx
		.select(cycleSelection)
		.from(invoiceArrearsCycle)
		.where(
			and(
				eq(invoiceArrearsCycle.organizationId, input.organizationId),
				eq(invoiceArrearsCycle.invoiceId, input.invoiceId),
				sql`${invoiceArrearsCycle.resolvedAt} IS NULL`,
			),
		)
		.limit(1);
	const [record] = input.lock ? await query.for("update") : await query;
	return record ?? null;
}

export async function startArrearsCycleIfNeeded(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		invoiceId: string;
		sourceType: string;
		sourceId: string;
		occurredAt: Date;
	},
): Promise<ArrearsCycleRecord | null> {
	const invoiceRecord = await getInvoiceForWorkflow(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
	});
	if (!invoiceRecord) throw new ArrearsWorkflowError("INVOICE_NOT_FOUND");
	if (
		invoiceRecord.status === "refunded" ||
		invoiceRecord.amountInCents <= invoiceRecord.paidAmountInCents
	) {
		return null;
	}
	const openCycle = await getOpenCycle(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
		lock: true,
	});
	if (openCycle) return openCycle;

	const [latest] = await tx
		.select({
			value:
				sql<number>`coalesce(max(${invoiceArrearsCycle.cycleNumber}), 0)`.mapWith(
					Number,
				),
		})
		.from(invoiceArrearsCycle)
		.where(
			and(
				eq(invoiceArrearsCycle.organizationId, input.organizationId),
				eq(invoiceArrearsCycle.invoiceId, input.invoiceId),
			),
		);
	const [created] = await tx
		.insert(invoiceArrearsCycle)
		.values({
			organizationId: input.organizationId,
			campusId: invoiceRecord.campusId,
			invoiceId: input.invoiceId,
			cycleNumber: (latest?.value ?? 0) + 1,
			status: "pending",
			startedAt: input.occurredAt,
		})
		.returning(cycleSelection);
	if (!created) throw new ArrearsWorkflowError("RESOURCE_UNAVAILABLE");
	await tx.insert(invoiceArrearsEvent).values({
		organizationId: input.organizationId,
		cycleId: created.id,
		eventType: "cycle_started",
		toStatus: "pending",
		sourceType: input.sourceType,
		sourceId: input.sourceId,
		createdAt: input.occurredAt,
	});
	await writeOrganizationAuditEvent(tx, {
		organizationId: input.organizationId,
		action: "arrears_status_changed",
		entityType: "invoice_arrears_cycle",
		entityId: created.id,
		actorUserId: null,
		campusId: invoiceRecord.campusId,
		after: {
			invoiceId: input.invoiceId,
			cycleNumber: created.cycleNumber,
			status: "pending",
			sourceType: input.sourceType,
			sourceId: input.sourceId,
		},
	});
	return created;
}

export async function resolveArrearsCycleIfNeeded(
	tx: FinanceTransaction,
	input: {
		organizationId: string;
		invoiceId: string;
		sourceType: string;
		sourceId: string;
		occurredAt: Date;
	},
): Promise<ArrearsCycleRecord | null> {
	const invoiceRecord = await getInvoiceForWorkflow(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
	});
	if (!invoiceRecord) throw new ArrearsWorkflowError("INVOICE_NOT_FOUND");
	if (
		invoiceRecord.status !== "refunded" &&
		invoiceRecord.amountInCents > invoiceRecord.paidAmountInCents
	) {
		return null;
	}
	const openCycle = await getOpenCycle(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
		lock: true,
	});
	if (!openCycle) return null;
	const [resolved] = await tx
		.update(invoiceArrearsCycle)
		.set({
			status: "resolved",
			resolvedAt: input.occurredAt,
			version: openCycle.version + 1,
			promisedPaymentDate: null,
			resumeDate: null,
		})
		.where(
			and(
				eq(invoiceArrearsCycle.organizationId, input.organizationId),
				eq(invoiceArrearsCycle.id, openCycle.id),
			),
		)
		.returning(cycleSelection);
	if (!resolved) throw new ArrearsWorkflowError("RESOURCE_UNAVAILABLE");
	await tx.insert(invoiceArrearsEvent).values({
		organizationId: input.organizationId,
		cycleId: resolved.id,
		eventType: "auto_resolved",
		fromStatus: openCycle.status,
		toStatus: "resolved",
		sourceType: input.sourceType,
		sourceId: input.sourceId,
		createdAt: input.occurredAt,
	});
	await writeOrganizationAuditEvent(tx, {
		organizationId: input.organizationId,
		action: "arrears_status_changed",
		entityType: "invoice_arrears_cycle",
		entityId: resolved.id,
		actorUserId: null,
		campusId: invoiceRecord.campusId,
		before: {
			invoiceId: input.invoiceId,
			status: openCycle.status,
			version: openCycle.version,
		},
		after: {
			invoiceId: input.invoiceId,
			status: "resolved",
			version: resolved.version,
			sourceType: input.sourceType,
			sourceId: input.sourceId,
		},
	});
	return resolved;
}

export async function listArrearsWorkflowRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	today: string;
	status?: Exclude<ArrearsStatus, "resolved">;
	pausedWithoutResumeOnly?: boolean;
}): Promise<ArrearsWorkflowRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const invoices = await db
		.select({
			invoiceId: invoice.id,
			studentName: student.name,
			courseName: course.name,
			source: invoice.source,
			summary: invoice.summary,
			amountInCents: invoice.amountInCents,
			paidAmountInCents: invoice.paidAmountInCents,
			dueDate: invoice.dueDate,
		})
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
				eq(invoice.organizationId, input.organizationId),
				ne(invoice.status, "refunded"),
				sql`${invoice.amountInCents} > ${invoice.paidAmountInCents}`,
				campusAccessCondition(input.campusAccess),
			),
		)
		.orderBy(asc(invoice.dueDate), asc(student.name), asc(invoice.id));
	if (invoices.length === 0) return [];
	const cycles = await db
		.select(cycleSelection)
		.from(invoiceArrearsCycle)
		.where(
			and(
				eq(invoiceArrearsCycle.organizationId, input.organizationId),
				inArray(
					invoiceArrearsCycle.invoiceId,
					invoices.map((item) => item.invoiceId),
				),
				sql`${invoiceArrearsCycle.resolvedAt} IS NULL`,
				input.status ? eq(invoiceArrearsCycle.status, input.status) : undefined,
				input.pausedWithoutResumeOnly
					? and(
							eq(invoiceArrearsCycle.status, "paused"),
							sql`${invoiceArrearsCycle.resumeDate} IS NULL`,
						)
					: undefined,
			),
		);
	const cyclesByInvoice = new Map(cycles.map((item) => [item.invoiceId, item]));
	const selectedInvoices = invoices.filter((item) =>
		cyclesByInvoice.has(item.invoiceId),
	);
	if (
		selectedInvoices.length !== invoices.length &&
		!input.status &&
		!input.pausedWithoutResumeOnly
	) {
		throw new ArrearsWorkflowError("ARREARS_CYCLE_MISSING");
	}
	if (cycles.length === 0) return [];
	const events = await db
		.select(eventSelection)
		.from(invoiceArrearsEvent)
		.where(
			and(
				eq(invoiceArrearsEvent.organizationId, input.organizationId),
				inArray(
					invoiceArrearsEvent.cycleId,
					cycles.map((item) => item.id),
				),
			),
		)
		.orderBy(desc(invoiceArrearsEvent.createdAt), desc(invoiceArrearsEvent.id));
	const latestByCycle = new Map<string, ArrearsEventRecord>();
	for (const event of events)
		if (!latestByCycle.has(event.cycleId))
			latestByCycle.set(event.cycleId, event);
	return selectedInvoices.flatMap((item) => {
		const cycle = cyclesByInvoice.get(item.invoiceId);
		if (!cycle) return [];
		const latestEvent = latestByCycle.get(cycle.id);
		return [
			{
				...item,
				outstandingAmountInCents: item.amountInCents - item.paidAmountInCents,
				isOverdue: item.dueDate < input.today,
				cycle: {
					id: cycle.id,
					cycleNumber: cycle.cycleNumber,
					status: cycle.status,
					version: cycle.version,
					promisedPaymentDate: cycle.promisedPaymentDate,
					resumeDate: cycle.resumeDate,
				},
				latestEvent: latestEvent
					? {
							eventType: latestEvent.eventType,
							operatorName: latestEvent.operatorName,
							createdAt: latestEvent.createdAt,
						}
					: null,
			},
		];
	});
}

export async function getArrearsDetailRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	invoiceId: string;
}): Promise<{
	invoiceId: string;
	cycles: Array<ArrearsCycleRecord & { events: ArrearsEventRecord[] }>;
}> {
	if (input.campusAccess.kind === "none")
		throw new ArrearsWorkflowError("INVOICE_NOT_FOUND");
	const [invoiceRecord] = await db
		.select({ id: invoice.id })
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, invoice.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				eq(invoice.id, input.invoiceId),
				campusAccessCondition(input.campusAccess),
			),
		)
		.limit(1);
	if (!invoiceRecord) throw new ArrearsWorkflowError("INVOICE_NOT_FOUND");
	const cycles = await db
		.select(cycleSelection)
		.from(invoiceArrearsCycle)
		.where(
			and(
				eq(invoiceArrearsCycle.organizationId, input.organizationId),
				eq(invoiceArrearsCycle.invoiceId, input.invoiceId),
			),
		)
		.orderBy(desc(invoiceArrearsCycle.cycleNumber));
	const events =
		cycles.length === 0
			? []
			: await db
					.select(eventSelection)
					.from(invoiceArrearsEvent)
					.where(
						and(
							eq(invoiceArrearsEvent.organizationId, input.organizationId),
							inArray(
								invoiceArrearsEvent.cycleId,
								cycles.map((item) => item.id),
							),
						),
					)
					.orderBy(
						asc(invoiceArrearsEvent.createdAt),
						asc(invoiceArrearsEvent.id),
					);
	const eventsByCycle = new Map<string, ArrearsEventRecord[]>();
	for (const event of events)
		eventsByCycle.set(event.cycleId, [
			...(eventsByCycle.get(event.cycleId) ?? []),
			event,
		]);
	return {
		invoiceId: input.invoiceId,
		cycles: cycles.map((cycle) => ({
			...cycle,
			events: eventsByCycle.get(cycle.id) ?? [],
		})),
	};
}

type ManualCycleInput = {
	organizationId: string;
	operatorUserId: string;
	invoiceId: string;
	expectedVersion: number;
	requestId: string;
};

async function getWritableOpenCycle(
	tx: FinanceTransaction,
	input: ManualCycleInput,
	options?: { skipVersionCheck?: boolean },
) {
	const access = await getCurrentFinanceWriteCampusAccess(
		tx,
		{ organizationId: input.organizationId, userId: input.operatorUserId },
		() => new ArrearsWorkflowError("MEMBER_FORBIDDEN"),
	);
	const invoiceRecord = await getInvoiceForWorkflow(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
		lock: true,
	});
	if (!invoiceRecord) throw new ArrearsWorkflowError("INVOICE_NOT_FOUND");
	await assertActiveAccessibleCampus(tx, {
		organizationId: input.organizationId,
		campusId: invoiceRecord.campusId,
		campusAccess: access,
	});
	if (
		invoiceRecord.status === "refunded" ||
		invoiceRecord.amountInCents <= invoiceRecord.paidAmountInCents
	) {
		throw new ArrearsWorkflowError("ARREARS_NOT_ACTIVE");
	}
	const cycle = await getOpenCycle(tx, {
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
		lock: true,
	});
	if (!cycle) throw new ArrearsWorkflowError("ARREARS_CYCLE_MISSING");
	if (!options?.skipVersionCheck && cycle.version !== input.expectedVersion) {
		throw new ArrearsWorkflowError("ARREARS_VERSION_CONFLICT");
	}
	const [operator] = await tx
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, input.operatorUserId))
		.limit(1);
	if (!operator) throw new ArrearsWorkflowError("RESOURCE_UNAVAILABLE");
	return { invoiceRecord, cycle, operatorName: operator.name };
}

export async function transitionArrearsCycleRecord(
	input: ManualCycleInput & {
		toStatus: "following_up" | "promised" | "paused";
		promisedPaymentDate?: string | null;
		resumeDate?: string | null;
		reason?: string | null;
		note?: string | null;
	},
): Promise<{ cycle: ArrearsCycleRecord; replayed: boolean }> {
	if (
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion <= 0
	)
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	const reason = input.reason?.trim() || null;
	const note = input.note?.trim() || null;
	const today = getShanghaiDate();
	if (input.toStatus === "promised")
		assertNotBeforeToday(input.promisedPaymentDate, today);
	if (input.toStatus === "paused") {
		if (!reason) throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
		if (input.resumeDate) assertNotBeforeToday(input.resumeDate, today);
	}
	if (
		input.toStatus === "following_up" &&
		(input.promisedPaymentDate || input.resumeDate || reason)
	) {
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	}
	try {
		return await db.transaction(async (tx) => {
			const writable = await getWritableOpenCycle(tx, input, {
				skipVersionCheck: true,
			});
			const [existing] = await tx
				.select({
					cycleId: invoiceArrearsEvent.cycleId,
					toStatus: invoiceArrearsEvent.toStatus,
					promisedPaymentDate: invoiceArrearsEvent.promisedPaymentDate,
					resumeDate: invoiceArrearsEvent.resumeDate,
					reason: invoiceArrearsEvent.reason,
					note: invoiceArrearsEvent.note,
				})
				.from(invoiceArrearsEvent)
				.where(
					and(
						eq(invoiceArrearsEvent.organizationId, input.organizationId),
						eq(invoiceArrearsEvent.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (
					existing.cycleId !== writable.cycle.id ||
					existing.toStatus !== input.toStatus ||
					existing.promisedPaymentDate !==
						(input.toStatus === "promised"
							? (input.promisedPaymentDate ?? null)
							: null) ||
					existing.resumeDate !==
						(input.toStatus === "paused" ? (input.resumeDate ?? null) : null) ||
					existing.reason !== (input.toStatus === "paused" ? reason : null) ||
					existing.note !== note
				)
					throw new ArrearsWorkflowError("IDEMPOTENCY_CONFLICT");
				return { cycle: writable.cycle, replayed: true };
			}
			if (writable.cycle.version !== input.expectedVersion) {
				throw new ArrearsWorkflowError("ARREARS_VERSION_CONFLICT");
			}
			const promisedPaymentDate =
				input.toStatus === "promised"
					? (input.promisedPaymentDate ?? null)
					: null;
			const resumeDate =
				input.toStatus === "paused" ? (input.resumeDate ?? null) : null;
			const [cycle] = await tx
				.update(invoiceArrearsCycle)
				.set({
					status: input.toStatus,
					version: writable.cycle.version + 1,
					promisedPaymentDate,
					resumeDate,
				})
				.where(
					and(
						eq(invoiceArrearsCycle.organizationId, input.organizationId),
						eq(invoiceArrearsCycle.id, writable.cycle.id),
					),
				)
				.returning(cycleSelection);
			if (!cycle) throw new ArrearsWorkflowError("RESOURCE_UNAVAILABLE");
			await tx.insert(invoiceArrearsEvent).values({
				organizationId: input.organizationId,
				cycleId: cycle.id,
				eventType: "status_changed",
				fromStatus: writable.cycle.status,
				toStatus: input.toStatus,
				promisedPaymentDate,
				resumeDate,
				reason: input.toStatus === "paused" ? reason : null,
				note,
				operatorUserId: input.operatorUserId,
				operatorName: writable.operatorName,
				sourceType: "manual",
				requestId: input.requestId,
			});
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "arrears_status_changed",
				entityType: "invoice_arrears_cycle",
				entityId: cycle.id,
				actorUserId: input.operatorUserId,
				campusId: writable.invoiceRecord.campusId,
				before: {
					invoiceId: input.invoiceId,
					status: writable.cycle.status,
					version: writable.cycle.version,
				},
				after: {
					invoiceId: input.invoiceId,
					status: input.toStatus,
					version: cycle.version,
					requestId: input.requestId,
				},
			});
			return { cycle, replayed: false };
		});
	} catch (error) {
		if (error instanceof ArrearsWorkflowError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505")
			throw new ArrearsWorkflowError("IDEMPOTENCY_CONFLICT");
		throw error;
	}
}

export async function addArrearsNoteRecord(
	input: ManualCycleInput & { note: string },
): Promise<{ cycle: ArrearsCycleRecord; replayed: boolean }> {
	const note = input.note.trim();
	if (
		!note ||
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion <= 0
	)
		throw new ArrearsWorkflowError("INVALID_ARREARS_INPUT");
	try {
		return await db.transaction(async (tx) => {
			const writable = await getWritableOpenCycle(tx, input, {
				skipVersionCheck: true,
			});
			const [existing] = await tx
				.select({
					cycleId: invoiceArrearsEvent.cycleId,
					eventType: invoiceArrearsEvent.eventType,
					note: invoiceArrearsEvent.note,
				})
				.from(invoiceArrearsEvent)
				.where(
					and(
						eq(invoiceArrearsEvent.organizationId, input.organizationId),
						eq(invoiceArrearsEvent.requestId, input.requestId),
					),
				)
				.limit(1);
			if (existing) {
				if (
					existing.cycleId !== writable.cycle.id ||
					existing.eventType !== "note_added" ||
					existing.note !== note
				)
					throw new ArrearsWorkflowError("IDEMPOTENCY_CONFLICT");
				return { cycle: writable.cycle, replayed: true };
			}
			if (writable.cycle.version !== input.expectedVersion) {
				throw new ArrearsWorkflowError("ARREARS_VERSION_CONFLICT");
			}
			const [cycle] = await tx
				.update(invoiceArrearsCycle)
				.set({ version: writable.cycle.version + 1 })
				.where(
					and(
						eq(invoiceArrearsCycle.organizationId, input.organizationId),
						eq(invoiceArrearsCycle.id, writable.cycle.id),
					),
				)
				.returning(cycleSelection);
			if (!cycle) throw new ArrearsWorkflowError("RESOURCE_UNAVAILABLE");
			await tx.insert(invoiceArrearsEvent).values({
				organizationId: input.organizationId,
				cycleId: cycle.id,
				eventType: "note_added",
				operatorUserId: input.operatorUserId,
				operatorName: writable.operatorName,
				note,
				sourceType: "manual",
				requestId: input.requestId,
			});
			return { cycle, replayed: false };
		});
	} catch (error) {
		if (error instanceof ArrearsWorkflowError) throw error;
		const databaseError = getDatabaseError(error);
		if (databaseError?.code === "23505")
			throw new ArrearsWorkflowError("IDEMPOTENCY_CONFLICT");
		throw error;
	}
}
