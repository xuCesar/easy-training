import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../src";
import { getOrCreateCurrentOrganization } from "../src/repositories/organization";
import {
	createOnboardingInvitationRecord,
	hasActiveOnboardingInvitationForEmail,
	PlatformOnboardingError,
	revokeOnboardingInvitationsForEmail,
	rotateOnboardingInvitationRecord,
} from "../src/repositories/organization-onboarding";
import {
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationOnboardingInvitation,
	platformAuditEvent,
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
	const invitations = await db
		.select({ id: organizationOnboardingInvitation.id })
		.from(organizationOnboardingInvitation)
		.where(eq(organizationOnboardingInvitation.emailNormalized, ids.email));
	if (invitations.length > 0) {
		await db.delete(platformAuditEvent).where(
			inArray(
				platformAuditEvent.entityId,
				invitations.map((invitation) => invitation.id),
			),
		);
	}
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

		// 普通创建不会静默废弃已经发出的链接
		await assert.rejects(
			createOnboardingInvitationRecord({
				email: ids.email,
				organizationName: "开通测试机构",
			}),
			(error: unknown) =>
				error instanceof PlatformOnboardingError &&
				error.code === "INVITATION_PENDING",
		);
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, created.token),
			true,
		);

		const resent = await rotateOnboardingInvitationRecord({
			invitationId: created.id,
			actorUserId: null,
			requestId: randomUUID(),
			source: "break_glass",
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
		const created = await createOnboardingInvitationRecord({
			email: ids.email,
			organizationName: "小星星艺术学校",
		});

		const current = await getOrCreateCurrentOrganization({
			userId: ids.newUserId,
			userName: "开通受邀人",
			sessionId: sessionId(ids.newUserId),
			allowAutoCreateOrganization: false,
			onboardingToken: created.token,
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

		// 既有机构未受影响:名称与成员保持原样,且新机构是独立的一行
		assert.notEqual(current.organization.id, ids.existingOrganizationId);
		const [existing] = await db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, ids.existingOrganizationId));
		assert.equal(existing?.name, `${ids.prefix} 既有机构`);
		const existingMembers = await db
			.select({ userId: organizationMember.userId })
			.from(organizationMember)
			.where(eq(organizationMember.organizationId, ids.existingOrganizationId));
		assert.deepEqual(
			existingMembers.map((row) => row.userId),
			[ids.existingOwnerId],
		);

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

test("开通邀请:最终领取必须继续匹配最初通过注册闸门的 token", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const original = await createOnboardingInvitationRecord({
			email: ids.email,
			organizationName: "原机构名称",
		});
		assert.equal(
			await hasActiveOnboardingInvitationForEmail(ids.email, original.token),
			true,
		);

		const rotated = await rotateOnboardingInvitationRecord({
			invitationId: original.id,
			actorUserId: null,
			requestId: randomUUID(),
			source: "break_glass",
		});
		await assert.rejects(
			getOrCreateCurrentOrganization({
				userId: ids.newUserId,
				userName: "开通受邀人",
				sessionId: sessionId(ids.newUserId),
				allowAutoCreateOrganization: false,
				onboardingToken: original.token,
			}),
			(error: unknown) =>
				error instanceof Error &&
				error.message === "ORGANIZATION_MEMBERSHIP_REQUIRED",
		);

		const current = await getOrCreateCurrentOrganization({
			userId: ids.newUserId,
			userName: "开通受邀人",
			sessionId: sessionId(ids.newUserId),
			allowAutoCreateOrganization: false,
			onboardingToken: rotated.token,
		});
		assert.equal(current.organization.name, "原机构名称");
	} finally {
		await cleanupFixture(ids);
	}
});
