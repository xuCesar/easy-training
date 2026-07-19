import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import {
	confirmLeadImportInputSchema,
	getLeadImportRpcBodyBytes,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	previewLeadImportInputSchema,
} from "../../api/src/contracts/training";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import {
	OperationsRepositoryError,
	previewLeadImport,
} from "../src/repositories/operations";
import {
	campus,
	course,
	lead,
	leadActivity,
	leadImportBatch,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	organizationNotification,
	session,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `operations-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusAOther: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseB: randomUUID(),
		adminA: `${prefix}-admin-a`,
		consultantA: `${prefix}-consultant-a`,
		managerA: `${prefix}-manager-a`,
		ownerB: `${prefix}-owner-b`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function sessionId(userId: string) {
	return `${userId}-session`;
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
				session: { id: sessionId(userId) },
				user: { id: userId, name },
			},
			expectedOrganizationId,
		} as unknown as Context,
	});
}

async function expectOrpcError(promise: Promise<unknown>, code: string) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(typeof error === "object" && error !== null && "code" in error);
		assert.equal(error.code, code);
		return true;
	});
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	const userIds = [ids.adminA, ids.consultantA, ids.managerA, ids.ownerB];
	await db
		.delete(organizationNotification)
		.where(inArray(organizationNotification.organizationId, organizationIds));
	await db
		.delete(organizationAuditEvent)
		.where(inArray(organizationAuditEvent.organizationId, organizationIds));
	await db
		.delete(leadActivity)
		.where(inArray(leadActivity.organizationId, organizationIds));
	await db
		.delete(leadImportBatch)
		.where(inArray(leadImportBatch.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db
		.delete(organizationMemberCampus)
		.where(
			inArray(organizationMemberCampus.campusId, [
				ids.campusA,
				ids.campusAOther,
				ids.campusB,
			]),
		);
	await db
		.delete(course)
		.where(inArray(course.organizationId, organizationIds));
	await db
		.delete(campus)
		.where(inArray(campus.organizationId, organizationIds));
	await db.delete(session).where(inArray(session.userId, userIds));
	await db
		.delete(organizationMember)
		.where(inArray(organizationMember.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db.delete(user).where(inArray(user.id, userIds));
}

async function seedFixture(ids: FixtureIds) {
	const users = [
		[ids.adminA, "A 管理员"],
		[ids.consultantA, "A 招生顾问"],
		[ids.managerA, "A 校区负责人"],
		[ids.ownerB, "B 机构负责人"],
	] as const;
	const now = new Date();
	await db.insert(user).values(
		users.map(([id, name]) => ({
			id,
			name,
			email: `${id}@example.invalid`,
		})),
	);
	await db.insert(session).values(
		users.map(([userId]) => ({
			id: sessionId(userId),
			token: `${sessionId(userId)}-token`,
			userId,
			expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
			updatedAt: now,
		})),
	);
	await db.insert(organization).values([
		{ id: ids.organizationA, name: `${ids.prefix} A` },
		{ id: ids.organizationB, name: `${ids.prefix} B` },
	]);
	const [managerMember] = await db
		.insert(organizationMember)
		.values([
			{ organizationId: ids.organizationA, userId: ids.adminA, role: "admin" },
			{
				organizationId: ids.organizationA,
				userId: ids.consultantA,
				role: "consultant",
			},
			{
				organizationId: ids.organizationA,
				userId: ids.managerA,
				role: "campus_manager",
				campusAccessMode: "selected",
			},
			{ organizationId: ids.organizationB, userId: ids.ownerB, role: "owner" },
		])
		.returning({ id: organizationMember.id });
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationA,
			code: "a-main",
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusAOther,
			organizationId: ids.organizationA,
			code: "a-other",
			name: "A 第二校区",
			city: "上海",
			address: "A2",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationB,
			code: "b-main",
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	await db.insert(organizationMemberCampus).values({
		organizationMemberId: managerMember?.id ?? "",
		campusId: ids.campusA,
	});
	await db.insert(course).values([
		{
			id: ids.courseA,
			organizationId: ids.organizationA,
			code: "course-a",
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
			code: "course-b",
			name: "B 课程",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 10_000,
			lessonsPerPackage: 10,
			tags: [],
		},
	]);
}

const newCsvHeader =
	"姓名,手机号,意向课程编码,来源,负责人邮箱,跟进状态,备注,校区编码";

function contentAtRpcBodyLimit(input: Record<string, unknown>): string {
	const emptyContentBytes = getLeadImportRpcBodyBytes({
		...input,
		content: "",
	});
	return "a".repeat(LEAD_IMPORT_RPC_BODY_LIMIT_BYTES - emptyContentBytes);
}

function assertLeadImportBodySize(
	schema:
		| typeof previewLeadImportInputSchema
		| typeof confirmLeadImportInputSchema,
	input: Record<string, unknown>,
) {
	const result = schema.safeParse(input);
	assert.equal(result.success, false);
	if (result.success) return;
	assert.deepEqual(result.error.issues, [
		{
			code: "custom",
			path: ["content"],
			message: LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
		},
	]);
}

test("导入契约按 oRPC UTF-8 envelope 字节计算 preview 和 confirm 上限", () => {
	const previewBase = { defaultCampusId: null };
	const previewContent = contentAtRpcBodyLimit(previewBase);
	const previewInput = { ...previewBase, content: previewContent };
	assert.equal(
		getLeadImportRpcBodyBytes(previewInput),
		LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	);
	assert.equal(
		previewLeadImportInputSchema.safeParse(previewInput).success,
		true,
	);
	assertLeadImportBodySize(previewLeadImportInputSchema, {
		...previewBase,
		content: `${previewContent}a`,
	});

	const confirmBase = { requestId: randomUUID(), defaultCampusId: null };
	const confirmContent = contentAtRpcBodyLimit(confirmBase);
	const confirmInput = { ...confirmBase, content: confirmContent };
	assert.equal(
		getLeadImportRpcBodyBytes(confirmInput),
		LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	);
	assert.equal(
		confirmLeadImportInputSchema.safeParse(confirmInput).success,
		true,
	);
	assertLeadImportBodySize(confirmLeadImportInputSchema, {
		...confirmBase,
		content: `${confirmContent}a`,
	});

	const escapedUnicodeInput = {
		content: '姓名,"中文\\\\路径"\n李雷,13800000001,\\"来源\\"',
	};
	assert.equal(
		getLeadImportRpcBodyBytes(escapedUnicodeInput),
		Buffer.byteLength(JSON.stringify({ json: escapedUnicodeInput }), "utf8"),
	);
	assert.ok(
		getLeadImportRpcBodyBytes(escapedUnicodeInput) >
			escapedUnicodeInput.content.length,
	);
});

test("仓储 CSV 防线按 UTF-8 字节而非 JavaScript 字符数拒绝超限内容", async () => {
	const withinByteLimit = `${"中".repeat(166_666)}ab`;
	assert.equal(Buffer.byteLength(withinByteLimit, "utf8"), 500_000);
	await assert.rejects(
		previewLeadImport({
			organizationId: randomUUID(),
			userId: randomUUID(),
			campusAccess: { kind: "all" },
			defaultCampusId: null,
			content: withinByteLimit,
		}),
		(error: unknown) =>
			error instanceof OperationsRepositoryError &&
			error.code === "IMPORT_INVALID_CSV",
	);

	const exceedsByteLimit = `${"中".repeat(166_666)}abc`;
	assert.equal(Buffer.byteLength(exceedsByteLimit, "utf8"), 500_001);
	await assert.rejects(
		previewLeadImport({
			organizationId: randomUUID(),
			userId: randomUUID(),
			campusAccess: { kind: "all" },
			defaultCampusId: null,
			content: exceedsByteLimit,
		}),
		(error: unknown) =>
			error instanceof OperationsRepositoryError &&
			error.code === "IMPORT_LIMIT_EXCEEDED",
	);
});

test("八列 CSV 解析关联项，旧 CSV 使用默认校区并逐行报告无效课程和校区", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const admin = createSessionClient(
			ids.adminA,
			"A 管理员",
			ids.organizationA,
		);
		const validCsv = [
			newCsvHeader,
			`新格式线索,13800000001,course-a,线上咨询,${ids.consultantA}@example.invalid,contacted,需要试听,a-other`,
		].join("\n");
		const preview = await admin.training.leads.import.preview({
			content: validCsv,
		});
		assert.deepEqual(preview, { totalRows: 1, validRows: 1, errors: [] });
		const created = await admin.training.leads.import.confirm({
			requestId: randomUUID(),
			content: validCsv,
		});
		assert.equal(created.importedRows, 1);
		assert.equal(created.errorRows, 0);
		const [newLead] = await db
			.select({
				campusId: lead.campusId,
				interestedCourseId: lead.interestedCourseId,
				ownerUserId: lead.ownerUserId,
				stage: lead.stage,
				note: lead.note,
			})
			.from(lead)
			.where(
				and(
					eq(lead.organizationId, ids.organizationA),
					eq(lead.name, "新格式线索"),
				),
			);
		assert.deepEqual(newLead, {
			campusId: ids.campusAOther,
			interestedCourseId: ids.courseA,
			ownerUserId: ids.consultantA,
			stage: "contacted",
			note: "需要试听",
		});

		const oldCsv = "姓名,手机号,来源\n旧格式线索,13800000002,地推";
		const oldResult = await admin.training.leads.import.confirm({
			requestId: randomUUID(),
			defaultCampusId: ids.campusA,
			content: oldCsv,
		});
		assert.equal(oldResult.importedRows, 1);
		const [oldLead] = await db
			.select({ campusId: lead.campusId, ownerUserId: lead.ownerUserId })
			.from(lead)
			.where(
				and(
					eq(lead.organizationId, ids.organizationA),
					eq(lead.name, "旧格式线索"),
				),
			);
		assert.deepEqual(oldLead, {
			campusId: ids.campusA,
			ownerUserId: ids.adminA,
		});

		const invalidRows = await admin.training.leads.import.preview({
			content: [
				newCsvHeader,
				"无效课程,13800000003,course-b,线上咨询,,new,,a-main",
				"无效校区,13800000004,course-a,线上咨询,,new,,b-main",
			].join("\n"),
		});
		assert.equal(invalidRows.totalRows, 2);
		assert.equal(invalidRows.validRows, 0);
		assert.deepEqual(
			invalidRows.errors.map((error) => error.row),
			[2, 3],
		);
		assert.match(invalidRows.errors[0]?.message ?? "", /意向课程编码不存在/);
		assert.match(
			invalidRows.errors[1]?.message ?? "",
			/校区编码不存在、已停用或不在当前可访问范围/,
		);

		const scopedManager = createSessionClient(
			ids.managerA,
			"A 校区负责人",
			ids.organizationA,
		);
		const scopedResult = await scopedManager.training.leads.import.preview({
			content: [
				newCsvHeader,
				"越校区,13800000005,course-a,线上咨询,,new,,a-other",
			].join("\n"),
		});
		assert.equal(scopedResult.validRows, 0);
		assert.match(
			scopedResult.errors[0]?.message ?? "",
			/校区编码不存在、已停用或不在当前可访问范围/,
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("通知仅收件人可读取和标记已读，并记录通知审计", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const admin = createSessionClient(
			ids.adminA,
			"A 管理员",
			ids.organizationA,
		);
		const consultant = createSessionClient(
			ids.consultantA,
			"A 招生顾问",
			ids.organizationA,
		);
		const importResult = await admin.training.leads.import.confirm({
			requestId: randomUUID(),
			defaultCampusId: ids.campusA,
			content: "姓名,手机号,来源\n通知线索,13800000006,活动",
		});
		const adminNotifications = await admin.training.notifications.list({});
		assert.equal(adminNotifications.unreadCount, 1);
		assert.equal(adminNotifications.items.length, 1);
		assert.equal(adminNotifications.items[0]?.entityId, importResult.batchId);
		assert.equal(
			(await consultant.training.notifications.list({})).items.length,
			0,
		);
		await expectOrpcError(
			consultant.training.notifications.read({
				id: adminNotifications.items[0]?.id ?? randomUUID(),
			}),
			"NOT_FOUND",
		);
		const read = await admin.training.notifications.read({
			id: adminNotifications.items[0]?.id ?? "",
		});
		assert.deepEqual(read, { count: 1 });
		assert.equal((await admin.training.notifications.list({})).unreadCount, 0);
		const audit = await admin.training.audit.list({
			action: "notification_read",
		});
		assert.equal(audit.items.length, 1);
		assert.equal(audit.items[0]?.entityId, adminNotifications.items[0]?.id);
		assert.equal(audit.items[0]?.actorUserId, ids.adminA);
	} finally {
		await cleanupFixture(ids);
	}
});

test("导入回放不重复写入，不同内容冲突，审计按机构隔离", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const admin = createSessionClient(
			ids.adminA,
			"A 管理员",
			ids.organizationA,
		);
		const consultant = createSessionClient(
			ids.consultantA,
			"A 招生顾问",
			ids.organizationA,
		);
		const ownerB = createSessionClient(
			ids.ownerB,
			"B 机构负责人",
			ids.organizationB,
		);
		const requestId = randomUUID();
		const content = "姓名,手机号,来源\n可回放线索,13800000007,自然到店";
		const first = await admin.training.leads.import.confirm({
			requestId,
			defaultCampusId: ids.campusA,
			content,
		});
		const replay = await admin.training.leads.import.confirm({
			requestId,
			defaultCampusId: ids.campusA,
			content,
		});
		assert.equal(first.replayed, false);
		assert.equal(replay.replayed, true);
		assert.equal(replay.batchId, first.batchId);
		await expectOrpcError(
			consultant.training.leads.import.confirm({
				requestId,
				defaultCampusId: ids.campusA,
				content,
			}),
			"CONFLICT",
		);
		const importedLeads = await db
			.select({ id: lead.id })
			.from(lead)
			.where(
				and(
					eq(lead.organizationId, ids.organizationA),
					eq(lead.name, "可回放线索"),
				),
			);
		assert.equal(importedLeads.length, 1);
		await expectOrpcError(
			admin.training.leads.import.confirm({
				requestId,
				defaultCampusId: ids.campusA,
				content: "姓名,手机号,来源\n冲突内容,13800000008,自然到店",
			}),
			"CONFLICT",
		);

		await db.insert(organizationAuditEvent).values({
			organizationId: ids.organizationB,
			action: "lead_exported",
			entityType: "lead_export",
			entityId: randomUUID(),
			actorUserId: ids.ownerB,
		});
		const auditsA = await admin.training.audit.list({
			action: "lead_imported",
		});
		assert.equal(auditsA.items.length, 1);
		assert.equal(auditsA.items[0]?.entityId, first.batchId);
		const auditsB = await ownerB.training.audit.list({});
		assert.equal(auditsB.items.length, 1);
		assert.equal(auditsB.items[0]?.actorUserId, ids.ownerB);
		assert.notEqual(auditsB.items[0]?.entityId, first.batchId);
	} finally {
		await cleanupFixture(ids);
	}
});
