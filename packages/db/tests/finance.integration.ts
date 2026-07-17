import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import {
	createPaymentResultSchema,
	invoiceDetailSchema,
	invoiceListResultSchema,
} from "../../api/src/contracts/training";
import {
	createPayment,
	getInvoiceDetail,
	listInvoices,
} from "../../api/src/repositories/finance";
import { getTrainingDashboardSnapshot } from "../../api/src/repositories/training-dashboard";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import {
	campus,
	course,
	enrollment,
	invoice,
	organization,
	organizationMember,
	payment,
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
			await listInvoices(financeScope, { status: "all" }),
		);
		assert.equal(initialList.total, 7);
		assert.ok(
			initialList.items.every((item) => item.id !== ids.invoiceRefunded),
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
		});
		assert.ok(
			historicalPartialList.items.some(
				(item) => item.id === ids.invoiceHistoricalPartial,
			),
		);
		const historicalPaidList = await listInvoices(financeScope, {
			status: "paid",
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
		await expectOrpcError(
			getInvoiceDetail(financeScope, { id: ids.invoiceRefunded }),
			"NOT_FOUND",
		);
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
