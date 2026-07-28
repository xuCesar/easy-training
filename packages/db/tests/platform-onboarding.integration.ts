import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import { hasActiveOnboardingInvitationForEmail } from "../src/repositories/organization-onboarding";
import {
	organization,
	organizationMember,
	organizationOnboardingInvitation,
	platformAuditEvent,
	user,
} from "../src/schema";

const operatorEmail = "platform-operator@example.invalid";

function createClient(input: {
	userId: string;
	email: string;
	emailVerified: boolean;
}) {
	return createRouterClient(appRouter, {
		context: {
			auth: null,
			onboardingToken: null,
			expectedOrganizationId: null,
			session: {
				session: { id: `${input.userId}-session` },
				user: {
					id: input.userId,
					name: "平台测试用户",
					email: input.email,
					emailVerified: input.emailVerified,
				},
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

test("平台开通管理:授权边界、显式轮换、幂等撤销与脱敏审计", async () => {
	const prefix = `platform-onboarding-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const operatorId = `${prefix}-operator`;
	const ordinaryOwnerId = `${prefix}-owner`;
	const unverifiedId = `${prefix}-unverified`;
	const targetEmail = `${prefix}@example.invalid`;
	const organizationId = randomUUID();
	const invitationIds: string[] = [];

	try {
		await db.insert(user).values([
			{
				id: operatorId,
				name: "平台操作员",
				email: operatorEmail,
				emailVerified: true,
			},
			{
				id: ordinaryOwnerId,
				name: "普通机构负责人",
				email: `${prefix}-owner@example.invalid`,
				emailVerified: true,
			},
			{
				id: unverifiedId,
				name: "未验证平台邮箱",
				email: operatorEmail.toUpperCase(),
				emailVerified: false,
			},
		]);
		await db.insert(organization).values({
			id: organizationId,
			name: "普通负责人所属机构",
		});
		await db.insert(organizationMember).values({
			organizationId,
			userId: ordinaryOwnerId,
			role: "owner",
		});

		const operator = createClient({
			userId: operatorId,
			email: operatorEmail.toUpperCase(),
			emailVerified: true,
		});
		const ordinaryOwner = createClient({
			userId: ordinaryOwnerId,
			email: `${prefix}-owner@example.invalid`,
			emailVerified: true,
		});
		const unverified = createClient({
			userId: unverifiedId,
			email: operatorEmail,
			emailVerified: false,
		});

		assert.deepEqual(await operator.platform.access.get(), {
			canManageOnboarding: true,
		});
		assert.deepEqual(await ordinaryOwner.platform.access.get(), {
			canManageOnboarding: false,
		});
		assert.deepEqual(await unverified.platform.access.get(), {
			canManageOnboarding: false,
		});
		await expectOrpcError(
			ordinaryOwner.platform.onboarding.list({ limit: 10 }),
			"FORBIDDEN",
		);
		await expectOrpcError(
			unverified.platform.onboarding.list({ limit: 10 }),
			"FORBIDDEN",
		);

		const createRequestId = randomUUID();
		const created = await operator.platform.onboarding.create({
			email: targetEmail.toUpperCase(),
			organizationName: "待完善机构",
			note: "测试备注不应进入审计",
			requestId: createRequestId,
		});
		invitationIds.push(created.id);
		assert.match(created.invitationUrl, /\/onboard#token=/);
		const originalToken = new URL(created.invitationUrl).hash.slice(
			"#token=".length,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(targetEmail, originalToken),
			true,
		);
		await expectOrpcError(
			operator.platform.onboarding.create({
				email: targetEmail,
				organizationName: "不会覆盖旧链接",
				requestId: randomUUID(),
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			operator.platform.onboarding.create({
				email: `${prefix}-replay@example.invalid`,
				organizationName: "请求重放",
				requestId: createRequestId,
			}),
			"CONFLICT",
		);

		const initialList = await operator.platform.onboarding.list({
			limit: 10,
			email: targetEmail,
		});
		assert.equal(initialList.items.length, 1);
		assert.equal(initialList.items[0]?.status, "pending");
		assert.equal(initialList.items[0]?.createdBy?.id, operatorId);
		assert.equal(JSON.stringify(initialList).includes(originalToken), false);

		const rotated = await operator.platform.onboarding.rotate({
			invitationId: created.id,
			requestId: randomUUID(),
		});
		invitationIds.push(rotated.id);
		const rotatedToken = new URL(rotated.invitationUrl).hash.slice(
			"#token=".length,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(targetEmail, originalToken),
			false,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(targetEmail, rotatedToken),
			true,
		);

		const revoked = await operator.platform.onboarding.revoke({
			invitationId: rotated.id,
		});
		const replayedRevoke = await operator.platform.onboarding.revoke({
			invitationId: rotated.id,
		});
		assert.deepEqual(replayedRevoke, revoked);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(targetEmail, rotatedToken),
			false,
		);

		const audits = await db
			.select({
				action: platformAuditEvent.action,
				metadata: platformAuditEvent.metadata,
			})
			.from(platformAuditEvent)
			.where(inArray(platformAuditEvent.entityId, invitationIds));
		assert.deepEqual(
			audits.map((audit) => audit.action).sort(),
			[
				"onboarding_invitation_created",
				"onboarding_invitation_revoked",
				"onboarding_invitation_rotated",
			].sort(),
		);
		assert.equal(JSON.stringify(audits).includes(originalToken), false);
		assert.equal(JSON.stringify(audits).includes(rotatedToken), false);
		assert.equal(JSON.stringify(audits).includes("测试备注"), false);
	} finally {
		if (invitationIds.length > 0) {
			await db
				.delete(platformAuditEvent)
				.where(inArray(platformAuditEvent.entityId, invitationIds));
		}
		await db
			.delete(organizationOnboardingInvitation)
			.where(eq(organizationOnboardingInvitation.emailNormalized, targetEmail));
		await db
			.delete(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, organizationId),
					eq(organizationMember.userId, ordinaryOwnerId),
				),
			);
		await db.delete(organization).where(eq(organization.id, organizationId));
		await db
			.delete(user)
			.where(inArray(user.id, [operatorId, ordinaryOwnerId, unverifiedId]));
	}
});
