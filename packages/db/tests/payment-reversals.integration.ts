import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
	createPaymentReversalResultSchema,
	invoiceDetailSchema,
} from "../../api/src/contracts/training";
import {
	createPayment,
	getInvoiceDetail,
} from "../../api/src/repositories/finance";
import { createPaymentReversal } from "../../api/src/repositories/payment-reversals";
import {
	createRefundRequest,
	decideRefundRequest,
} from "../../api/src/repositories/refund-approval";
import { db } from "../src";
import {
	campus,
	course,
	enrollment,
	invoice,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	payment,
	paymentReversal,
	refund,
	refundRequest,
	refundRequestEvent,
	session,
	student,
	user,
} from "../src/schema";

function createIds() {
	const prefix = `payment-reversal-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusA2: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseB: randomUUID(),
		studentA: randomUUID(),
		studentA2: randomUUID(),
		studentB: randomUUID(),
		enrollmentMain: randomUUID(),
		enrollmentConcurrent: randomUUID(),
		enrollmentRefund: randomUUID(),
		enrollmentRefundRace: randomUUID(),
		enrollmentCrossCampus: randomUUID(),
		enrollmentB: randomUUID(),
		invoiceMain: randomUUID(),
		invoiceConcurrent: randomUUID(),
		invoiceRefund: randomUUID(),
		invoiceRefundRace: randomUUID(),
		invoiceCrossCampus: randomUUID(),
		invoiceHistorical: randomUUID(),
		invoiceB: randomUUID(),
		owner: `${prefix}-owner`,
		finance: `${prefix}-finance`,
		consultant: `${prefix}-consultant`,
		ownerB: `${prefix}-owner-b`,
	};
}

type Ids = ReturnType<typeof createIds>;

function userIds(ids: Ids) {
	return [ids.owner, ids.finance, ids.consultant, ids.ownerB];
}

async function cleanup(ids: Ids) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	await db
		.delete(refundRequestEvent)
		.where(inArray(refundRequestEvent.organizationId, organizationIds));
	await db
		.delete(refundRequest)
		.where(inArray(refundRequest.organizationId, organizationIds));
	await db
		.delete(organizationAuditEvent)
		.where(inArray(organizationAuditEvent.organizationId, organizationIds));
	await db
		.delete(paymentReversal)
		.where(inArray(paymentReversal.organizationId, organizationIds));
	await db
		.delete(refund)
		.where(inArray(refund.organizationId, organizationIds));
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
	await db.delete(user).where(inArray(user.id, userIds(ids)));
}

async function seed(ids: Ids) {
	await db.insert(user).values(
		userIds(ids).map((id, index) => ({
			id,
			name: `冲正测试用户 ${index}`,
			email: `${id}@example.invalid`,
		})),
	);
	const now = new Date();
	await db.insert(session).values(
		userIds(ids).map((userId) => ({
			id: `${userId}-session`,
			token: `${userId}-token`,
			userId,
			expiresAt: new Date(now.getTime() + 3_600_000),
			updatedAt: now,
		})),
	);
	await db.insert(organization).values([
		{ id: ids.organizationA, name: `${ids.prefix} A` },
		{ id: ids.organizationB, name: `${ids.prefix} B` },
	]);
	const members = await db
		.insert(organizationMember)
		.values([
			{ organizationId: ids.organizationA, userId: ids.owner, role: "owner" },
			{
				organizationId: ids.organizationA,
				userId: ids.finance,
				role: "finance",
				campusAccessMode: "selected",
			},
			{
				organizationId: ids.organizationA,
				userId: ids.consultant,
				role: "consultant",
			},
			{ organizationId: ids.organizationB, userId: ids.ownerB, role: "owner" },
		])
		.returning({
			id: organizationMember.id,
			userId: organizationMember.userId,
		});
	const financeMember = members.find((member) => member.userId === ids.finance);
	assert.ok(financeMember);
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
			id: ids.campusA2,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a2`,
			name: "A2 校区",
			city: "上海",
			address: "A2",
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
	await db.insert(organizationMemberCampus).values({
		organizationMemberId: financeMember.id,
		campusId: ids.campusA,
	});
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
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 10_000,
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
		},
		{
			id: ids.studentA2,
			organizationId: ids.organizationA,
			campusId: ids.campusA2,
			name: "A2 学员",
			guardianName: "A2 家长",
			guardianPhone: "13800000001",
		},
		{
			id: ids.studentB,
			organizationId: ids.organizationB,
			campusId: ids.campusB,
			name: "B 学员",
			guardianName: "B 家长",
			guardianPhone: "13900000000",
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
			id: ids.enrollmentRefund,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			courseId: ids.courseA,
			purchasedLessons: 5,
			remainingLessons: 5,
			amountInCents: 5_000,
		},
		{
			id: ids.enrollmentRefundRace,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			courseId: ids.courseA,
			purchasedLessons: 5,
			remainingLessons: 5,
			amountInCents: 5_000,
		},
		{
			id: ids.enrollmentCrossCampus,
			organizationId: ids.organizationA,
			studentId: ids.studentA2,
			courseId: ids.courseA,
			purchasedLessons: 5,
			remainingLessons: 5,
			amountInCents: 5_000,
		},
		{
			id: ids.enrollmentB,
			organizationId: ids.organizationB,
			studentId: ids.studentB,
			courseId: ids.courseB,
			purchasedLessons: 5,
			remainingLessons: 5,
			amountInCents: 5_000,
		},
	]);
	await db.insert(invoice).values([
		{
			id: ids.invoiceMain,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentMain,
			amountInCents: 10_000,
			dueDate: "2000-01-01",
		},
		{
			id: ids.invoiceConcurrent,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentConcurrent,
			amountInCents: 10_000,
			dueDate: "2099-01-01",
		},
		{
			id: ids.invoiceRefund,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentRefund,
			amountInCents: 5_000,
			dueDate: "2099-01-02",
		},
		{
			id: ids.invoiceRefundRace,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			enrollmentId: ids.enrollmentRefundRace,
			amountInCents: 5_000,
			dueDate: "2099-01-02",
		},
		{
			id: ids.invoiceCrossCampus,
			organizationId: ids.organizationA,
			studentId: ids.studentA2,
			enrollmentId: ids.enrollmentCrossCampus,
			amountInCents: 5_000,
			dueDate: "2099-01-03",
		},
		{
			id: ids.invoiceHistorical,
			organizationId: ids.organizationA,
			studentId: ids.studentA,
			amountInCents: 2_000,
			paidAmountInCents: 2_000,
			status: "paid",
			dueDate: "2099-01-04",
		},
		{
			id: ids.invoiceB,
			organizationId: ids.organizationB,
			studentId: ids.studentB,
			enrollmentId: ids.enrollmentB,
			amountInCents: 5_000,
			dueDate: "2099-01-05",
		},
	]);
}

function scope(organizationId: string, userId: string) {
	return { organizationId, userId, campusAccess: { kind: "all" as const } };
}

function minutesAgo(minutes: number) {
	return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function expectOrpcError(promise: Promise<unknown>, code: string) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(typeof error === "object" && error !== null && "code" in error);
		assert.equal(error.code, code);
		return true;
	});
}

async function pay(
	organizationId: string,
	userId: string,
	invoiceId: string,
	amountInCents: number,
) {
	return createPayment(scope(organizationId, userId), {
		invoiceId,
		amountInCents,
		receivedAt: minutesAgo(30),
		method: "wechat",
		referenceNo: null,
		note: null,
		requestId: randomUUID(),
	});
}

test("收款冲正保持不可变流水、金额守恒、权限、幂等与并发边界", async () => {
	const ids = createIds();
	const financeScope = scope(ids.organizationA, ids.finance);
	const ownerScope = scope(ids.organizationA, ids.owner);
	try {
		await seed(ids);
		const mainPayment = await pay(
			ids.organizationA,
			ids.finance,
			ids.invoiceMain,
			10_000,
		);
		const concurrentPayment = await pay(
			ids.organizationA,
			ids.finance,
			ids.invoiceConcurrent,
			10_000,
		);
		const refundPayment = await pay(
			ids.organizationA,
			ids.finance,
			ids.invoiceRefund,
			5_000,
		);
		const refundRacePayment = await pay(
			ids.organizationA,
			ids.finance,
			ids.invoiceRefundRace,
			5_000,
		);
		const crossCampusPayment = await pay(
			ids.organizationA,
			ids.owner,
			ids.invoiceCrossCampus,
			5_000,
		);

		const firstRequestId = randomUUID();
		const firstInput = {
			paymentId: mainPayment.payment.id,
			amountInCents: 3_000,
			reason: "原收款金额录入错误",
			reversedAt: minutesAgo(20),
			requestId: firstRequestId,
		};
		const first = createPaymentReversalResultSchema.parse(
			await createPaymentReversal(financeScope, firstInput),
		);
		assert.equal(first.replayed, false);
		assert.equal(first.payment.reversedAmountInCents, 3_000);
		assert.equal(first.payment.effectiveAmountInCents, 7_000);
		assert.equal(first.invoice.paidAmountInCents, 7_000);
		assert.equal(first.invoice.status, "partial");
		assert.equal(first.invoice.paidAt, null);

		const replay = createPaymentReversalResultSchema.parse(
			await createPaymentReversal(financeScope, firstInput),
		);
		assert.equal(replay.reversal.id, first.reversal.id);
		assert.equal(replay.replayed, true);
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				...firstInput,
				amountInCents: 2_999,
			}),
			"CONFLICT",
		);

		await createPaymentReversal(financeScope, {
			paymentId: mainPayment.payment.id,
			amountInCents: 2_000,
			reason: "继续纠正同一笔错误收款",
			reversedAt: minutesAgo(15),
			requestId: randomUUID(),
		});
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: mainPayment.payment.id,
				amountInCents: 5_001,
				reason: "超额冲正",
				reversedAt: minutesAgo(10),
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await createPaymentReversal(financeScope, {
			paymentId: mainPayment.payment.id,
			amountInCents: 5_000,
			reason: "完成全部冲正",
			reversedAt: minutesAgo(9),
			requestId: randomUUID(),
		});
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: mainPayment.payment.id,
				amountInCents: 1,
				reason: "全部冲正后再次提交",
				reversedAt: minutesAgo(8),
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		const fullyReversedDetail = invoiceDetailSchema.parse(
			await getInvoiceDetail(financeScope, { id: ids.invoiceMain }),
		);
		assert.equal(fullyReversedDetail.invoice.paidAmountInCents, 0);
		assert.equal(fullyReversedDetail.invoice.status, "pending");
		assert.equal(fullyReversedDetail.invoice.outstandingAmountInCents, 10_000);
		assert.equal(fullyReversedDetail.payments.length, 1);
		assert.equal(fullyReversedDetail.payments[0]?.amountInCents, 10_000);
		assert.equal(fullyReversedDetail.payments[0]?.effectiveAmountInCents, 0);
		assert.equal(fullyReversedDetail.payments[0]?.reversals.length, 3);
		const [mainEnrollment] = await db
			.select({ paidAmountInCents: enrollment.paidAmountInCents })
			.from(enrollment)
			.where(eq(enrollment.id, ids.enrollmentMain));
		assert.equal(mainEnrollment?.paidAmountInCents, 0);

		const replacementPayment = await pay(
			ids.organizationA,
			ids.finance,
			ids.invoiceMain,
			4_000,
		);
		assert.notEqual(replacementPayment.payment.id, mainPayment.payment.id);
		const replacementDetail = await getInvoiceDetail(financeScope, {
			id: ids.invoiceMain,
		});
		assert.equal(replacementDetail.invoice.paidAmountInCents, 4_000);
		assert.equal(replacementDetail.invoice.status, "partial");

		const concurrent = await Promise.allSettled([
			createPaymentReversal(financeScope, {
				paymentId: concurrentPayment.payment.id,
				amountInCents: 6_000,
				reason: "并发冲正 A",
				reversedAt: minutesAgo(7),
				requestId: randomUUID(),
			}),
			createPaymentReversal(financeScope, {
				paymentId: concurrentPayment.payment.id,
				amountInCents: 6_000,
				reason: "并发冲正 B",
				reversedAt: minutesAgo(6),
				requestId: randomUUID(),
			}),
		]);
		assert.equal(
			concurrent.filter((result) => result.status === "fulfilled").length,
			1,
		);
		const concurrentReversals = await db
			.select({ amountInCents: paymentReversal.amountInCents })
			.from(paymentReversal)
			.where(eq(paymentReversal.paymentId, concurrentPayment.payment.id));
		assert.equal(
			concurrentReversals.reduce(
				(total, reversal) => total + reversal.amountInCents,
				0,
			),
			6_000,
		);
		const paymentReversalRace = await Promise.allSettled([
			pay(ids.organizationA, ids.finance, ids.invoiceConcurrent, 3_000),
			createPaymentReversal(financeScope, {
				paymentId: concurrentPayment.payment.id,
				amountInCents: 4_000,
				reason: "与新收款并发冲正",
				reversedAt: minutesAgo(5),
				requestId: randomUUID(),
			}),
		]);
		assert.equal(
			paymentReversalRace.filter((result) => result.status === "fulfilled")
				.length,
			2,
		);
		const afterPaymentRace = await getInvoiceDetail(financeScope, {
			id: ids.invoiceConcurrent,
		});
		assert.equal(afterPaymentRace.invoice.paidAmountInCents, 3_000);
		assert.equal(afterPaymentRace.payments.length, 2);

		const raceRequest = await createRefundRequest(financeScope, {
			invoiceId: ids.invoiceRefundRace,
			amountInCents: 1_000,
			refundedAt: minutesAgo(5),
			method: "wechat",
			reason: "测试退款批准与冲正并发",
			requestId: randomUUID(),
		});
		const refundReversalRace = await Promise.allSettled([
			decideRefundRequest(ownerScope, {
				refundRequestId: raceRequest.request.id,
				action: "approved",
				comment: null,
				expectedVersion: raceRequest.request.version,
				requestId: randomUUID(),
			}),
			createPaymentReversal(financeScope, {
				paymentId: refundRacePayment.payment.id,
				amountInCents: 1_000,
				reason: "与退款批准并发冲正",
				reversedAt: minutesAgo(5),
				requestId: randomUUID(),
			}),
		]);
		assert.equal(
			refundReversalRace.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		const [raceRefundRows, raceReversalRows] = await Promise.all([
			db
				.select({ id: refund.id })
				.from(refund)
				.where(eq(refund.invoiceId, ids.invoiceRefundRace)),
			db
				.select({ id: paymentReversal.id })
				.from(paymentReversal)
				.where(eq(paymentReversal.paymentId, refundRacePayment.payment.id)),
		]);
		assert.equal(raceRefundRows.length + raceReversalRows.length, 1);

		const refundRequestResult = await createRefundRequest(financeScope, {
			invoiceId: ids.invoiceRefund,
			amountInCents: 1_000,
			refundedAt: minutesAgo(5),
			method: "wechat",
			reason: "测试退款与冲正互斥",
			requestId: randomUUID(),
		});
		await decideRefundRequest(ownerScope, {
			refundRequestId: refundRequestResult.request.id,
			action: "approved",
			comment: null,
			expectedVersion: refundRequestResult.request.version,
			requestId: randomUUID(),
		});
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: refundPayment.payment.id,
				amountInCents: 1_000,
				reason: "已有退款后尝试冲正",
				reversedAt: minutesAgo(4),
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);

		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: crossCampusPayment.payment.id,
				amountInCents: 1_000,
				reason: "跨校区尝试冲正",
				reversedAt: minutesAgo(3),
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		await db
			.update(campus)
			.set({ isActive: false })
			.where(eq(campus.id, ids.campusA2));
		await expectOrpcError(
			createPaymentReversal(ownerScope, {
				paymentId: crossCampusPayment.payment.id,
				amountInCents: 1_000,
				reason: "停用校区尝试冲正",
				reversedAt: minutesAgo(3),
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			createPaymentReversal(scope(ids.organizationA, ids.consultant), {
				paymentId: replacementPayment.payment.id,
				amountInCents: 1_000,
				reason: "顾问尝试冲正",
				reversedAt: minutesAgo(3),
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
		await expectOrpcError(
			createPaymentReversal(scope(ids.organizationB, ids.ownerB), {
				paymentId: replacementPayment.payment.id,
				amountInCents: 1_000,
				reason: "跨机构尝试冲正",
				reversedAt: minutesAgo(3),
				requestId: randomUUID(),
			}),
			"NOT_FOUND",
		);
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: randomUUID(),
				amountInCents: 1_000,
				reason: "历史期初金额没有具体收款",
				reversedAt: minutesAgo(3),
				requestId: randomUUID(),
			}),
			"NOT_FOUND",
		);

		const auditRows = await db
			.select({
				action: organizationAuditEvent.action,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationA),
					eq(organizationAuditEvent.entityId, first.reversal.id),
				),
			);
		assert.deepEqual(auditRows, [
			{
				action: "payment_reversed",
				entityType: "payment_reversal",
				entityId: first.reversal.id,
				campusId: ids.campusA,
				after: {
					invoiceId: ids.invoiceMain,
					paymentId: mainPayment.payment.id,
					amountInCents: 3_000,
					reversedAt: new Date(firstInput.reversedAt).toISOString(),
					requestId: firstRequestId,
				},
			},
		]);
		assert.equal(
			auditRows.some((row) => JSON.stringify(row.after).includes("录入错误")),
			false,
		);
		await db
			.update(organizationMember)
			.set({ role: "consultant" })
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.finance),
				),
			);
		await expectOrpcError(
			createPaymentReversal(financeScope, {
				paymentId: replacementPayment.payment.id,
				amountInCents: 1_000,
				reason: "撤权后尝试冲正",
				reversedAt: minutesAgo(1),
				requestId: randomUUID(),
			}),
			"FORBIDDEN",
		);
	} finally {
		await cleanup(ids);
	}
});
