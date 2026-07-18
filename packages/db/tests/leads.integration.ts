import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import {
	createLeadResultSchema,
	leadHistoryResultSchema,
	leadListResultSchema,
} from "../../api/src/contracts/training";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import {
	campus,
	course,
	lead,
	leadActivity,
	organization,
	organizationMember,
	session,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `leads-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusAOther: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseB: randomUUID(),
		admin: `${prefix}-admin`,
		consultant: `${prefix}-consultant`,
		teacher: `${prefix}-teacher`,
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
	const userIds = [ids.admin, ids.consultant, ids.teacher, ids.ownerB];
	await db
		.delete(leadActivity)
		.where(inArray(leadActivity.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
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
		[ids.admin, "招生管理员"],
		[ids.consultant, "招生顾问"],
		[ids.teacher, "授课教师"],
		[ids.ownerB, "B 机构负责人"],
	] as const;
	const now = new Date();
	await db
		.insert(user)
		.values(
			users.map(([id, name]) => ({ id, name, email: `${id}@example.invalid` })),
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
	await db.insert(organizationMember).values([
		{ organizationId: ids.organizationA, userId: ids.admin, role: "admin" },
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
			id: ids.campusAOther,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a-other`,
			name: "A 第二校区",
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
}

test("线索分页、筛选与租户范围符合当前机构上下文", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const baseDate = new Date("2026-07-01T00:00:00.000Z");
		const leadRows = Array.from({ length: 23 }, (_, index) => ({
			id: randomUUID(),
			organizationId: ids.organizationA,
			campusId: index % 2 === 0 ? ids.campusA : ids.campusAOther,
			interestedCourseId: ids.courseA,
			ownerUserId: index % 3 === 0 ? ids.consultant : ids.admin,
			name: `分页线索 ${index}`,
			phone: `1380000${String(index).padStart(4, "0")}`,
			source: "测试导入",
			stage: "new" as const,
			createdAt: new Date(baseDate.getTime() + index * 60_000),
			updatedAt: new Date(baseDate.getTime() + index * 60_000),
		}));
		await db.insert(lead).values([
			...leadRows,
			{
				id: randomUUID(),
				organizationId: ids.organizationB,
				campusId: ids.campusB,
				interestedCourseId: ids.courseB,
				ownerUserId: ids.ownerB,
				name: "B 机构线索",
				phone: "13900000000",
				source: "测试导入",
				stage: "new",
				createdAt: baseDate,
				updatedAt: baseDate,
			},
		]);

		const client = createSessionClient(
			ids.admin,
			"招生管理员",
			ids.organizationA,
		);
		const defaultPage = leadListResultSchema.parse(
			await client.training.leads.list({}),
		);
		assert.equal(defaultPage.total, 23);
		assert.equal(defaultPage.items.length, 20);
		assert.ok(defaultPage.nextCursor);

		const pageIds: string[] = [];
		let cursor: string | undefined;
		do {
			const page = leadListResultSchema.parse(
				await client.training.leads.list({ cursor, pageSize: 7 }),
			);
			pageIds.push(...page.items.map((item) => item.id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		assert.equal(pageIds.length, 23);
		assert.equal(new Set(pageIds).size, 23);

		const maximumPage = await client.training.leads.list({ pageSize: 50 });
		assert.equal(maximumPage.items.length, 23);
		assert.equal(maximumPage.nextCursor, null);

		const campusFiltered = await client.training.leads.list({
			campusId: ids.campusA,
			pageSize: 50,
		});
		assert.equal(campusFiltered.items.length, 12);
		assert.ok(
			campusFiltered.items.every((item) => item.campusId === ids.campusA),
		);

		const ownerFiltered = await client.training.leads.list({
			ownerUserId: ids.consultant,
			pageSize: 50,
		});
		assert.equal(ownerFiltered.items.length, 8);
		assert.ok(
			ownerFiltered.items.every((item) => item.ownerUserId === ids.consultant),
		);

		const createdAtFiltered = await client.training.leads.list({
			createdAtFrom: new Date(baseDate.getTime() + 5 * 60_000).toISOString(),
			createdAtTo: new Date(baseDate.getTime() + 9 * 60_000).toISOString(),
			pageSize: 50,
		});
		assert.equal(createdAtFiltered.items.length, 5);
		assert.ok(
			createdAtFiltered.items.every(
				(item) =>
					item.createdAt >=
						new Date(baseDate.getTime() + 5 * 60_000).toISOString() &&
					item.createdAt <=
						new Date(baseDate.getTime() + 9 * 60_000).toISOString(),
			),
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("创建幂等、跟进历史、失单原因与已报名限制保持一致", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const client = createSessionClient(
			ids.admin,
			"招生管理员",
			ids.organizationA,
		);
		const requestId = randomUUID();
		const input = {
			name: "幂等线索",
			phone: "13800000001",
			source: "线上咨询",
			stage: "new" as const,
			campusId: ids.campusA,
			interestedCourseId: ids.courseA,
			nextFollowAt: null,
			note: "首次登记",
			requestId,
		};
		const created = createLeadResultSchema.parse(
			await client.training.leads.create(input),
		);
		assert.equal(created.replayed, false);
		const replayed = createLeadResultSchema.parse(
			await client.training.leads.create(input),
		);
		assert.equal(replayed.replayed, true);
		assert.equal(replayed.lead.id, created.lead.id);
		await expectOrpcError(
			client.training.leads.create({ ...input, name: "冲突线索" }),
			"CONFLICT",
		);

		const concurrentRequestId = randomUUID();
		const concurrentInput = {
			...input,
			name: "并发幂等线索",
			phone: "13800000002",
			requestId: concurrentRequestId,
		};
		const concurrent = await Promise.all([
			client.training.leads.create(concurrentInput),
			client.training.leads.create(concurrentInput),
		]);
		assert.equal(concurrent[0].lead.id, concurrent[1].lead.id);
		const concurrentRows = await db
			.select({ id: lead.id })
			.from(lead)
			.where(
				and(
					eq(lead.organizationId, ids.organizationA),
					eq(lead.requestId, concurrentRequestId),
				),
			);
		assert.equal(concurrentRows.length, 1);

		const followAt = "2026-07-20T08:00:00.000+08:00";
		await client.training.leads.followUp({
			leadId: created.lead.id,
			content: "已确认试听需求",
			stage: "lost",
			nextFollowAt: followAt,
			lostReason: "时间无法协调",
		});
		const history = leadHistoryResultSchema.parse(
			await client.training.leads.history({ leadId: created.lead.id }),
		);
		assert.equal(history.items.length, 2);
		assert.deepEqual(
			history.items.map((item) => item.type),
			["followedUp", "created"],
		);
		assert.deepEqual(
			history.items[0] && {
				stage: history.items[0].stage,
				content: history.items[0].content,
				lostReason: history.items[0].lostReason,
				nextFollowAt: history.items[0].nextFollowAt,
				op: history.items[0].operatorUserId,
			},
			{
				stage: "lost",
				content: "已确认试听需求",
				lostReason: "时间无法协调",
				nextFollowAt: new Date(followAt).toISOString(),
				op: ids.admin,
			},
		);

		const enrolledLeadId = randomUUID();
		await db.insert(lead).values({
			id: enrolledLeadId,
			organizationId: ids.organizationA,
			name: "已报名线索",
			phone: "13800000003",
			source: "转介绍",
			stage: "enrolled",
		});
		await expectOrpcError(
			client.training.leads.followUp({
				leadId: enrolledLeadId,
				content: "不应允许跟进",
				stage: "contacted",
				nextFollowAt: null,
				lostReason: null,
			}),
			"CONFLICT",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("线索导出仅向运营角色开放，且不泄漏其他租户数据", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		await db.insert(lead).values([
			{
				organizationId: ids.organizationA,
				name: "A 导出线索",
				phone: "13800000004",
				source: "=SUM(1,1)",
				stage: "new",
			},
			{
				organizationId: ids.organizationB,
				name: "B 私有线索",
				phone: "13900000004",
				source: "公众号",
				stage: "new",
			},
		]);
		const adminClient = createSessionClient(
			ids.admin,
			"招生管理员",
			ids.organizationA,
		);
		const exported = await adminClient.training.leads.export({ limit: 100 });
		assert.match(exported.fileName, /^招生线索-\d{4}-\d{2}-\d{2}\.csv$/);
		assert.match(exported.csv, /A 导出线索/);
		assert.match(exported.csv, /"'=SUM\(1,1\)"/);
		assert.doesNotMatch(exported.csv, /B 私有线索/);

		const consultantClient = createSessionClient(
			ids.consultant,
			"招生顾问",
			ids.organizationA,
		);
		await expectOrpcError(
			consultantClient.training.leads.export({ limit: 100 }),
			"FORBIDDEN",
		);
		const teacherClient = createSessionClient(
			ids.teacher,
			"授课教师",
			ids.organizationA,
		);
		await expectOrpcError(teacherClient.training.leads.list({}), "FORBIDDEN");
	} finally {
		await cleanupFixture(ids);
	}
});
