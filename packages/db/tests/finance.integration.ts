import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import {
	adjustInvoiceResultSchema,
	createManualInvoiceResultSchema,
	createPaymentResultSchema,
	invoiceDetailSchema,
	invoiceListResultSchema,
	studentTimelineResultSchema,
} from "../../api/src/contracts/training";
import {
	addArrearsNote,
	getArrearsDetail,
	listArrears,
	listEnrollmentAdjustments,
	renewEnrollment,
	transferEnrollment,
	transitionArrears,
} from "../../api/src/repositories/enrollment-finance-adjustments";
import {
	adjustInvoice,
	createManualInvoice,
	createPayment,
	getInvoiceDetail,
	getManualInvoiceOptions,
	listInvoices,
} from "../../api/src/repositories/finance";
import {
	cancelRefundRequest,
	createRefundRequest,
	decideRefundRequest,
	listRefundRequests,
} from "../../api/src/repositories/refund-approval";
import { getStudentTimeline } from "../../api/src/repositories/students";
import { getTrainingDashboardSnapshot } from "../../api/src/repositories/training-dashboard";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import { startArrearsCycleIfNeeded } from "../src/repositories/arrears-workflow";
import { backfillInvoiceMetricFacts } from "../src/repositories/invoice-metric-facts";
import { listOrganizationAuditEvents } from "../src/repositories/operations";
import {
	campus,
	course,
	enrollment,
	enrollmentPurchaseCycle,
	enrollmentRenewal,
	enrollmentTransfer,
	invoice,
	invoiceAdjustment,
	invoiceArrearsCycle,
	invoiceArrearsEvent,
	invoiceFollowUp,
	invoiceMetricFact,
	manualInvoiceCreation,
	organization,
	organizationAuditEvent,
	organizationMember,
	payment,
	refund,
	refundRequest,
	refundRequestEvent,
	session,
	student,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `finance-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseB: randomUUID(),
		courseTransfer: randomUUID(),
		studentA: randomUUID(),
		studentB: randomUUID(),
		enrollmentMain: randomUUID(),
		enrollmentConcurrent: randomUUID(),
		enrollmentIdempotent: randomUUID(),
		enrollmentB: randomUUID(),
		invoiceMain: randomUUID(),
		invoiceConcurrent: randomUUID(),
		invoiceIdempotent: randomUUID(),
		invoiceLegacyOverdue: randomUUID(),
		invoiceHistoricalPartial: randomUUID(),
		invoiceHistoricalPaid: randomUUID(),
		invoiceHistoricalStatusPaid: randomUUID(),
		invoiceRefunded: randomUUID(),
		invoiceB: randomUUID(),
		owner: `${prefix}-owner`,
		admin: `${prefix}-admin`,
		campusManager: `${prefix}-campus-manager`,
		finance: `${prefix}-finance`,
		consultant: `${prefix}-consultant`,
		teacher: `${prefix}-teacher`,
		ownerB: `${prefix}-owner-b`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function getUserIds(ids: FixtureIds) {
	return [
		ids.owner,
		ids.admin,
		ids.campusManager,
		ids.finance,
		ids.consultant,
		ids.teacher,
		ids.ownerB,
	];
}

function getSessionId(userId: string) {
	return `${userId}-session`;
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	await db
		.delete(invoiceArrearsEvent)
		.where(inArray(invoiceArrearsEvent.organizationId, organizationIds));
	await db
		.delete(invoiceArrearsCycle)
		.where(inArray(invoiceArrearsCycle.organizationId, organizationIds));
	await db
		.delete(refundRequestEvent)
		.where(inArray(refundRequestEvent.organizationId, organizationIds));
	await db
		.delete(refundRequest)
		.where(inArray(refundRequest.organizationId, organizationIds));
	await db
		.delete(invoiceAdjustment)
		.where(inArray(invoiceAdjustment.organizationId, organizationIds));
	await db
		.delete(manualInvoiceCreation)
		.where(inArray(manualInvoiceCreation.organizationId, organizationIds));
	await db
		.delete(invoiceFollowUp)
		.where(inArray(invoiceFollowUp.organizationId, organizationIds));
	await db
		.delete(organizationAuditEvent)
		.where(inArray(organizationAuditEvent.organizationId, organizationIds));
	await db
		.delete(refund)
		.where(inArray(refund.organizationId, organizationIds));
	await db
		.delete(enrollmentPurchaseCycle)
		.where(inArray(enrollmentPurchaseCycle.organizationId, organizationIds));
	await db
		.delete(enrollmentTransfer)
		.where(inArray(enrollmentTransfer.organizationId, organizationIds));
	await db
		.delete(enrollmentRenewal)
		.where(inArray(enrollmentRenewal.organizationId, organizationIds));
	await db
		.delete(payment)
		.where(inArray(payment.organizationId, organizationIds));
	await db
		.delete(invoice)
		.where(inArray(invoice.organizationId, organizationIds));
	await db
		.delete(enrollment)
		.where(inArray(enrollment.organizationId, organizationIds));
	await db
		.delete(student)
		.where(inArray(student.organizationId, organizationIds));
	await db
		.delete(course)
		.where(inArray(course.organizationId, organizationIds));
	await db
		.delete(campus)
		.where(inArray(campus.organizationId, organizationIds));
	await db
		.delete(organizationMember)
		.where(inArray(organizationMember.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db.delete(user).where(inArray(user.id, getUserIds(ids)));
}

async function seedFixture(ids: FixtureIds) {
	const userIds = getUserIds(ids);
	await db.insert(user).values(
		userIds.map((id, index) => ({
			id,
			name: `财务测试用户 ${index}`,
			email: `${id}@example.invalid`,
		})),
	);
	const now = new Date();
	await db.insert(session).values(
		userIds.map((userId) => ({
			id: getSessionId(userId),
			token: `${getSessionId(userId)}-token`,
			userId,
			expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
			updatedAt: now,
		})),
	);
	await db.insert(organization).values([
		{ id: ids.organizationA, name: `${ids.prefix} A` },
		{ id: ids.organizationB, name: `${ids.prefix} B` },
	]);
	await db.insert(organizationMember).values([
		{ organizationId: ids.organizationA, userId: ids.owner, role: "owner" },
		{ organizationId: ids.organizationA, userId: ids.admin, role: "admin" },
		{
			organizationId: ids.organizationA,
			userId: ids.campusManager,
			role: "campus_manager",
		},
		{ organizationId: ids.organizationA, userId: ids.finance, role: "finance" },
		{
			organizationId: ids.organizationA,
			userId: ids.consultant,
			role: "consultant",
		},
		{ organizationId: ids.organizationA, userId: ids.teacher, role: "teacher" },
		{ organizationId: ids.organizationB, userId: ids.ownerB, role: "owner" },
	]);
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a`,
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationB,
			code: `${ids.prefix}-b`,
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	await db.insert(course).values([
		{
			id: ids.courseA,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-course-a`,
			name: "A 课程",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 10_000,
			lessonsPerPackage: 10,
			tags: [],
		},
		{
			id: ids.courseB,
			organizationId: ids.organizationB,
			code: `${ids.prefix}-course-b`,
			name: "B 课程",
			category: "stem",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_999,
			lessonsPerPackage: 10,
			tags: [],
		},
		{
			id: ids.courseTransfer,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-course-transfer`,
			name: "转入课程",
			category: "art",
			level: "L2",
			durationMinutes: 60,
			listPriceInCents: 12_000,
			lessonsPerPackage: 12,
			tags: [],
		},
	]);
	await db.insert(student).values([
		{
			id: ids.studentA,
			organizationId: ids.organizationA,
			campusId: ids.campusA,
			name: "A 学员",
			guardianName: "A 家长",
			guardianPhone: "13800000000",
			status: "active",
		},
		{
			id: ids.studentB,
			organizationId: ids.organizationB,
			campusId: ids.campusB,
			name: "B 学员",
			guardianName: "B 家长",
			guardianPhone: "13900000000",
			status: "active",
		},
	]);
	await db.insert(enrollment).values([
		{
			id: ids.enrollmentMain,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			courseId: ids.courseA,
			purchasedLessons: 10,
			remainingLessons: 10,
			amountInCents: 10_000,
		},
		{
			id: ids.enrollmentConcurrent,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			courseId: ids.courseA,
			purchasedLessons: 10,
			remainingLessons: 10,
			amountInCents: 10_000,
		},
		{
			id: ids.enrollmentIdempotent,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			courseId: ids.courseA,
			purchasedLessons: 3,
			remainingLessons: 3,
			amountInCents: 3_000,
		},
		{
			id: ids.enrollmentB,
			organizationId: ids.organizationB,
			studentId: ids.studentB,
			courseId: ids.courseB,
			purchasedLessons: 10,
			remainingLessons: 10,
			amountInCents: 9_999,
		},
	]);
	await db.insert(invoice).values([
		{
			id: ids.invoiceMain,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentMain,
			amountInCents: 10_000,
			status: "pending",
			dueDate: "2000-01-01",
		},
		{
			id: ids.invoiceConcurrent,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentConcurrent,
			amountInCents: 10_000,
			status: "pending",
			dueDate: "2099-01-01",
		},
		{
			id: ids.invoiceIdempotent,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentIdempotent,
			amountInCents: 3_000,
			status: "pending",
			dueDate: "2099-01-02",
		},
		{
			id: ids.invoiceLegacyOverdue,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 5_000,
			status: "overdue",
			dueDate: "2099-01-03",
		},
		{
			id: ids.invoiceHistoricalPartial,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 5_000,
			paidAmountInCents: 2_000,
			status: "pending",
			dueDate: "2099-01-04",
		},
		{
			id: ids.invoiceHistoricalPaid,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 5_000,
			paidAmountInCents: 5_000,
			status: "pending",
			dueDate: "2099-01-05",
		},
		{
			id: ids.invoiceHistoricalStatusPaid,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 7_000,
			paidAmountInCents: 0,
			status: "paid",
			dueDate: "2099-01-06",
		},
		{
			id: ids.invoiceRefunded,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 8_000,
			status: "refunded",
			dueDate: "2000-01-01",
		},
		{
			id: ids.invoiceB,
			organizationId: ids.organizationB,
			studentId: ids.studentB,
			enrollmentId: ids.enrollmentB,
			amountInCents: 9_999,
			status: "pending",
			dueDate: "2000-01-01",
		},
	]);
	for (const invoiceId of [
		ids.invoiceMain,
		ids.invoiceConcurrent,
		ids.invoiceIdempotent,
		ids.invoiceLegacyOverdue,
		ids.invoiceHistoricalPartial,
		ids.invoiceHistoricalStatusPaid,
		ids.invoiceB,
	]) {
		const organizationId =
			invoiceId === ids.invoiceB ? ids.organizationB : ids.organizationA;
		await db.transaction((tx) =>
			startArrearsCycleIfNeeded(tx, {
				organizationId,
				invoiceId,
				sourceType: "test_fixture",
				sourceId: invoiceId,
				occurredAt: new Date(),
			}),
		);
	}
}

async function expectOrpcError(promise: Promise<unknown>, code: string) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(typeof error === "object" && error !== null && "code" in error);
		assert.equal(error.code, code);
		return true;
	});
}

function createSessionClient(
	userId: string,
	name: string,
	expectedOrganizationId: string,
) {
	return createRouterClient(appRouter, {
		context: {
			auth: null,
			session: {
				session: { id: getSessionId(userId) },
				user: { id: userId, name },
			},
			expectedOrganizationId,
		} as unknown as Context,
	});
}

function minutesAgo(minutes: number): string {
	return new Date(Date.now() - minutes * 60_000).toISOString();
}

test("财务账单、收款事务、幂等、租户与角色边界保持一致", async () => {
	const ids = createFixtureIds();
	const financeScope = {
		organizationId: ids.organizationA,
		userId: ids.finance,
	};

	try {
		await seedFixture(ids);

		const initialList = invoiceListResultSchema.parse(
			await listInvoices(financeScope, { status: "all", pageSize: 50 }),
		);
		assert.equal(initialList.total, 8);
		assert.ok(
			initialList.items.some((item) => item.id === ids.invoiceRefunded),
		);
		assert.ok(initialList.items.every((item) => item.id !== ids.invoiceB));
		assert.deepEqual(
			initialList.items.find(
				(item) => item.id === ids.invoiceLegacyOverdue,
			) && {
				status: initialList.items.find(
					(item) => item.id === ids.invoiceLegacyOverdue,
				)?.status,
				isOverdue: initialList.items.find(
					(item) => item.id === ids.invoiceLegacyOverdue,
				)?.isOverdue,
			},
			{ status: "pending", isOverdue: true },
		);
		assert.equal(
			initialList.items.find((item) => item.id === ids.invoiceMain)?.isOverdue,
			true,
		);
		const historicalPartialList = await listInvoices(financeScope, {
			status: "partial",
			pageSize: 50,
		});
		assert.ok(
			historicalPartialList.items.some(
				(item) => item.id === ids.invoiceHistoricalPartial,
			),
		);
		const historicalPaidList = await listInvoices(financeScope, {
			status: "paid",
			pageSize: 50,
		});
		assert.ok(
			historicalPaidList.items.some(
				(item) => item.id === ids.invoiceHistoricalPaid,
			),
		);
		assert.ok(
			historicalPaidList.items.some(
				(item) => item.id === ids.invoiceHistoricalStatusPaid,
			),
		);
		const historicalDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, {
				id: ids.invoiceHistoricalPartial,
			}),
		);
		assert.equal(historicalDetail.invoice.status, "partial");
		assert.equal(historicalDetail.historicalPaidAmountInCents, 2_000);
		assert.equal(historicalDetail.payments.length, 0);
		const historicalStatusPaidDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, {
				id: ids.invoiceHistoricalStatusPaid,
			}),
		);
		assert.equal(historicalStatusPaidDetail.invoice.status, "paid");
		assert.equal(historicalStatusPaidDetail.invoice.paidAmountInCents, 7_000);
		assert.equal(
			historicalStatusPaidDetail.invoice.outstandingAmountInCents,
			0,
		);
		assert.equal(historicalStatusPaidDetail.historicalPaidAmountInCents, 7_000);

		await expectOrpcError(
			getInvoiceDetail(financeScope, { id: ids.invoiceB }),
			"NOT_FOUND",
		);
		const refundedDetail = await getInvoiceDetail(financeScope, {
			id: ids.invoiceRefunded,
		});
		assert.equal(refundedDetail.invoice.status, "refunded");
		const openList = await listInvoices(financeScope, {
			status: "open",
			pageSize: 50,
		});
		assert.ok(openList.items.every((item) => item.id !== ids.invoiceRefunded));
		await expectOrpcError(
			createPayment(financeScope, {
				invoiceId: ids.invoiceB,
				amountInCents: 1,
				receivedAt: minutesAgo(60),
				method: "cash",
				referenceNo: null,
				note: null,
				requestId: randomUUID(),
			}),
			"NOT_FOUND",
		);
		await expectOrpcError(
			createPayment(financeScope, {
				invoiceId: ids.invoiceMain,
				amountInCents: 1,
				receivedAt: "2099-01-01T08:00:00.000+08:00",
				method: "cash",
				referenceNo: null,
				note: null,
				requestId: randomUUID(),
			}),
			"BAD_REQUEST",
		);

		const firstRequestId = randomUUID();
		const firstInput = {
			invoiceId: ids.invoiceMain,
			amountInCents: 4_000,
			receivedAt: minutesAgo(30),
			method: "bankTransfer" as const,
			referenceNo: "BANK-001",
			note: "首笔部分收款",
			requestId: firstRequestId,
		};
		const firstResult = createPaymentResultSchema.parse(
			await createPayment(financeScope, firstInput),
		);
		assert.equal(firstResult.payment.method, "bankTransfer");
		assert.equal(firstResult.payment.operatorName, "财务测试用户 3");
		const firstDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: ids.invoiceMain }),
		);
		assert.equal(firstDetail.invoice.status, "partial");
		assert.equal(firstDetail.invoice.paidAmountInCents, 4_000);
		assert.equal(firstDetail.invoice.outstandingAmountInCents, 6_000);

		const replayResult = createPaymentResultSchema.parse(
			await createPayment(financeScope, firstInput),
		);
		assert.deepEqual(replayResult, firstResult);
		const firstPaymentRows = await db
			.select()
			.from(payment)
			.where(
				and(
					eq(payment.organizationId, ids.organizationA),
					eq(payment.requestId, firstRequestId),
				),
			);
		assert.equal(firstPaymentRows.length, 1);
		assert.equal(firstPaymentRows[0]?.operatorUserId, ids.finance);
		assert.equal(firstPaymentRows[0]?.method, "bank_transfer");
		const firstPaymentAuditEvents = await db
			.select({
				action: organizationAuditEvent.action,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				actorUserId: organizationAuditEvent.actorUserId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationA),
					eq(organizationAuditEvent.entityId, firstResult.payment.id),
				),
			);
		assert.deepEqual(firstPaymentAuditEvents, [
			{
				action: "payment_created",
				entityType: "payment",
				entityId: firstResult.payment.id,
				actorUserId: ids.finance,
				campusId: ids.campusA,
				after: {
					invoiceId: ids.invoiceMain,
					enrollmentId: ids.enrollmentMain,
					amountInCents: 4_000,
					method: "bank_transfer",
					paidAt: new Date(firstInput.receivedAt).toISOString(),
					requestId: firstRequestId,
				},
			},
		]);
		const paymentAuditForCampus = await listOrganizationAuditEvents({
			organizationId: ids.organizationA,
			campusAccess: { kind: "selected", campusIds: [ids.campusA] },
			action: "payment_created",
			pageSize: 10,
		});
		assert.deepEqual(
			paymentAuditForCampus.items.map((item) => item.entityId),
			[firstResult.payment.id],
		);

		await expectOrpcError(
			createPayment(financeScope, { ...firstInput, amountInCents: 3_999 }),
			"CONFLICT",
		);
		await expectOrpcError(
			createPayment(financeScope, {
				...firstInput,
				amountInCents: 6_001,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		const settledReceivedAt = minutesAgo(20);
		createPaymentResultSchema.parse(
			await createPayment(financeScope, {
				invoiceId: ids.invoiceMain,
				amountInCents: 6_000,
				receivedAt: settledReceivedAt,
				method: "wechat",
				referenceNo: null,
				note: null,
				requestId: randomUUID(),
			}),
		);
		const settledDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: ids.invoiceMain }),
		);
		assert.equal(settledDetail.invoice.status, "paid");
		assert.equal(settledDetail.invoice.outstandingAmountInCents, 0);
		await db
			.update(user)
			.set({ name: "财务测试用户（已改名）" })
			.where(eq(user.id, ids.finance));
		const replayAfterSettlement = createPaymentResultSchema.parse(
			await createPayment(financeScope, firstInput),
		);
		assert.deepEqual(replayAfterSettlement, firstResult);

		const [settledInvoice, settledEnrollment] = await Promise.all([
			db
				.select()
				.from(invoice)
				.where(eq(invoice.id, ids.invoiceMain))
				.then((rows) => rows[0]),
			db
				.select()
				.from(enrollment)
				.where(eq(enrollment.id, ids.enrollmentMain))
				.then((rows) => rows[0]),
		]);
		assert.equal(settledInvoice?.paidAmountInCents, 10_000);
		assert.equal(settledInvoice?.paidAt?.toISOString(), settledReceivedAt);
		assert.equal(settledEnrollment?.paidAmountInCents, 10_000);
		const immutablePayments = await db
			.select({ amountInCents: payment.amountInCents })
			.from(payment)
			.where(eq(payment.invoiceId, ids.invoiceMain));
		assert.deepEqual(
			new Set(immutablePayments.map((item) => item.amountInCents)),
			new Set([4_000, 6_000]),
		);

		const concurrentResults = await Promise.allSettled(
			[0, 1].map((index) =>
				createPayment(financeScope, {
					invoiceId: ids.invoiceConcurrent,
					amountInCents: 6_000,
					receivedAt: minutesAgo(10 - index),
					method: "alipay",
					referenceNo: null,
					note: null,
					requestId: randomUUID(),
				}),
			),
		);
		assert.equal(
			concurrentResults.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		assert.equal(
			concurrentResults.filter((result) => result.status === "rejected").length,
			1,
		);
		const [concurrentInvoice] = await db
			.select()
			.from(invoice)
			.where(eq(invoice.id, ids.invoiceConcurrent));
		assert.equal(concurrentInvoice?.paidAmountInCents, 6_000);
		assert.equal(concurrentInvoice?.status, "partial");
		assert.equal(concurrentInvoice?.paidAt, null);

		const idempotentRequestId = randomUUID();
		const idempotentInput = {
			invoiceId: ids.invoiceIdempotent,
			amountInCents: 1_000,
			receivedAt: minutesAgo(5),
			method: "cash" as const,
			referenceNo: null,
			note: null,
			requestId: idempotentRequestId,
		};
		const idempotentResults = await Promise.all([
			createPayment(financeScope, idempotentInput),
			createPayment(financeScope, idempotentInput),
		]);
		assert.equal(
			idempotentResults[0]?.payment.id,
			idempotentResults[1]?.payment.id,
		);
		const idempotentRows = await db
			.select({ id: payment.id })
			.from(payment)
			.where(eq(payment.requestId, idempotentRequestId));
		assert.equal(idempotentRows.length, 1);

		const detail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: ids.invoiceMain }),
		);
		assert.equal(detail.payments.length, 2);
		assert.ok(
			detail.payments.every(
				(paymentRecord) => paymentRecord.operatorName === "财务测试用户 3",
			),
		);
		assert.equal(detail.historicalPaidAmountInCents, 0);
		assert.equal(detail.invoice.status, "paid");

		const dashboard = await getTrainingDashboardSnapshot({
			organizationId: ids.organizationA,
			userId: ids.owner,
			role: "owner",
		});
		assert.equal(dashboard.metrics.pendingInvoiceCount, 4);
		assert.equal(dashboard.metrics.outstandingAmountInCents, 14_000);

		for (const [userId, name] of [
			[ids.owner, "owner"],
			[ids.admin, "admin"],
			[ids.campusManager, "campus_manager"],
			[ids.finance, "finance"],
		] as const) {
			const client = createSessionClient(userId, name, ids.organizationA);
			const result = await client.training.finance.invoices.list({
				status: "open",
			});
			assert.equal(result.total, 4);
		}
		const pagedClient = createSessionClient(
			ids.finance,
			"finance",
			ids.organizationA,
		);
		const firstInvoicePage = await pagedClient.training.finance.invoices.list({
			status: "open",
			pageSize: 2,
		});
		assert.equal(firstInvoicePage.items.length, 2);
		assert.ok(firstInvoicePage.nextCursor);
		const secondInvoicePage = await pagedClient.training.finance.invoices.list({
			status: "open",
			pageSize: 2,
			cursor: firstInvoicePage.nextCursor ?? undefined,
		});
		assert.equal(secondInvoicePage.items.length, 2);
		assert.equal(secondInvoicePage.nextCursor, null);
		assert.equal(
			new Set([
				...firstInvoicePage.items.map((item) => item.id),
				...secondInvoicePage.items.map((item) => item.id),
			]).size,
			4,
		);

		for (const [userId, name] of [
			[ids.consultant, "consultant"],
			[ids.teacher, "teacher"],
		] as const) {
			const client = createSessionClient(userId, name, ids.organizationA);
			await expectOrpcError(
				client.training.finance.invoices.list({ status: "open" }),
				"FORBIDDEN",
			);
		}

		const staleOrganizationClient = createSessionClient(
			ids.finance,
			"finance",
			ids.organizationB,
		);
		await expectOrpcError(
			staleOrganizationClient.training.finance.invoices.list({
				status: "open",
			}),
			"CONFLICT",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("手工开单与账单调整保持幂等、版本和报名金额隔离", async () => {
	const ids = createFixtureIds();
	const financeScope = {
		organizationId: ids.organizationA,
		userId: ids.finance,
		campusAccess: { kind: "all" } as const,
	};

	try {
		await seedFixture(ids);
		const sameNameStudentIds = [randomUUID(), randomUUID()].sort();
		await db.insert(student).values(
			sameNameStudentIds.map((id, index) => ({
				id,
				organizationId: ids.organizationA,
				campusId: ids.campusA,
				name: "同名分页学员",
				guardianName: `分页家长 ${index}`,
				guardianPhone: `1370000000${index}`,
				status: "active" as const,
			})),
		);
		const firstOptionsPage = await getManualInvoiceOptions(financeScope, {
			query: "同名分页学员",
			pageSize: 1,
		});
		assert.equal(firstOptionsPage.students.length, 1);
		assert.equal(firstOptionsPage.students[0]?.id, sameNameStudentIds[0]);
		assert.ok(firstOptionsPage.nextCursor);
		const secondOptionsPage = await getManualInvoiceOptions(financeScope, {
			query: "同名分页学员",
			cursor: firstOptionsPage.nextCursor ?? undefined,
			pageSize: 1,
		});
		assert.equal(secondOptionsPage.students.length, 1);
		assert.equal(secondOptionsPage.students[0]?.id, sameNameStudentIds[1]);
		assert.equal(secondOptionsPage.nextCursor, null);
		assert.notEqual(
			firstOptionsPage.students[0]?.id,
			secondOptionsPage.students[0]?.id,
		);
		await expectOrpcError(
			getManualInvoiceOptions(financeScope, {
				cursor: "not-a-valid-cursor",
				pageSize: 1,
			}),
			"BAD_REQUEST",
		);
		const options = await getManualInvoiceOptions(financeScope, {
			query: "A 学员",
			pageSize: 20,
		});
		const option = options.students.find((item) => item.id === ids.studentA);
		assert.ok(option);
		assert.ok(
			option.enrollments.some((item) => item.id === ids.enrollmentIdempotent),
		);

		const createRequestId = randomUUID();
		const createInput = {
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentIdempotent,
			businessActivityType: "material_fee" as const,
			summary: "秋季教材费",
			amountInCents: 5_000,
			dueDate: "2099-03-01",
			requestId: createRequestId,
		};
		const created = createManualInvoiceResultSchema.parse(
			await createManualInvoice(financeScope, createInput),
		);
		const replay = createManualInvoiceResultSchema.parse(
			await createManualInvoice(financeScope, createInput),
		);
		assert.equal(replay.invoiceId, created.invoiceId);
		assert.equal(replay.replayed, true);
		const [manualMetricFact] = await db
			.select({
				campusId: invoiceMetricFact.campusId,
				courseId: invoiceMetricFact.courseId,
				courseAttributionKind: invoiceMetricFact.courseAttributionKind,
				source: invoiceMetricFact.source,
			})
			.from(invoiceMetricFact)
			.where(eq(invoiceMetricFact.invoiceId, created.invoiceId));
		assert.deepEqual(manualMetricFact, {
			campusId: ids.campusA,
			courseId: ids.courseA,
			courseAttributionKind: "linked",
			source: "manual",
		});
		await db
			.delete(invoiceMetricFact)
			.where(eq(invoiceMetricFact.invoiceId, created.invoiceId));
		await backfillInvoiceMetricFacts({ organizationId: ids.organizationA });
		const [derivedManualMetricFact] = await db
			.select({
				campusId: invoiceMetricFact.campusId,
				campusNameSnapshot: invoiceMetricFact.campusNameSnapshot,
				courseId: invoiceMetricFact.courseId,
				courseNameSnapshot: invoiceMetricFact.courseNameSnapshot,
				provenance: invoiceMetricFact.provenance,
			})
			.from(invoiceMetricFact)
			.where(eq(invoiceMetricFact.invoiceId, created.invoiceId));
		assert.deepEqual(derivedManualMetricFact, {
			campusId: ids.campusA,
			campusNameSnapshot: null,
			courseId: ids.courseA,
			courseNameSnapshot: null,
			provenance: "derived",
		});
		await expectOrpcError(
			createManualInvoice(financeScope, {
				...createInput,
				summary: "不同教材费",
			}),
			"CONFLICT",
		);

		const initialDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: created.invoiceId }),
		);
		assert.equal(initialDetail.invoice.source, "manual");
		assert.equal(initialDetail.invoice.businessActivityType, "material_fee");
		assert.equal(initialDetail.invoice.summary, "秋季教材费");
		assert.equal(initialDetail.invoice.createdByName, "财务测试用户 3");
		assert.equal(initialDetail.invoice.version, 1);
		assert.equal(initialDetail.capabilities.canAdjustAmount, true);

		const adjustmentRequestId = randomUUID();
		const firstAdjustmentInput = {
			invoiceId: created.invoiceId,
			amountInCents: 6_000,
			dueDate: "2099-03-15",
			summary: "秋季教材及资料费",
			reason: "补充资料包",
			expectedVersion: 1,
			requestId: adjustmentRequestId,
		};
		const firstAdjustment = adjustInvoiceResultSchema.parse(
			await adjustInvoice(financeScope, firstAdjustmentInput),
		);
		assert.equal(firstAdjustment.adjustment.afterVersion, 2);
		assert.equal(
			adjustInvoiceResultSchema.parse(
				await adjustInvoice(financeScope, firstAdjustmentInput),
			).replayed,
			true,
		);
		await expectOrpcError(
			adjustInvoice(financeScope, {
				invoiceId: created.invoiceId,
				dueDate: "2099-03-20",
				reason: "陈旧版本尝试",
				expectedVersion: 1,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		await createPayment(financeScope, {
			invoiceId: created.invoiceId,
			amountInCents: 1_000,
			receivedAt: minutesAgo(5),
			method: "wechat",
			referenceNo: null,
			note: null,
			requestId: randomUUID(),
		});
		const [enrollmentAfterManualPayment] = await db
			.select({ paidAmountInCents: enrollment.paidAmountInCents })
			.from(enrollment)
			.where(eq(enrollment.id, ids.enrollmentIdempotent));
		assert.equal(enrollmentAfterManualPayment?.paidAmountInCents, 0);

		adjustInvoiceResultSchema.parse(
			await adjustInvoice(financeScope, {
				invoiceId: created.invoiceId,
				dueDate: "2099-04-01",
				summary: "秋季教材及资料费（延期）",
				reason: "家长申请延期",
				expectedVersion: 2,
				requestId: randomUUID(),
			}),
		);
		await expectOrpcError(
			adjustInvoice(financeScope, {
				invoiceId: created.invoiceId,
				amountInCents: 7_000,
				reason: "错误尝试调整金额",
				expectedVersion: 3,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		const detail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: created.invoiceId }),
		);
		assert.equal(detail.invoice.amountInCents, 6_000);
		assert.equal(detail.invoice.dueDate, "2099-04-01");
		assert.equal(detail.invoice.version, 3);
		assert.equal(detail.invoice.status, "partial");
		assert.equal(detail.capabilities.canAdjustAmount, false);
		assert.equal(detail.capabilities.canAdjustDueDate, true);
		assert.equal(detail.adjustments.length, 2);
		assert.equal(detail.adjustments[0]?.reason, "家长申请延期");

		const matchingList = await listInvoices(financeScope, {
			query: "秋季教材",
			status: "all",
			pageSize: 50,
		});
		assert.ok(matchingList.items.some((item) => item.id === created.invoiceId));
		const manualArrears = (
			await listArrears(financeScope, { pageSize: 50 })
		).items.find((item) => item.invoiceId === created.invoiceId);
		assert.equal(manualArrears?.source, "manual");
		assert.equal(manualArrears?.summary, "秋季教材及资料费（延期）");
		const dashboard = await getTrainingDashboardSnapshot({
			...financeScope,
			role: "finance",
		});
		assert.equal(dashboard.metrics.pendingInvoiceCount, 6);
		assert.equal(dashboard.metrics.outstandingAmountInCents, 36_000);
		const timeline = studentTimelineResultSchema.parse(
			await getStudentTimeline(
				{
					organizationId: ids.organizationA,
					userId: ids.owner,
					role: "owner",
					campusAccess: { kind: "all" },
				},
				{ studentId: ids.studentA, pageSize: 50 },
			),
		);
		const manualTimelineItem = timeline.items.find(
			(item) =>
				item.kind === "invoice_issued" &&
				item.source.type === "invoice" &&
				item.source.invoiceId === created.invoiceId,
		);
		assert.equal(manualTimelineItem?.invoiceSource, "manual");
		assert.equal(
			manualTimelineItem?.invoiceSummary,
			"秋季教材及资料费（延期）",
		);

		const creationRows = await db
			.select({ id: manualInvoiceCreation.id })
			.from(manualInvoiceCreation)
			.where(eq(manualInvoiceCreation.requestId, createRequestId));
		assert.equal(creationRows.length, 1);
		const adjustmentRows = await db
			.select({ id: invoiceAdjustment.id })
			.from(invoiceAdjustment)
			.where(eq(invoiceAdjustment.invoiceId, created.invoiceId));
		assert.equal(adjustmentRows.length, 2);
		const auditRows = await db
			.select({
				action: organizationAuditEvent.action,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationA),
					inArray(organizationAuditEvent.action, [
						"manual_invoice_created",
						"invoice_adjusted",
					]),
				),
			);
		assert.equal(auditRows.length, 3);
		assert.ok(
			auditRows.every(
				(item) =>
					!JSON.stringify(item.after).includes("家长申请延期") &&
					!JSON.stringify(item.after).includes("秋季教材"),
			),
		);

		await db
			.update(enrollment)
			.set({ status: "frozen" })
			.where(eq(enrollment.id, ids.enrollmentConcurrent));
		createManualInvoiceResultSchema.parse(
			await createManualInvoice(financeScope, {
				...createInput,
				enrollmentId: ids.enrollmentConcurrent,
				requestId: randomUUID(),
			}),
		);
		await db
			.update(enrollment)
			.set({ status: "transferred" })
			.where(eq(enrollment.id, ids.enrollmentConcurrent));
		await expectOrpcError(
			createManualInvoice(financeScope, {
				...createInput,
				enrollmentId: ids.enrollmentConcurrent,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			createManualInvoice(financeScope, {
				...createInput,
				studentId: ids.studentB,
				enrollmentId: null,
				requestId: randomUUID(),
			}),
			"NOT_FOUND",
		);
		await db
			.update(campus)
			.set({ isActive: false })
			.where(eq(campus.id, ids.campusA));
		await expectOrpcError(
			createManualInvoice(financeScope, {
				...createInput,
				enrollmentId: null,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await db
			.update(campus)
			.set({ isActive: true })
			.where(eq(campus.id, ids.campusA));
		await db
			.delete(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.finance),
				),
			);
		await expectOrpcError(
			createManualInvoice(financeScope, {
				...createInput,
				enrollmentId: null,
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("续费、转课、退费与欠费跟进保持课时和资金历史可追溯", async () => {
	const ids = createFixtureIds();
	const financeScope = {
		organizationId: ids.organizationA,
		userId: ids.finance,
		campusAccess: { kind: "all" } as const,
	};

	try {
		await seedFixture(ids);

		const adjustmentList = await listEnrollmentAdjustments(financeScope);
		assert.ok(
			adjustmentList.items.some((item) => item.id === ids.enrollmentIdempotent),
		);
		assert.ok(
			adjustmentList.courses.some((item) => item.id === ids.courseTransfer),
		);

		const renewalRequestId = randomUUID();
		const renewalInput = {
			enrollmentId: ids.enrollmentIdempotent,
			addedLessons: 2,
			amountInCents: 2_000,
			dueDate: "2099-02-01",
			requestId: renewalRequestId,
		};
		const [renewal, renewalReplay] = await Promise.all([
			renewEnrollment(financeScope, renewalInput),
			renewEnrollment(financeScope, renewalInput),
		]);
		assert.deepEqual(renewalReplay, renewal);
		const [renewedEnrollment] = await db
			.select()
			.from(enrollment)
			.where(eq(enrollment.id, ids.enrollmentIdempotent));
		assert.equal(renewedEnrollment?.purchasedLessons, 5);
		assert.equal(renewedEnrollment?.remainingLessons, 5);
		const renewalInvoices = await db
			.select({ id: invoice.id })
			.from(invoice)
			.where(eq(invoice.id, renewal.invoiceId));
		assert.equal(renewalInvoices.length, 1);
		const [renewalMetricFact] = await db
			.select({
				campusId: invoiceMetricFact.campusId,
				courseId: invoiceMetricFact.courseId,
				source: invoiceMetricFact.source,
			})
			.from(invoiceMetricFact)
			.where(eq(invoiceMetricFact.invoiceId, renewal.invoiceId));
		assert.deepEqual(renewalMetricFact, {
			campusId: ids.campusA,
			courseId: ids.courseA,
			source: "renewal",
		});
		const [renewalRecord] = await db
			.select({ id: enrollmentRenewal.id })
			.from(enrollmentRenewal)
			.where(eq(enrollmentRenewal.requestId, renewalRequestId));
		assert.ok(renewalRecord);
		const renewalCycles = await db
			.select({
				sequence: enrollmentPurchaseCycle.sequence,
				source: enrollmentPurchaseCycle.source,
				sourceRenewalId: enrollmentPurchaseCycle.sourceRenewalId,
				purchasedLessons: enrollmentPurchaseCycle.purchasedLessons,
				startingRemainingLessons:
					enrollmentPurchaseCycle.startingRemainingLessons,
			})
			.from(enrollmentPurchaseCycle)
			.where(
				eq(enrollmentPurchaseCycle.enrollmentId, ids.enrollmentIdempotent),
			);
		assert.deepEqual(renewalCycles, [
			{
				sequence: 1,
				source: "renewal",
				sourceRenewalId: renewalRecord.id,
				purchasedLessons: 2,
				startingRemainingLessons: 5,
			},
		]);
		const renewalAuditEvents = await db
			.select({
				action: organizationAuditEvent.action,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				actorUserId: organizationAuditEvent.actorUserId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.entityId, renewalRecord.id));
		assert.deepEqual(renewalAuditEvents, [
			{
				action: "enrollment_renewed",
				entityType: "enrollment_renewal",
				entityId: renewalRecord.id,
				actorUserId: ids.finance,
				campusId: ids.campusA,
				after: {
					enrollmentId: ids.enrollmentIdempotent,
					invoiceId: renewal.invoiceId,
					addedLessons: 2,
					amountInCents: 2_000,
					dueDate: "2099-02-01",
					requestId: renewalRequestId,
				},
			},
		]);
		await expectOrpcError(
			transferEnrollment(financeScope, {
				sourceEnrollmentId: ids.enrollmentConcurrent,
				targetCourseId: ids.courseTransfer,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		await createPayment(financeScope, {
			invoiceId: ids.invoiceMain,
			amountInCents: 10_000,
			receivedAt: minutesAgo(30),
			method: "wechat",
			referenceNo: null,
			note: null,
			requestId: randomUUID(),
		});
		const transferRequestId = randomUUID();
		const transfer = await transferEnrollment(financeScope, {
			sourceEnrollmentId: ids.enrollmentMain,
			targetCourseId: ids.courseTransfer,
			requestId: transferRequestId,
		});
		assert.equal(transfer.transferredLessons, 10);
		assert.deepEqual(
			await transferEnrollment(financeScope, {
				sourceEnrollmentId: ids.enrollmentMain,
				targetCourseId: ids.courseTransfer,
				requestId: transferRequestId,
			}),
			transfer,
		);
		const [sourceEnrollment, targetEnrollment] = await Promise.all([
			db.select().from(enrollment).where(eq(enrollment.id, ids.enrollmentMain)),
			db
				.select()
				.from(enrollment)
				.where(eq(enrollment.id, transfer.targetEnrollmentId)),
		]);
		assert.equal(sourceEnrollment[0]?.status, "transferred");
		assert.equal(sourceEnrollment[0]?.remainingLessons, 0);
		assert.equal(targetEnrollment[0]?.courseId, ids.courseTransfer);
		assert.equal(targetEnrollment[0]?.remainingLessons, 10);
		const [transferRecord] = await db
			.select({ id: enrollmentTransfer.id })
			.from(enrollmentTransfer)
			.where(
				eq(enrollmentTransfer.targetEnrollmentId, transfer.targetEnrollmentId),
			);
		assert.ok(transferRecord);
		const [transferCycle] = await db
			.select({
				sequence: enrollmentPurchaseCycle.sequence,
				source: enrollmentPurchaseCycle.source,
				sourceTransferId: enrollmentPurchaseCycle.sourceTransferId,
				purchasedLessons: enrollmentPurchaseCycle.purchasedLessons,
				startingRemainingLessons:
					enrollmentPurchaseCycle.startingRemainingLessons,
			})
			.from(enrollmentPurchaseCycle)
			.where(
				eq(enrollmentPurchaseCycle.enrollmentId, transfer.targetEnrollmentId),
			);
		assert.deepEqual(transferCycle, {
			sequence: 1,
			source: "transfer",
			sourceTransferId: transferRecord.id,
			purchasedLessons: 10,
			startingRemainingLessons: 10,
		});
		const transferAuditEvents = await db
			.select({
				action: organizationAuditEvent.action,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				actorUserId: organizationAuditEvent.actorUserId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.entityId, transferRecord.id));
		assert.deepEqual(transferAuditEvents, [
			{
				action: "enrollment_transferred",
				entityType: "enrollment_transfer",
				entityId: transferRecord.id,
				actorUserId: ids.finance,
				campusId: ids.campusA,
				after: {
					sourceEnrollmentId: ids.enrollmentMain,
					targetEnrollmentId: transfer.targetEnrollmentId,
					targetCourseId: ids.courseTransfer,
					transferredLessons: 10,
					requestId: transferRequestId,
				},
			},
		]);

		const refundRequestId = randomUUID();
		const refundedAt = minutesAgo(20);
		const refundInput = {
			invoiceId: ids.invoiceMain,
			amountInCents: 4_000,
			refundedAt,
			method: "wechat" as const,
			reason: "转课后退回差额",
			requestId: refundRequestId,
		};
		const firstRefundRequest = await createRefundRequest(
			financeScope,
			refundInput,
		);
		assert.equal(firstRefundRequest.request.amountInCents, 4_000);
		assert.equal(
			(await createRefundRequest(financeScope, refundInput)).request.id,
			firstRefundRequest.request.id,
		);
		await expectOrpcError(
			createRefundRequest(financeScope, {
				...refundInput,
				invoiceId: ids.invoiceHistoricalStatusPaid,
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			createRefundRequest(financeScope, {
				...refundInput,
				refundedAt: minutesAgo(19),
			}),
			"CONFLICT",
		);
		const firstApprovalRequestId = randomUUID();
		const firstApproval = await decideRefundRequest(
			{
				organizationId: ids.organizationA,
				userId: ids.owner,
				campusAccess: { kind: "all" },
			},
			{
				refundRequestId: firstRefundRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: firstRefundRequest.request.version,
				requestId: firstApprovalRequestId,
			},
		);
		assert.ok(firstApproval.request.refundId);
		const refundAuditEvents = await db
			.select({
				action: organizationAuditEvent.action,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				actorUserId: organizationAuditEvent.actorUserId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				eq(
					organizationAuditEvent.entityId,
					firstApproval.request.refundId ?? "",
				),
			);
		assert.deepEqual(refundAuditEvents, [
			{
				action: "refund_created",
				entityType: "refund",
				entityId: firstApproval.request.refundId,
				actorUserId: ids.owner,
				campusId: ids.campusA,
				after: {
					invoiceId: ids.invoiceMain,
					enrollmentId: ids.enrollmentMain,
					amountInCents: 4_000,
					method: "wechat",
					refundedAt: new Date(refundedAt).toISOString(),
					requestId: firstApprovalRequestId,
				},
			},
		]);
		await expectOrpcError(
			createRefundRequest(financeScope, {
				invoiceId: ids.invoiceMain,
				amountInCents: 6_001,
				refundedAt: minutesAgo(15),
				method: "wechat",
				reason: "超额退款",
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		const finalRefundRequest = await createRefundRequest(financeScope, {
			invoiceId: ids.invoiceMain,
			amountInCents: 6_000,
			refundedAt: minutesAgo(10),
			method: "wechat",
			reason: "完成退款",
			requestId: randomUUID(),
		});
		await decideRefundRequest(
			{
				organizationId: ids.organizationA,
				userId: ids.owner,
				campusAccess: { kind: "all" },
			},
			{
				refundRequestId: finalRefundRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: finalRefundRequest.request.version,
				requestId: randomUUID(),
			},
		);
		const [refundedInvoice] = await db
			.select()
			.from(invoice)
			.where(eq(invoice.id, ids.invoiceMain));
		assert.equal(refundedInvoice?.status, "refunded");
		await expectOrpcError(
			createPayment(financeScope, {
				invoiceId: ids.invoiceMain,
				amountInCents: 1,
				receivedAt: minutesAgo(5),
				method: "wechat",
				referenceNo: null,
				note: null,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		const arrears = await listArrears(financeScope, { pageSize: 50 });
		assert.ok(
			arrears.items.some((item) => item.invoiceId === ids.invoiceIdempotent),
		);
		const arrearsItem = arrears.items.find(
			(item) => item.invoiceId === ids.invoiceIdempotent,
		);
		assert.ok(arrearsItem);
		const arrearsNoteInput = {
			invoiceId: ids.invoiceIdempotent,
			note: "已联系家长，周五前付款",
			expectedVersion: arrearsItem.cycle.version,
			requestId: randomUUID(),
		};
		assert.equal(
			(await addArrearsNote(financeScope, arrearsNoteInput)).replayed,
			false,
		);
		assert.equal(
			(await addArrearsNote(financeScope, arrearsNoteInput)).replayed,
			true,
		);
		const arrearsAfterFollowUp = await getArrearsDetail(financeScope, {
			invoiceId: ids.invoiceIdempotent,
		});
		assert.equal(
			arrearsAfterFollowUp.cycles[0]?.events.at(-1)?.note,
			"已联系家长，周五前付款",
		);
		const noteVersion = arrearsAfterFollowUp.cycles[0]?.version;
		assert.ok(noteVersion);
		const promisedInput = {
			invoiceId: ids.invoiceIdempotent,
			toStatus: "promised",
			promisedPaymentDate: "2099-01-03",
			resumeDate: null,
			reason: null,
			note: "家长确认付款计划",
			expectedVersion: noteVersion,
			requestId: randomUUID(),
		} as const;
		assert.equal(
			(await transitionArrears(financeScope, promisedInput)).replayed,
			false,
		);
		assert.equal(
			(await transitionArrears(financeScope, promisedInput)).replayed,
			true,
		);
		const promisedArrears = await listArrears(financeScope, {
			status: "promised",
			pageSize: 50,
		});
		assert.equal(
			promisedArrears.items.find(
				(item) => item.invoiceId === ids.invoiceIdempotent,
			)?.cycle.promisedPaymentDate,
			"2099-01-03",
		);
		await expectOrpcError(
			transitionArrears(financeScope, {
				invoiceId: ids.invoiceIdempotent,
				toStatus: "following_up",
				promisedPaymentDate: null,
				resumeDate: null,
				reason: null,
				note: null,
				expectedVersion: noteVersion,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		await expectOrpcError(
			renewEnrollment(
				{ ...financeScope, userId: ids.consultant },
				{ ...renewalInput, requestId: randomUUID() },
			),
			"FORBIDDEN",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("退款申请审批保持角色、幂等、并发与资金事务边界", async () => {
	const ids = createFixtureIds();
	const scope = (userId: string) => ({
		organizationId: ids.organizationA,
		userId,
		campusAccess: { kind: "all" } as const,
	});
	const createInput = (invoiceId: string, amountInCents: number) => ({
		invoiceId,
		amountInCents,
		refundedAt: minutesAgo(1),
		method: "wechat" as const,
		reason: "退款申请中的敏感自由文本",
		requestId: randomUUID(),
	});

	try {
		await seedFixture(ids);
		const financeRouter = (
			appRouter as unknown as {
				training: { finance: Record<string, unknown> };
			}
		).training.finance;
		assert.equal("refunds" in financeRouter, false);
		await createPayment(scope(ids.finance), {
			invoiceId: ids.invoiceMain,
			amountInCents: 10_000,
			receivedAt: minutesAgo(30),
			method: "wechat",
			referenceNo: null,
			note: null,
			requestId: randomUUID(),
		});

		const ownerRequest = await createRefundRequest(
			scope(ids.owner),
			createInput(ids.invoiceMain, 1_000),
		);
		assert.equal(ownerRequest.request.status, "pending");
		await expectOrpcError(
			cancelRefundRequest(scope(ids.finance), {
				refundRequestId: ownerRequest.request.id,
				reason: null,
				expectedVersion: ownerRequest.request.version,
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		await expectOrpcError(
			cancelRefundRequest(scope(ids.admin), {
				refundRequestId: ownerRequest.request.id,
				reason: null,
				expectedVersion: ownerRequest.request.version,
				requestId: randomUUID(),
			}),
			"BAD_REQUEST",
		);
		const ownerCancelled = await cancelRefundRequest(scope(ids.admin), {
			refundRequestId: ownerRequest.request.id,
			reason: "管理员取消他人申请的敏感原因",
			expectedVersion: ownerRequest.request.version,
			requestId: randomUUID(),
		});
		assert.equal(ownerCancelled.request.status, "cancelled");

		const adminRequest = await createRefundRequest(
			scope(ids.admin),
			createInput(ids.invoiceMain, 1_000),
		);
		await expectOrpcError(
			decideRefundRequest(scope(ids.admin), {
				refundRequestId: adminRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: adminRequest.request.version,
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		const adminCancelled = await cancelRefundRequest(scope(ids.admin), {
			refundRequestId: adminRequest.request.id,
			reason: null,
			expectedVersion: adminRequest.request.version,
			requestId: randomUUID(),
		});
		assert.equal(adminCancelled.request.status, "cancelled");

		const managerRequest = await createRefundRequest(
			scope(ids.campusManager),
			createInput(ids.invoiceMain, 1_000),
		);
		await expectOrpcError(
			decideRefundRequest(scope(ids.finance), {
				refundRequestId: managerRequest.request.id,
				action: "rejected",
				comment: "财务无审批权限",
				expectedVersion: managerRequest.request.version,
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		await expectOrpcError(
			decideRefundRequest(scope(ids.owner), {
				refundRequestId: managerRequest.request.id,
				action: "rejected",
				comment: null,
				expectedVersion: managerRequest.request.version,
				requestId: randomUUID(),
			}),
			"BAD_REQUEST",
		);
		const rejected = await decideRefundRequest(scope(ids.owner), {
			refundRequestId: managerRequest.request.id,
			action: "rejected",
			comment: "拒绝申请的敏感原因",
			expectedVersion: managerRequest.request.version,
			requestId: randomUUID(),
		});
		assert.equal(rejected.request.status, "rejected");

		const financeInput = createInput(ids.invoiceMain, 10_000);
		const financeRequest = await createRefundRequest(
			scope(ids.finance),
			financeInput,
		);
		assert.equal(
			(await createRefundRequest(scope(ids.finance), financeInput)).replayed,
			true,
		);
		await expectOrpcError(
			createRefundRequest(scope(ids.finance), {
				...financeInput,
				amountInCents: 9_999,
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			createRefundRequest(scope(ids.owner), createInput(ids.invoiceMain, 500)),
			"CONFLICT",
		);
		await expectOrpcError(
			decideRefundRequest(scope(ids.admin), {
				refundRequestId: financeRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: financeRequest.request.version + 1,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		const approvalRequestId = randomUUID();
		const approvalInput = {
			refundRequestId: financeRequest.request.id,
			action: "approved" as const,
			comment: "批准意见中的敏感自由文本",
			expectedVersion: financeRequest.request.version,
			requestId: approvalRequestId,
		};
		const approved = await decideRefundRequest(scope(ids.admin), approvalInput);
		assert.equal(approved.request.status, "approved");
		assert.ok(approved.request.refundId);
		assert.equal(
			(await decideRefundRequest(scope(ids.admin), approvalInput)).replayed,
			true,
		);
		await expectOrpcError(
			decideRefundRequest(scope(ids.admin), {
				...approvalInput,
				comment: "同请求不同意见",
			}),
			"CONFLICT",
		);

		const [approvedRefunds, mainInvoice, mainEnrollment] = await Promise.all([
			db.select().from(refund).where(eq(refund.invoiceId, ids.invoiceMain)),
			db.select().from(invoice).where(eq(invoice.id, ids.invoiceMain)),
			db.select().from(enrollment).where(eq(enrollment.id, ids.enrollmentMain)),
		]);
		assert.equal(approvedRefunds.length, 1);
		assert.equal(mainInvoice[0]?.status, "refunded");
		assert.equal(mainEnrollment[0]?.paidAmountInCents, 0);
		assert.ok(
			(
				await listInvoices(scope(ids.finance), {
					status: "refunded",
					pageSize: 50,
				})
			).items.some((item) => item.id === ids.invoiceMain),
		);
		assert.equal(
			(await getInvoiceDetail(scope(ids.finance), { id: ids.invoiceMain }))
				.invoice.status,
			"refunded",
		);

		const requestHistory = await listRefundRequests(scope(ids.finance), {
			invoiceId: ids.invoiceMain,
		});
		assert.equal(requestHistory.items.length, 4);
		assert.ok(
			requestHistory.items.some((item) =>
				item.events.some((event) => event.comment === "拒绝申请的敏感原因"),
			),
		);
		const requestAuditRows = await db
			.select({
				action: organizationAuditEvent.action,
				before: organizationAuditEvent.before,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.entityType, "refund_request"));
		const serializedAudit = JSON.stringify(requestAuditRows);
		assert.ok(!serializedAudit.includes("退款申请中的敏感自由文本"));
		assert.ok(!serializedAudit.includes("管理员取消他人申请的敏感原因"));
		assert.ok(!serializedAudit.includes("拒绝申请的敏感原因"));
		assert.ok(!serializedAudit.includes("批准意见中的敏感自由文本"));

		await createPayment(scope(ids.finance), {
			invoiceId: ids.invoiceConcurrent,
			amountInCents: 10_000,
			receivedAt: minutesAgo(20),
			method: "alipay",
			referenceNo: null,
			note: null,
			requestId: randomUUID(),
		});
		const concurrentCreations = await Promise.allSettled([
			createRefundRequest(
				scope(ids.finance),
				createInput(ids.invoiceConcurrent, 2_000),
			),
			createRefundRequest(
				scope(ids.owner),
				createInput(ids.invoiceConcurrent, 2_000),
			),
		]);
		assert.equal(
			concurrentCreations.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		const concurrentRequest = concurrentCreations.find(
			(result) => result.status === "fulfilled",
		)?.value;
		assert.ok(concurrentRequest);
		const concurrentDecisions = await Promise.allSettled([
			decideRefundRequest(scope(ids.admin), {
				refundRequestId: concurrentRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: concurrentRequest.request.version,
				requestId: randomUUID(),
			}),
			decideRefundRequest(scope(ids.owner), {
				refundRequestId: concurrentRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: concurrentRequest.request.version,
				requestId: randomUUID(),
			}),
		]);
		assert.equal(
			concurrentDecisions.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		assert.equal(
			(
				await db
					.select()
					.from(refund)
					.where(eq(refund.invoiceId, ids.invoiceConcurrent))
			).length,
			1,
		);

		await createPayment(scope(ids.finance), {
			invoiceId: ids.invoiceIdempotent,
			amountInCents: 3_000,
			receivedAt: minutesAgo(15),
			method: "cash",
			referenceNo: null,
			note: null,
			requestId: randomUUID(),
		});
		const staleBalanceRequest = await createRefundRequest(
			scope(ids.finance),
			createInput(ids.invoiceIdempotent, 3_000),
		);
		await db
			.update(campus)
			.set({ isActive: false })
			.where(eq(campus.id, ids.campusA));
		await expectOrpcError(
			decideRefundRequest(scope(ids.owner), {
				refundRequestId: staleBalanceRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: staleBalanceRequest.request.version,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await db
			.update(campus)
			.set({ isActive: true })
			.where(eq(campus.id, ids.campusA));
		await db
			.delete(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.admin),
				),
			);
		await expectOrpcError(
			decideRefundRequest(scope(ids.admin), {
				refundRequestId: staleBalanceRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: staleBalanceRequest.request.version,
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		await db.insert(organizationMember).values({
			organizationId: ids.organizationA,
			userId: ids.admin,
			role: "admin",
		});
		await db.insert(refund).values({
			organizationId: ids.organizationA,
			invoiceId: ids.invoiceIdempotent,
			amountInCents: 1_000,
			refundedAt: new Date(minutesAgo(10)),
			method: "cash",
			reason: "审批期间发生的历史退款余额",
			operatorUserId: ids.finance,
			operatorName: "财务测试用户 3",
			requestId: randomUUID(),
		});
		await expectOrpcError(
			decideRefundRequest(scope(ids.admin), {
				refundRequestId: staleBalanceRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: staleBalanceRequest.request.version,
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		const staleBalanceHistory = await listRefundRequests(scope(ids.finance), {
			invoiceId: ids.invoiceIdempotent,
		});
		assert.equal(staleBalanceHistory.items[0]?.status, "pending");
		assert.equal(
			(
				await db
					.select()
					.from(refund)
					.where(eq(refund.invoiceId, ids.invoiceIdempotent))
			).length,
			1,
		);

		await db
			.update(organizationMember)
			.set({ campusAccessMode: "selected" })
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.campusManager),
				),
			);
		await expectOrpcError(
			createRefundRequest(
				scope(ids.campusManager),
				createInput(ids.invoiceHistoricalStatusPaid, 500),
			),
			"FORBIDDEN",
		);
		await expectOrpcError(
			listRefundRequests(scope(ids.owner), { invoiceId: ids.invoiceB }),
			"NOT_FOUND",
		);
	} finally {
		await cleanupFixture(ids);
	}
});
