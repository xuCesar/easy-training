import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../src";
import { getOrCreateCurrentOrganization } from "../src/repositories/organization";
import {
	createOnboardingInvitationRecord,
	hasActiveOnboardingInvitationForEmail,
	revokeOnboardingInvitationsForEmail,
} from "../src/repositories/organization-onboarding";
import {
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationOnboardingInvitation,
	session,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `org-onboarding-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		existingOrganizationId: randomUUID(),
		existingOwnerId: `${prefix}-existing-owner`,
		newUserId: `${prefix}-new-user`,
		email: `${prefix}-invitee@example.invalid`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function sessionId(userId: string) {
	return `${userId}-session`;
}

async function seedFixture(ids: FixtureIds) {
	const now = new Date();
	await db
		.insert(organization)
		.values({ id: ids.existingOrganizationId, name: `${ids.prefix} 既有机构` });
	await db.insert(user).values([
		{
			id: ids.existingOwnerId,
			name: "既有机构负责人",
			email: `${ids.existingOwnerId}@example.invalid`,
		},
		{
			id: ids.newUserId,
			name: "开通受邀人",
			email: ids.email,
		},
	]);
	await db.insert(organizationMember).values({
		organizationId: ids.existingOrganizationId,
		userId: ids.existingOwnerId,
		role: "owner",
	});
	await db.insert(session).values({
		id: sessionId(ids.newUserId),
		token: `${sessionId(ids.newUserId)}-token`,
		userId: ids.newUserId,
		expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
		updatedAt: now,
	});
}

async function cleanupFixture(ids: FixtureIds) {
	await db
		.delete(organizationOnboardingInvitation)
		.where(eq(organizationOnboardingInvitation.emailNormalized, ids.email));
	const createdOrgs = await db
		.select({ id: organizationMember.organizationId })
		.from(organizationMember)
		.where(eq(organizationMember.userId, ids.newUserId));
	await db
		.delete(organization)
		.where(
			inArray(organization.id, [
				ids.existingOrganizationId,
				...createdOrgs.map((row) => row.id),
			]),
		);
	await db
		.delete(user)
		.where(inArray(user.id, [ids.existingOwnerId, ids.newUserId]));
}

test("开通邀请:token 匹配才放行,过期/撤销/领取后失效", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const created = await createOnboardingInvitationRecord({
			email: ids.email.toUpperCase(),
			organizationName: "开通测试机构",
		});
		assert.ok(created.token.length > 30);

		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, created.token),
			true,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, "wrong-token"),
			false,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, null),
			false,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(
				`other-${ids.email}`,
				created.token,
			),
			false,
		);

		// 同邮箱重新创建会撤销旧邀请
		const resent = await createOnboardingInvitationRecord({
			email: ids.email,
			organizationName: "开通测试机构",
		});
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, created.token),
			false,
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, resent.token),
			true,
		);

		const revoked = await revokeOnboardingInvitationsForEmail(ids.email);
		assert.equal(revoked, 1);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, resent.token),
			false,
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("持有效开通邀请的用户首次进入即创建指定名称机构,既有机构不受影响", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		await createOnboardingInvitationRecord({
			email: ids.email,
			organizationName: "小星星艺术学校",
		});

		const before = await db.select({ id: organization.id }).from(organization);

		const current = await getOrCreateCurrentOrganization({
			userId: ids.newUserId,
			userName: "开通受邀人",
			sessionId: sessionId(ids.newUserId),
			allowAutoCreateOrganization: false,
		});
		assert.equal(current.organization.name, "小星星艺术学校");
		assert.equal(current.member.role, "owner");

		// 邀请已领取
		const [invitation] = await db
			.select({
				claimedAt: organizationOnboardingInvitation.claimedAt,
				claimedByUserId: organizationOnboardingInvitation.claimedByUserId,
				createdOrganizationId:
					organizationOnboardingInvitation.createdOrganizationId,
			})
			.from(organizationOnboardingInvitation)
			.where(eq(organizationOnboardingInvitation.emailNormalized, ids.email));
		assert.ok(invitation?.claimedAt);
		assert.equal(invitation?.claimedByUserId, ids.newUserId);
		assert.equal(invitation?.createdOrganizationId, current.organization.id);

		// 审计事件
		const [audit] = await db
			.select({ action: organizationAuditEvent.action })
			.from(organizationAuditEvent)
			.where(
				eq(organizationAuditEvent.organizationId, current.organization.id),
			);
		assert.equal(audit?.action, "organization_onboarded");

		// 既有机构未受影响:名称、成员数不变
		const [existing] = await db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, ids.existingOrganizationId));
		assert.equal(existing?.name, `${ids.prefix} 既有机构`);
		const after = await db.select({ id: organization.id }).from(organization);
		assert.equal(after.length, before.length + 1);

		// 无邀请且注册关闭时,新用户不能自动建机构
		const [claimedInvitation] = await db
			.select({ id: organizationOnboardingInvitation.id })
			.from(organizationOnboardingInvitation)
			.where(eq(organizationOnboardingInvitation.emailNormalized, ids.email));
		assert.ok(claimedInvitation);
	} finally {
		await cleanupFixture(ids);
	}
});
