import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import { currentOrganizationSchema } from "../../api/src/contracts/training";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import {
	getOrCreateCurrentOrganization,
	OrganizationContextError,
} from "../src/repositories/organization";
import { organization, organizationMember, session, user } from "../src/schema";

function createPrefix() {
	return `organization-context-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function insertUser(userId: string, name: string, initialized = false) {
	await db.insert(user).values({
		id: userId,
		name,
		email: `${userId}@example.invalid`,
		organizationInitializedAt: initialized ? new Date() : null,
	});
}

async function insertSession(sessionId: string, userId: string) {
	const now = new Date();
	await db.insert(session).values({
		id: sessionId,
		token: `${sessionId}-token`,
		userId,
		expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
		updatedAt: now,
	});
}

async function cleanup(userIds: string[], organizationIds: string[]) {
	await db.delete(session).where(inArray(session.userId, userIds));
	await db
		.delete(organizationMember)
		.where(inArray(organizationMember.userId, userIds));
	if (organizationIds.length > 0) {
		await db
			.delete(organization)
			.where(inArray(organization.id, organizationIds));
	}
	await db.delete(user).where(inArray(user.id, userIds));
}

function createSessionClient(userId: string, name: string, sessionId: string) {
	return createRouterClient(appRouter, {
		context: {
			auth: null,
			session: {
				session: { id: sessionId },
				user: { id: userId, name },
			},
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

test("单机构默认选择会持久化到当前 session", async () => {
	const prefix = createPrefix();
	const userId = `${prefix}-user`;
	const sessionId = `${prefix}-session`;
	const organizationId = randomUUID();

	try {
		await insertUser(userId, "单机构用户");
		await insertSession(sessionId, userId);
		await db
			.insert(organization)
			.values({ id: organizationId, name: "默认机构" });
		await db.insert(organizationMember).values({
			organizationId,
			userId,
			role: "admin",
		});

		const client = createSessionClient(userId, "单机构用户", sessionId);
		const current = currentOrganizationSchema.parse(
			await client.training.organization.current(),
		);
		assert.deepEqual(current, {
			id: organizationId,
			name: "默认机构",
			role: "admin",
			organizations: [{ id: organizationId, name: "默认机构", role: "admin" }],
		});

		const [persistedSession] = await db
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(eq(session.id, sessionId));
		const [persistedUser] = await db
			.select({ initializedAt: user.organizationInitializedAt })
			.from(user)
			.where(eq(user.id, userId));
		assert.equal(persistedSession?.activeOrganizationId, organizationId);
		assert.ok(persistedUser?.initializedAt instanceof Date);
	} finally {
		await cleanup([userId], [organizationId]);
	}
});

test("多机构可按 session 独立选择，非法选择不改变状态，membership 撤销后回退", async () => {
	const prefix = createPrefix();
	const userId = `${prefix}-user`;
	const sessionA = `${prefix}-session-a`;
	const sessionB = `${prefix}-session-b`;
	const organizationA = randomUUID();
	const organizationB = randomUUID();
	const inaccessibleOrganization = randomUUID();

	try {
		await insertUser(userId, "多机构用户");
		await insertSession(sessionA, userId);
		await insertSession(sessionB, userId);
		await db.insert(organization).values([
			{ id: organizationA, name: "机构 A" },
			{ id: organizationB, name: "机构 B" },
			{ id: inaccessibleOrganization, name: "无权机构" },
		]);
		await db.insert(organizationMember).values([
			{
				organizationId: organizationA,
				userId,
				role: "owner",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				organizationId: organizationB,
				userId,
				role: "teacher",
				createdAt: new Date("2026-02-01T00:00:00.000Z"),
			},
		]);

		const clientA = createSessionClient(userId, "多机构用户", sessionA);
		const clientB = createSessionClient(userId, "多机构用户", sessionB);
		const initial = await clientA.training.organization.current();
		assert.equal(initial.id, organizationA);
		assert.deepEqual(
			initial.organizations.map((item) => item.id),
			[organizationA, organizationB],
		);

		const selected = await clientA.training.organization.select({
			organizationId: organizationB,
		});
		assert.equal(selected.id, organizationB);
		assert.equal(selected.role, "teacher");
		assert.equal(
			(await clientB.training.organization.current()).id,
			organizationA,
		);

		await expectOrpcError(
			clientA.training.organization.select({
				organizationId: inaccessibleOrganization,
			}),
			"NOT_FOUND",
		);
		const [afterIllegalSelection] = await db
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(eq(session.id, sessionA));
		assert.equal(afterIllegalSelection?.activeOrganizationId, organizationB);

		await db
			.delete(organizationMember)
			.where(eq(organizationMember.organizationId, organizationB));
		const fallback = await clientA.training.organization.current();
		assert.equal(fallback.id, organizationA);
		const [afterFallback] = await db
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(eq(session.id, sessionA));
		assert.equal(afterFallback?.activeOrganizationId, organizationA);

		await db
			.delete(organizationMember)
			.where(eq(organizationMember.userId, userId));
		await expectOrpcError(clientA.training.organization.current(), "FORBIDDEN");
		const membershipsAfterRemoval = await db
			.select({ id: organizationMember.id })
			.from(organizationMember)
			.where(eq(organizationMember.userId, userId));
		assert.equal(membershipsAfterRemoval.length, 0);

		const missingSessionClient = createSessionClient(
			userId,
			"多机构用户",
			`${prefix}-missing-session`,
		);
		await expectOrpcError(
			missingSessionClient.training.organization.select({
				organizationId: organizationA,
			}),
			"UNAUTHORIZED",
		);
	} finally {
		await cleanup(
			[userId],
			[organizationA, organizationB, inaccessibleOrganization],
		);
	}
});

test("并发首次访问只创建一个初始机构并为两个 session 建立选择", async () => {
	const prefix = createPrefix();
	const userId = `${prefix}-user`;
	const sessionA = `${prefix}-session-a`;
	const sessionB = `${prefix}-session-b`;
	const createdOrganizationIds: string[] = [];

	try {
		await insertUser(userId, "并发用户");
		await insertSession(sessionA, userId);
		await insertSession(sessionB, userId);

		const results = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				getOrCreateCurrentOrganization({
					userId,
					userName: "并发用户",
					sessionId: index % 2 === 0 ? sessionA : sessionB,
					allowAutoCreateOrganization: true,
				}),
			),
		);
		createdOrganizationIds.push(results[0]?.organization.id ?? "");
		assert.equal(new Set(results.map((item) => item.organization.id)).size, 1);

		const memberships = await db
			.select({ organizationId: organizationMember.organizationId })
			.from(organizationMember)
			.where(eq(organizationMember.userId, userId));
		assert.equal(memberships.length, 1);
		const sessions = await db
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(eq(session.userId, userId));
		assert.equal(sessions.length, 2);
		assert.ok(
			sessions.every(
				(item) => item.activeOrganizationId === memberships[0]?.organizationId,
			),
		);

		await assert.rejects(
			getOrCreateCurrentOrganization({
				userId,
				userName: "并发用户",
				sessionId: `${prefix}-missing-session`,
			}),
			(error: unknown) =>
				error instanceof OrganizationContextError &&
				error.code === "SESSION_NOT_FOUND",
		);
	} finally {
		await cleanup([userId], createdOrganizationIds.filter(Boolean));
	}
});

test("关闭自动建机构时无 membership 用户会收到 ORGANIZATION_MEMBERSHIP_REQUIRED", async () => {
	const prefix = createPrefix();
	const userId = `${prefix}-user`;
	const sessionId = `${prefix}-session`;

	try {
		await insertUser(userId, "无机构用户");
		await insertSession(sessionId, userId);

		await assert.rejects(
			getOrCreateCurrentOrganization({
				userId,
				userName: "无机构用户",
				sessionId,
				allowAutoCreateOrganization: false,
			}),
			(error: unknown) =>
				error instanceof OrganizationContextError &&
				error.code === "ORGANIZATION_MEMBERSHIP_REQUIRED",
		);
	} finally {
		await cleanup([userId], []);
	}
});
