import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, eq, inArray } from "drizzle-orm";
import { ORPCError } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import {
	confirmStudentImport,
	exportStudents,
	previewStudentImport,
} from "../../api/src/repositories/students";
import { db, exportStudentRecords, StudentImportExportError } from "../src";
import {
	campus,
	enrollment,
	invoice,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	student,
	studentContact,
	studentImportBatch,
	studentOwnerAssignmentEvent,
	studentTag,
	studentTagAssignment,
	user,
} from "../src/schema";

function createIds() {
	const prefix = `student-import-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusA: randomUUID(),
		campusB: randomUUID(),
		campusACode: `A-${randomUUID().slice(0, 8)}`,
		campusBCode: `B-${randomUUID().slice(0, 8)}`,
		ownerUserId: `${prefix}-owner`,
		consultantUserId: `${prefix}-consultant`,
		visibleStudentId: randomUUID(),
		restrictedStudentId: randomUUID(),
		tagId: randomUUID(),
	};
}

type Ids = ReturnType<typeof createIds>;

async function seed(ids: Ids) {
	await db.insert(organization).values({
		id: ids.organizationId,
		name: ids.prefix,
	});
	await db.insert(user).values([
		{
			id: ids.ownerUserId,
			name: "导入测试负责人",
			email: `${ids.ownerUserId}@example.invalid`,
		},
		{
			id: ids.consultantUserId,
			name: "导入测试顾问",
			email: `${ids.consultantUserId}@example.invalid`,
		},
	]);
	const members = await db
		.insert(organizationMember)
		.values([
			{
				organizationId: ids.organizationId,
				userId: ids.ownerUserId,
				role: "owner",
				campusAccessMode: "all",
			},
			{
				organizationId: ids.organizationId,
				userId: ids.consultantUserId,
				role: "consultant",
				campusAccessMode: "selected",
			},
		])
		.returning({
			id: organizationMember.id,
			userId: organizationMember.userId,
		});
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationId,
			code: ids.campusACode,
			name: "导入 A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationId,
			code: ids.campusBCode,
			name: "导入 B 校区",
			city: "上海",
			address: "B",
		},
	]);
	const consultantMember = members.find(
		(item) => item.userId === ids.consultantUserId,
	);
	assert.ok(consultantMember);
	await db.insert(organizationMemberCampus).values({
		organizationMemberId: consultantMember.id,
		campusId: ids.campusA,
	});
	await db.insert(studentTag).values({
		id: ids.tagId,
		organizationId: ids.organizationId,
		name: "重点学员",
		nameNormalized: "重点学员",
	});
	await db.insert(student).values([
		{
			id: ids.visibleStudentId,
			organizationId: ids.organizationId,
			campusId: ids.campusA,
			name: "可见重复学员",
			guardianName: "可见家长",
			guardianPhone: "13800138001",
			guardianPhoneNormalized: "13800138001",
		},
		{
			id: ids.restrictedStudentId,
			organizationId: ids.organizationId,
			campusId: ids.campusB,
			name: "受限重复学员",
			guardianName: "受限家长",
			guardianPhone: "13800138002",
			guardianPhoneNormalized: "13800138002",
		},
	]);
	await db.insert(studentContact).values([
		{
			studentId: ids.visibleStudentId,
			name: "可见家长",
			phone: "13800138001",
			phoneNormalized: "13800138001",
			isPrimary: true,
		},
		{
			studentId: ids.restrictedStudentId,
			name: "受限家长",
			phone: "13800138002",
			phoneNormalized: "13800138002",
			isPrimary: true,
		},
	]);
}

async function cleanup(ids: Ids) {
	await db.delete(organization).where(eq(organization.id, ids.organizationId));
	await db
		.delete(user)
		.where(inArray(user.id, [ids.ownerUserId, ids.consultantUserId]));
}

function buildCsv(ids: Ids) {
	return [
		"姓名,校区编码,主要联系人姓名,主要联系人手机号,出生日期,状态,负责人邮箱,已有标签",
		`"导入,学员",${ids.campusACode},"主要\n联系人",13600136001,2018-01-02,atRisk,${ids.consultantUserId}@example.invalid,重点学员`,
		`文件重复一,${ids.campusACode},联系人一,13600136002,,trial,,`,
		`文件重复二,${ids.campusACode},联系人二,13600136002,,trial,,`,
		`可见重复,${ids.campusACode},可见联系人,13800138001,,trial,,`,
		`受限重复,${ids.campusACode},受限联系人,13800138002,,trial,,`,
		`未知标签,${ids.campusACode},标签联系人,13600136003,,trial,,不存在标签`,
		`=FORMULA,${ids.campusACode},公式联系人,13600136004,,trial,,`,
		"未知校区,UNKNOWN,校区联系人,13600136005,,trial,,",
	].join("\n");
}

test("学员 CSV 创建型导入支持部分成功、隐私裁剪与幂等重放", async () => {
	const ids = createIds();
	const scope = {
		organizationId: ids.organizationId,
		userId: ids.consultantUserId,
		campusAccess: { kind: "selected" as const, campusIds: [ids.campusA] },
	};
	try {
		await seed(ids);
		const content = buildCsv(ids);
		const preview = await previewStudentImport(scope, { content });
		assert.equal(preview.totalRows, 8);
		assert.equal(preview.validRows, 1, JSON.stringify(preview));
		assert.deepEqual(
			new Set(preview.errors.map((error) => error.code)),
			new Set([
				"DUPLICATE_IN_FILE",
				"DUPLICATE_EXISTING",
				"DUPLICATE_RESTRICTED",
				"TAG_INVALID",
				"FORMULA_VALUE",
				"CAMPUS_INVALID",
			]),
		);
		const visibleDuplicate = preview.errors.find(
			(error) => error.code === "DUPLICATE_EXISTING",
		);
		assert.equal(
			visibleDuplicate?.duplicateCandidate?.id,
			ids.visibleStudentId,
		);
		assert.equal(
			visibleDuplicate?.duplicateCandidate?.phoneMasked,
			"138****8001",
		);
		const restrictedDuplicate = preview.errors.find(
			(error) => error.code === "DUPLICATE_RESTRICTED",
		);
		assert.equal(restrictedDuplicate?.duplicateCandidate, null);
		assert.ok(
			!JSON.stringify(restrictedDuplicate).includes(ids.restrictedStudentId),
		);
		assert.ok(!JSON.stringify(restrictedDuplicate).includes("受限重复学员"));

		const requestId = randomUUID();
		const confirmed = await confirmStudentImport(scope, { requestId, content });
		assert.equal(confirmed.importedRows, 1);
		assert.equal(confirmed.errorRows, 7);
		assert.equal(confirmed.replayed, false);
		assert.deepEqual(
			await confirmStudentImport(scope, { requestId, content }),
			{
				...confirmed,
				replayed: true,
			},
		);
		await assert.rejects(
			confirmStudentImport(scope, {
				requestId,
				content: content.replace("导入,学员", "异载荷学员"),
			}),
			(error: unknown) => {
				assert.ok(error instanceof ORPCError);
				assert.equal(error.code, "CONFLICT");
				return true;
			},
		);

		const [created] = await db
			.select({
				id: student.id,
				name: student.name,
				status: student.status,
				ownerUserId: student.ownerUserId,
				guardianName: student.guardianName,
			})
			.from(student)
			.where(
				and(
					eq(student.organizationId, ids.organizationId),
					eq(student.guardianPhoneNormalized, "13600136001"),
				),
			);
		assert.deepEqual(created && { ...created }, {
			id: created?.id,
			name: "导入,学员",
			status: "at_risk",
			ownerUserId: ids.consultantUserId,
			guardianName: "主要\n联系人",
		});
		assert.ok(created);
		const [
			contacts,
			tags,
			ownerEvents,
			batches,
			audits,
			enrollments,
			invoices,
		] = await Promise.all([
			db
				.select({ phone: studentContact.phone })
				.from(studentContact)
				.where(eq(studentContact.studentId, created.id)),
			db
				.select({ tagId: studentTagAssignment.studentTagId })
				.from(studentTagAssignment)
				.where(eq(studentTagAssignment.studentId, created.id)),
			db
				.select({ source: studentOwnerAssignmentEvent.source })
				.from(studentOwnerAssignmentEvent)
				.where(eq(studentOwnerAssignmentEvent.studentId, created.id)),
			db
				.select()
				.from(studentImportBatch)
				.where(eq(studentImportBatch.organizationId, ids.organizationId)),
			db
				.select({
					action: organizationAuditEvent.action,
					after: organizationAuditEvent.after,
				})
				.from(organizationAuditEvent)
				.where(eq(organizationAuditEvent.organizationId, ids.organizationId)),
			db
				.select({ id: enrollment.id })
				.from(enrollment)
				.where(eq(enrollment.studentId, created.id)),
			db
				.select({ id: invoice.id })
				.from(invoice)
				.where(eq(invoice.studentId, created.id)),
		]);
		assert.deepEqual(contacts, [{ phone: "13600136001" }]);
		assert.deepEqual(tags, [{ tagId: ids.tagId }]);
		assert.deepEqual(ownerEvents, [{ source: "import" }]);
		assert.equal(batches.length, 1);
		assert.equal(
			audits.filter((item) => item.action === "student_imported").length,
			1,
		);
		assert.ok(!JSON.stringify(audits).includes("13600136001"));
		assert.deepEqual(enrollments, []);
		assert.deepEqual(invoices, []);
	} finally {
		await cleanup(ids);
	}
});

test("学员导出按当前角色与校区裁剪并防止公式注入", async () => {
	const ids = createIds();
	try {
		await seed(ids);
		await db
			.update(student)
			.set({ name: "=SUM(A1:A2)" })
			.where(eq(student.id, ids.visibleStudentId));

		await assert.rejects(
			exportStudentRecords({
				organizationId: ids.organizationId,
				userId: ids.consultantUserId,
				limit: 5_000,
			}),
			(error: unknown) => {
				assert.ok(error instanceof StudentImportExportError);
				assert.equal(error.code, "MEMBER_FORBIDDEN");
				return true;
			},
		);

		const result = await exportStudents(
			{
				organizationId: ids.organizationId,
				userId: ids.ownerUserId,
				campusAccess: { kind: "all" },
			},
			{
				query: "=SUM",
				status: "all",
				limit: 5_000,
			},
		);
		assert.ok(result.csv.startsWith("\uFEFF"));
		assert.ok(result.csv.includes('"\'=SUM(A1:A2)"'));
		assert.ok(result.csv.includes("13800138001"));
		assert.ok(!result.csv.includes("13800138002"));
		const [audit] = await db
			.select({ after: organizationAuditEvent.after })
			.from(organizationAuditEvent)
			.where(eq(organizationAuditEvent.action, "student_exported"));
		assert.ok(audit);
		assert.ok(!JSON.stringify(audit.after).includes("13800138001"));
		assert.ok(!JSON.stringify(audit.after).includes("=SUM"));
	} finally {
		await cleanup(ids);
	}
});
