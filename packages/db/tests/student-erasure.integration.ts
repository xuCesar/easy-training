import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	eraseStudentRecord,
	StudentErasureError,
} from "../src/repositories/student-erasure";
import { listStudentRecords } from "../src/repositories/students";
import {
	campus,
	invoice,
	organization,
	organizationAuditEvent,
	organizationMember,
	receiptDocument,
	student,
	studentContact,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `student-erasure-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusId: randomUUID(),
		ownerUserId: `${prefix}-owner`,
		consultantUserId: `${prefix}-consultant`,
		studentWithHistory: randomUUID(),
		bareStudent: randomUUID(),
		invoiceId: randomUUID(),
		receiptId: randomUUID(),
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

const GUARDIAN_PHONE = "13800000001";
const CONTACT_PHONE = "13800000002";
const STUDENT_NAME = "擦除测试学员";

async function seedFixture(ids: FixtureIds) {
	await db
		.insert(organization)
		.values({ id: ids.organizationId, name: `${ids.prefix} 机构` });
	await db.insert(user).values([
		{
			id: ids.ownerUserId,
			name: "擦除测试负责人",
			email: `${ids.ownerUserId}@example.invalid`,
		},
		{
			id: ids.consultantUserId,
			name: "擦除测试顾问",
			email: `${ids.consultantUserId}@example.invalid`,
		},
	]);
	await db.insert(organizationMember).values([
		{
			organizationId: ids.organizationId,
			userId: ids.ownerUserId,
			role: "owner",
		},
		{
			organizationId: ids.organizationId,
			userId: ids.consultantUserId,
			role: "consultant",
		},
	]);
	await db.insert(campus).values({
		id: ids.campusId,
		organizationId: ids.organizationId,
		code: `${ids.prefix}-campus`,
		name: "擦除测试校区",
		city: "上海",
		address: "测试地址",
	});
	await db.insert(student).values([
		{
			id: ids.studentWithHistory,
			organizationId: ids.organizationId,
			campusId: ids.campusId,
			name: STUDENT_NAME,
			guardianName: "擦除测试家长",
			guardianPhone: GUARDIAN_PHONE,
			guardianPhoneNormalized: GUARDIAN_PHONE,
			birthDate: "2015-06-01",
		},
		{
			id: ids.bareStudent,
			organizationId: ids.organizationId,
			campusId: ids.campusId,
			name: "无历史学员",
			guardianName: "无历史家长",
			guardianPhone: "13800000003",
			guardianPhoneNormalized: "13800000003",
		},
	]);
	await db.insert(studentContact).values({
		studentId: ids.studentWithHistory,
		name: "擦除测试联系人",
		phone: CONTACT_PHONE,
		phoneNormalized: CONTACT_PHONE,
		relationship: "母亲",
		isPrimary: true,
	});
	await db.insert(invoice).values({
		id: ids.invoiceId,
		organizationId: ids.organizationId,
		studentId: ids.studentWithHistory,
		amountInCents: 100_000,
		paidAmountInCents: 100_000,
		status: "paid",
		dueDate: "2026-01-01",
	});
	await db.insert(receiptDocument).values({
		id: ids.receiptId,
		organizationId: ids.organizationId,
		campusId: ids.campusId,
		number: `${ids.prefix}-R001`,
		yearMonth: "202607",
		sequence: 1,
		generationRequestId: randomUUID(),
		inputHash: `${ids.prefix}-hash`,
		organizationName: `${ids.prefix} 机构`,
		campusName: "擦除测试校区",
		studentId: ids.studentWithHistory,
		studentName: STUDENT_NAME,
		invoiceId: ids.invoiceId,
		invoiceSummary: "课程报名费用",
		invoiceAmountInCents: 100_000,
		title: "收款收据",
		generatedByUserId: ids.ownerUserId,
		generatedByName: "擦除测试负责人",
	});
	await db.insert(organizationAuditEvent).values({
		organizationId: ids.organizationId,
		action: "students_bulk_updated",
		entityType: "student",
		entityId: ids.studentWithHistory,
		actorUserId: ids.ownerUserId,
		before: { name: STUDENT_NAME, guardianPhone: GUARDIAN_PHONE },
		after: { name: STUDENT_NAME },
	});
}

async function cleanupFixture(ids: FixtureIds) {
	await db
		.delete(receiptDocument)
		.where(eq(receiptDocument.organizationId, ids.organizationId));
	await db
		.delete(invoice)
		.where(eq(invoice.organizationId, ids.organizationId));
	await db.delete(organization).where(eq(organization.id, ids.organizationId));
	await db
		.delete(user)
		.where(inArray(user.id, [ids.ownerUserId, ids.consultantUserId]));
}

async function expectErasureError(
	promise: Promise<unknown>,
	code: StudentErasureError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof StudentErasureError);
		assert.equal(error.code, code);
		return true;
	});
}

test("有业务历史的学员匿名化后全库无姓名电话残留,财务记录保持", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const result = await eraseStudentRecord({
			organizationId: ids.organizationId,
			userId: ids.ownerUserId,
			studentId: ids.studentWithHistory,
			confirmName: STUDENT_NAME,
		});
		assert.equal(result.mode, "anonymized");

		const [row] = await db
			.select()
			.from(student)
			.where(eq(student.id, ids.studentWithHistory));
		assert.ok(row);
		assert.match(row.name, /^已注销学员-/);
		assert.equal(row.guardianName, "");
		assert.equal(row.guardianPhone, "");
		assert.equal(row.guardianPhoneNormalized, "");
		assert.equal(row.birthDate, null);
		assert.ok(row.anonymizedAt);

		const contacts = await db
			.select()
			.from(studentContact)
			.where(eq(studentContact.studentId, ids.studentWithHistory));
		assert.equal(contacts.length, 0);

		const [receipt] = await db
			.select({
				studentName: receiptDocument.studentName,
				amount: receiptDocument.invoiceAmountInCents,
			})
			.from(receiptDocument)
			.where(eq(receiptDocument.id, ids.receiptId));
		assert.equal(receipt?.studentName, row.name);
		assert.equal(receipt?.amount, 100_000);

		const [billing] = await db
			.select({ amount: invoice.amountInCents, status: invoice.status })
			.from(invoice)
			.where(eq(invoice.id, ids.invoiceId));
		assert.equal(billing?.amount, 100_000);
		assert.equal(billing?.status, "paid");

		const auditRows = await db
			.select({
				action: organizationAuditEvent.action,
				before: organizationAuditEvent.before,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.entityId, ids.studentWithHistory));
		const residue = JSON.stringify(auditRows);
		assert.equal(residue.includes(STUDENT_NAME), false);
		assert.equal(residue.includes(GUARDIAN_PHONE), false);
		assert.ok(
			auditRows.some(
				(event) =>
					event.action === "student_erased" &&
					(event.after as { mode?: string })?.mode === "anonymized",
			),
		);

		const list = await listStudentRecords({
			organizationId: ids.organizationId,
			campusAccess: { kind: "all" as const },
			pageSize: 50,
		});
		assert.equal(
			list.items.some((item) => item.id === ids.studentWithHistory),
			false,
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("无业务历史的学员被物理删除并留下删除审计", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const result = await eraseStudentRecord({
			organizationId: ids.organizationId,
			userId: ids.ownerUserId,
			studentId: ids.bareStudent,
			confirmName: "无历史学员",
		});
		assert.equal(result.mode, "deleted");

		const rows = await db
			.select({ id: student.id })
			.from(student)
			.where(eq(student.id, ids.bareStudent));
		assert.equal(rows.length, 0);

		const auditRows = await db
			.select({ action: organizationAuditEvent.action })
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.entityId, ids.bareStudent));
		assert.deepEqual(
			auditRows.map((event) => event.action),
			["student_erased"],
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("确认姓名不一致、未结清账单、重复擦除与越权均被拒绝", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		await expectErasureError(
			eraseStudentRecord({
				organizationId: ids.organizationId,
				userId: ids.ownerUserId,
				studentId: ids.studentWithHistory,
				confirmName: "错误姓名",
			}),
			"ERASE_CONFIRM_MISMATCH",
		);
		await expectErasureError(
			eraseStudentRecord({
				organizationId: ids.organizationId,
				userId: ids.consultantUserId,
				studentId: ids.studentWithHistory,
				confirmName: STUDENT_NAME,
			}),
			"MEMBER_FORBIDDEN",
		);

		await db
			.update(invoice)
			.set({ status: "pending", paidAmountInCents: 0 })
			.where(eq(invoice.id, ids.invoiceId));
		await expectErasureError(
			eraseStudentRecord({
				organizationId: ids.organizationId,
				userId: ids.ownerUserId,
				studentId: ids.studentWithHistory,
				confirmName: STUDENT_NAME,
			}),
			"ERASE_OUTSTANDING_INVOICE",
		);

		await db
			.update(invoice)
			.set({ status: "paid", paidAmountInCents: 100_000 })
			.where(eq(invoice.id, ids.invoiceId));
		const result = await eraseStudentRecord({
			organizationId: ids.organizationId,
			userId: ids.ownerUserId,
			studentId: ids.studentWithHistory,
			confirmName: STUDENT_NAME,
		});
		assert.equal(result.mode, "anonymized");
		await expectErasureError(
			eraseStudentRecord({
				organizationId: ids.organizationId,
				userId: ids.ownerUserId,
				studentId: ids.studentWithHistory,
				confirmName: STUDENT_NAME,
			}),
			"STUDENT_ALREADY_ERASED",
		);
	} finally {
		await cleanupFixture(ids);
	}
});
