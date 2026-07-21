import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	generateReceiptDocumentRecord,
	getReceiptDocumentRecord,
	getReceiptSummaryByPaymentId,
	ReceiptDocumentError,
	reissueReceiptDocumentRecord,
	voidReceiptDocumentRecord,
} from "../src/repositories/receipt-documents";
import {
	campus,
	invoice,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	payment,
	paymentReversal,
	receiptDocument,
	receiptDocumentPayment,
	receiptNumberCounter,
	refund,
	student,
	user,
} from "../src/schema";

function ids() {
	const prefix = `receipt-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusId: randomUUID(),
		secondCampusId: randomUUID(),
		studentId: randomUUID(),
		secondStudentId: randomUUID(),
		invoiceId: randomUUID(),
		secondInvoiceId: randomUUID(),
		paymentId: randomUUID(),
		secondPaymentId: randomUUID(),
		ownerId: `${prefix}-owner`,
		consultantId: `${prefix}-consultant`,
	};
}

type Ids = ReturnType<typeof ids>;

async function seed(value: Ids) {
	await db.insert(user).values([
		{
			id: value.ownerId,
			name: "凭证财务",
			email: `${value.ownerId}@example.invalid`,
		},
		{
			id: value.consultantId,
			name: "凭证顾问",
			email: `${value.consultantId}@example.invalid`,
		},
	]);
	await db
		.insert(organization)
		.values({ id: value.organizationId, name: "测试培训机构" });
	await db.insert(organizationMember).values([
		{
			organizationId: value.organizationId,
			userId: value.ownerId,
			role: "owner",
		},
		{
			organizationId: value.organizationId,
			userId: value.consultantId,
			role: "consultant",
		},
	]);
	await db.insert(campus).values([
		{
			id: value.campusId,
			organizationId: value.organizationId,
			code: value.prefix,
			name: "凭证校区",
			city: "上海",
			address: "测试地址",
		},
		{
			id: value.secondCampusId,
			organizationId: value.organizationId,
			code: `${value.prefix}-second`,
			name: "凭证第二校区",
			city: "上海",
			address: "第二测试地址",
		},
	]);
	await db.insert(student).values([
		{
			id: value.studentId,
			organizationId: value.organizationId,
			campusId: value.campusId,
			name: "凭证学员",
			guardianName: "联系人",
			guardianPhone: "13800138000",
		},
		{
			id: value.secondStudentId,
			organizationId: value.organizationId,
			campusId: value.secondCampusId,
			name: "第二校区学员",
			guardianName: "第二联系人",
			guardianPhone: "13800138001",
		},
	]);
	await db.insert(invoice).values([
		{
			id: value.invoiceId,
			organizationId: value.organizationId,
			studentId: value.studentId,
			summary: "课程报名费用",
			amountInCents: 10_000,
			paidAmountInCents: 10_000,
			status: "paid",
			dueDate: "2099-01-01",
			paidAt: new Date(),
		},
		{
			id: value.secondInvoiceId,
			organizationId: value.organizationId,
			studentId: value.secondStudentId,
			summary: "第二校区课程费用",
			amountInCents: 10_000,
			paidAmountInCents: 10_000,
			status: "paid",
			dueDate: "2099-01-01",
			paidAt: new Date(),
		},
	]);
	await db.insert(payment).values([
		{
			id: value.paymentId,
			organizationId: value.organizationId,
			invoiceId: value.invoiceId,
			amountInCents: 10_000,
			receivedAt: new Date("2026-07-21T02:00:00.000Z"),
			method: "wechat",
			referenceNo: "PAY-001",
			note: "内部收款备注",
			operatorUserId: value.ownerId,
			operatorName: "凭证财务",
			requestId: randomUUID(),
		},
		{
			id: value.secondPaymentId,
			organizationId: value.organizationId,
			invoiceId: value.secondInvoiceId,
			amountInCents: 10_000,
			receivedAt: new Date("2026-07-21T03:00:00.000Z"),
			method: "cash",
			referenceNo: null,
			note: null,
			operatorUserId: value.ownerId,
			operatorName: "凭证财务",
			requestId: randomUUID(),
		},
	]);
}

async function cleanup(value: Ids) {
	await db
		.delete(receiptDocumentPayment)
		.where(eq(receiptDocumentPayment.organizationId, value.organizationId));
	await db
		.delete(receiptDocument)
		.where(eq(receiptDocument.organizationId, value.organizationId));
	await db
		.delete(receiptNumberCounter)
		.where(eq(receiptNumberCounter.organizationId, value.organizationId));
	await db
		.delete(organizationAuditEvent)
		.where(eq(organizationAuditEvent.organizationId, value.organizationId));
	await db
		.delete(paymentReversal)
		.where(eq(paymentReversal.organizationId, value.organizationId));
	await db
		.delete(refund)
		.where(eq(refund.organizationId, value.organizationId));
	await db
		.delete(payment)
		.where(eq(payment.organizationId, value.organizationId));
	await db
		.delete(invoice)
		.where(eq(invoice.organizationId, value.organizationId));
	await db
		.delete(student)
		.where(eq(student.organizationId, value.organizationId));
	await db
		.delete(organizationMemberCampus)
		.where(
			inArray(
				organizationMemberCampus.organizationMemberId,
				db
					.select({ id: organizationMember.id })
					.from(organizationMember)
					.where(eq(organizationMember.organizationId, value.organizationId)),
			),
		);
	await db
		.delete(organizationMember)
		.where(eq(organizationMember.organizationId, value.organizationId));
	await db
		.delete(campus)
		.where(eq(campus.organizationId, value.organizationId));
	await db
		.delete(organization)
		.where(eq(organization.id, value.organizationId));
	await db
		.delete(user)
		.where(inArray(user.id, [value.ownerId, value.consultantId]));
}

async function expectReceiptError(
	promise: Promise<unknown>,
	code: ReceiptDocumentError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof ReceiptDocumentError);
		assert.equal(error.code, code);
		return true;
	});
}

test("收款凭证保持编号、幂等、作废补开、权限和资金快照一致", async () => {
	const value = ids();
	try {
		await seed(value);
		assert.equal(
			await getReceiptSummaryByPaymentId({
				organizationId: value.organizationId,
				campusAccess: { kind: "all" },
				paymentId: value.paymentId,
			}),
			null,
		);
		const requestId = randomUUID();
		const input = {
			organizationId: value.organizationId,
			operatorUserId: value.ownerId,
			paymentIds: [value.paymentId],
			title: "学费收款凭证",
			note: "家长留存",
			requestId,
		};
		const generated = await generateReceiptDocumentRecord(input);
		assert.equal(generated.replayed, false);
		assert.equal((await generateReceiptDocumentRecord(input)).replayed, true);
		await expectReceiptError(
			generateReceiptDocumentRecord({ ...input, title: "不同抬头" }),
			"IDEMPOTENCY_CONFLICT",
		);

		const initial = await getReceiptDocumentRecord({
			organizationId: value.organizationId,
			campusAccess: { kind: "all" },
			receiptId: generated.receiptId,
		});
		assert.match(initial?.document.number ?? "", /^RCP-\d{6}-000001$/);
		assert.equal(initial?.payments.length, 1);
		assert.equal(initial?.payments[0]?.referenceNo, "PAY-001");
		assert.equal(JSON.stringify(initial).includes("内部收款备注"), false);
		assert.equal(
			(
				await getReceiptSummaryByPaymentId({
					organizationId: value.organizationId,
					campusAccess: { kind: "all" },
					paymentId: value.paymentId,
				})
			)?.id,
			generated.receiptId,
		);

		const race = await Promise.allSettled([
			generateReceiptDocumentRecord({
				...input,
				paymentIds: [value.secondPaymentId],
				requestId: randomUUID(),
			}),
			generateReceiptDocumentRecord({
				...input,
				paymentIds: [value.secondPaymentId],
				requestId: randomUUID(),
			}),
		]);
		assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
		assert.equal(race.filter((item) => item.status === "rejected").length, 1);
		const secondReceipt = race.find((item) => item.status === "fulfilled");
		assert.ok(secondReceipt?.status === "fulfilled");
		const secondReceiptView = await getReceiptDocumentRecord({
			organizationId: value.organizationId,
			campusAccess: { kind: "all" },
			receiptId: secondReceipt.value.receiptId,
		});
		assert.equal(secondReceiptView?.document.campusName, "凭证第二校区");
		assert.match(
			secondReceiptView?.document.number ?? "",
			/^RCP-\d{6}-000002$/,
		);

		const voidInput = {
			organizationId: value.organizationId,
			operatorUserId: value.ownerId,
			receiptId: generated.receiptId,
			reason: "抬头填写错误",
			requestId: randomUUID(),
		};
		assert.equal((await voidReceiptDocumentRecord(voidInput)).replayed, false);
		assert.equal((await voidReceiptDocumentRecord(voidInput)).replayed, true);
		await expectReceiptError(
			voidReceiptDocumentRecord({
				...voidInput,
				receiptId: secondReceipt.value.receiptId,
			}),
			"IDEMPOTENCY_CONFLICT",
		);
		await db
			.update(organization)
			.set({ name: "变更后的机构名称" })
			.where(eq(organization.id, value.organizationId));
		await db
			.update(campus)
			.set({ name: "变更后的校区名称" })
			.where(eq(campus.id, value.campusId));
		await db
			.update(student)
			.set({ name: "变更后的学员名称" })
			.where(eq(student.id, value.studentId));
		await db
			.update(invoice)
			.set({ summary: "变更后的账单摘要", amountInCents: 30_000 })
			.where(eq(invoice.id, value.invoiceId));
		const reissued = await reissueReceiptDocumentRecord({
			organizationId: value.organizationId,
			operatorUserId: value.ownerId,
			replacesReceiptId: generated.receiptId,
			title: "正确学费收款凭证",
			note: null,
			requestId: randomUUID(),
		});
		const reissuedView = await getReceiptDocumentRecord({
			organizationId: value.organizationId,
			campusAccess: { kind: "all" },
			receiptId: reissued.receiptId,
		});
		assert.equal(reissuedView?.document.replacesReceiptId, generated.receiptId);
		assert.match(reissuedView?.document.number ?? "", /^RCP-\d{6}-000003$/);
		assert.deepEqual(
			reissuedView
				? {
						organizationName: reissuedView.document.organizationName,
						campusName: reissuedView.document.campusName,
						studentId: reissuedView.document.studentId,
						studentName: reissuedView.document.studentName,
						invoiceId: reissuedView.document.invoiceId,
						invoiceSummary: reissuedView.document.invoiceSummary,
						invoiceAmountInCents: reissuedView.document.invoiceAmountInCents,
						payments: reissuedView.payments,
					}
				: null,
			initial
				? {
						organizationName: initial.document.organizationName,
						campusName: initial.document.campusName,
						studentId: initial.document.studentId,
						studentName: initial.document.studentName,
						invoiceId: initial.document.invoiceId,
						invoiceSummary: initial.document.invoiceSummary,
						invoiceAmountInCents: initial.document.invoiceAmountInCents,
						payments: initial.payments,
					}
				: null,
		);
		assert.equal(
			(
				await getReceiptSummaryByPaymentId({
					organizationId: value.organizationId,
					campusAccess: { kind: "all" },
					paymentId: value.paymentId,
				})
			)?.id,
			reissued.receiptId,
		);
		assert.equal(
			await getReceiptSummaryByPaymentId({
				organizationId: value.organizationId,
				campusAccess: { kind: "none" },
				paymentId: value.paymentId,
			}),
			undefined,
		);

		await db.insert(paymentReversal).values({
			organizationId: value.organizationId,
			campusId: value.campusId,
			invoiceId: value.invoiceId,
			paymentId: value.paymentId,
			amountInCents: 4_000,
			reason: "冲正原因",
			reversedAt: new Date(),
			operatorUserId: value.ownerId,
			operatorName: "凭证财务",
			requestId: randomUUID(),
		});
		await db.insert(refund).values({
			organizationId: value.organizationId,
			invoiceId: value.invoiceId,
			amountInCents: 2_000,
			refundedAt: new Date(),
			method: "wechat",
			reason: "退款原因",
			operatorUserId: value.ownerId,
			operatorName: "凭证财务",
			requestId: randomUUID(),
		});
		const current = await getReceiptDocumentRecord({
			organizationId: value.organizationId,
			campusAccess: { kind: "all" },
			receiptId: reissued.receiptId,
		});
		assert.equal(
			current?.currentFinancialStatus.payments[0]?.reversedAmountInCents,
			4_000,
		);
		assert.equal(
			current?.currentFinancialStatus.payments[0]?.effectiveAmountInCents,
			6_000,
		);
		assert.equal(
			current?.currentFinancialStatus.invoiceRefundedAmountInCents,
			2_000,
		);

		await expectReceiptError(
			generateReceiptDocumentRecord({
				...input,
				operatorUserId: value.consultantId,
				requestId: randomUUID(),
			}),
			"MEMBER_FORBIDDEN",
		);
		assert.equal(
			await getReceiptDocumentRecord({
				organizationId: value.organizationId,
				campusAccess: { kind: "none" },
				receiptId: reissued.receiptId,
			}),
			null,
		);
		const audits = await db
			.select({
				action: organizationAuditEvent.action,
				before: organizationAuditEvent.before,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.organizationId, value.organizationId));
		assert.ok(audits.some((item) => item.action === "receipt_generated"));
		assert.ok(audits.some((item) => item.action === "receipt_voided"));
		assert.ok(audits.some((item) => item.action === "receipt_reissued"));
		assert.equal(JSON.stringify(audits).includes("抬头填写错误"), false);
		assert.equal(JSON.stringify(audits).includes("家长留存"), false);
	} finally {
		await cleanup(value);
	}
});
