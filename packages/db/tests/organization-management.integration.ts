import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src";
import {
	createLeadRecord,
	LeadRepositoryError,
} from "../src/repositories/leads";
import {
	claimInvitationRecord,
	createInvitationRecord,
	hasActiveInvitationForEmail,
	listCampusRecords,
	listInvitationRecords,
	normalizeInvitationEmail,
	OrganizationManagementError,
	previewMemberOwnerImpactRecord,
	removeMemberRecord,
	resendInvitationRecord,
	revokeInvitationRecord,
	setCampusActiveRecord,
	updateMemberRecord,
} from "../src/repositories/organization-management";
import {
	campus,
	lead,
	organization,
	organizationAuditEvent,
	organizationMember,
	session,
	student,
	studentOwnerAssignmentEvent,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `organization-management-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusAOther: randomUUID(),
		campusB: randomUUID(),
		owner: `${prefix}-owner`,
		ownerB: `${prefix}-owner-b`,
		ownerC: `${prefix}-owner-c`,
		invitee: `${prefix}-invitee`,
		mismatchUser: `${prefix}-mismatch`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function sessionId(userId: string) {
	return `${userId}-session`;
}

async function expectManagementError(
	promise: Promise<unknown>,
	code: OrganizationManagementError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof OrganizationManagementError);
		assert.equal(error.code, code);
		return true;
	});
}

async function expectLeadError(
	promise: Promise<unknown>,
	code: LeadRepositoryError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof LeadRepositoryError);
		assert.equal(error.code, code);
		return true;
	});
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	const userIds = [
		ids.owner,
		ids.ownerB,
		ids.ownerC,
		ids.invitee,
		ids.mismatchUser,
	];

	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db.delete(session).where(inArray(session.userId, userIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db.delete(user).where(inArray(user.id, userIds));
}

async function seedFixture(ids: FixtureIds) {
	const now = new Date();
	const users = [
		[ids.owner, "机构负责人", `${ids.prefix}-owner@example.invalid`],
		[ids.ownerB, "负责人 B", `${ids.prefix}-owner-b@example.invalid`],
		[ids.ownerC, "负责人 C", `${ids.prefix}-owner-c@example.invalid`],
		[ids.invitee, "受邀用户", `${ids.prefix}-invitee@example.invalid`],
		[
			ids.mismatchUser,
			"邮箱不匹配用户",
			`${ids.prefix}-mismatch@example.invalid`,
		],
	] as const;
	await db
		.insert(user)
		.values(users.map(([id, name, email]) => ({ id, name, email })));
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
		{ organizationId: ids.organizationA, userId: ids.owner, role: "owner" },
		{ organizationId: ids.organizationA, userId: ids.ownerB, role: "owner" },
		{ organizationId: ids.organizationA, userId: ids.ownerC, role: "owner" },
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
}

test("重发会撤销旧邀请，撤销后的 token 不能领取", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const email = `${ids.prefix}-new-invitee@example.invalid`;
		const first = await createInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			email,
			role: "teacher",
			campusAccessMode: "selected",
			campusIds: [ids.campusA],
			requestId: randomUUID(),
		});
		const resent = await resendInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			id: first.invitation.id,
			requestId: randomUUID(),
		});

		assert.notEqual(resent.invitation.id, first.invitation.id);
		assert.notEqual(resent.token, first.token);
		const invitations = await listInvitationRecords({
			organizationId: ids.organizationA,
		});
		const firstPersisted = invitations.find(
			(invitation) => invitation.id === first.invitation.id,
		);
		const resentPersisted = invitations.find(
			(invitation) => invitation.id === resent.invitation.id,
		);
		assert.ok(firstPersisted?.revokedAt);
		assert.equal(resentPersisted?.revokedAt, null);
		assert.deepEqual(resentPersisted?.campusIds, [ids.campusA]);

		await revokeInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			id: resent.invitation.id,
		});
		await expectManagementError(
			claimInvitationRecord({
				token: resent.token,
				userId: ids.invitee,
				userEmail: email,
				sessionId: sessionId(ids.invitee),
			}),
			"INVITATION_INVALID",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("邀请只允许目标邮箱领取一次，并把当前 session 切换到受邀机构", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const invitation = await createInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			email: ` ${ids.prefix}-invitee@example.invalid `,
			role: "consultant",
			campusAccessMode: "selected",
			campusIds: [ids.campusA],
			requestId: randomUUID(),
		});

		await expectManagementError(
			claimInvitationRecord({
				token: invitation.token,
				userId: ids.mismatchUser,
				userEmail: `${ids.prefix}-mismatch@example.invalid`,
				sessionId: sessionId(ids.mismatchUser),
			}),
			"INVITATION_EMAIL_MISMATCH",
		);

		const claimed = await claimInvitationRecord({
			token: invitation.token,
			userId: ids.invitee,
			userEmail: ` ${ids.prefix.toUpperCase()}-INVITEE@EXAMPLE.INVALID `,
			sessionId: sessionId(ids.invitee),
		});
		assert.equal(claimed.organizationId, ids.organizationA);
		const [membership] = await db
			.select({ role: organizationMember.role })
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.invitee),
				),
			);
		assert.equal(membership?.role, "consultant");
		const [persistedSession] = await db
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(eq(session.id, sessionId(ids.invitee)));
		assert.equal(persistedSession?.activeOrganizationId, ids.organizationA);

		await expectManagementError(
			claimInvitationRecord({
				token: invitation.token,
				userId: ids.invitee,
				userEmail: `${ids.prefix}-invitee@example.invalid`,
				sessionId: sessionId(ids.invitee),
			}),
			"INVITATION_INVALID",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("未验证邮箱可领取邀请并更新成员、会话和审计记录", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const invitation = await createInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			email: `${ids.prefix}-invitee@example.invalid`,
			role: "consultant",
			campusAccessMode: "selected",
			campusIds: [ids.campusA],
			requestId: randomUUID(),
		});
		await claimInvitationRecord({
			token: invitation.token,
			userId: ids.invitee,
			userEmail: `${ids.prefix}-invitee@example.invalid`,
			sessionId: sessionId(ids.invitee),
		});
		const [membership, persistedSession, claimAudit] = await Promise.all([
			db
				.select({ id: organizationMember.id })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, ids.organizationA),
						eq(organizationMember.userId, ids.invitee),
					),
				)
				.then(([record]) => record),
			db
				.select({ activeOrganizationId: session.activeOrganizationId })
				.from(session)
				.where(eq(session.id, sessionId(ids.invitee)))
				.then(([record]) => record),
			db
				.select({ id: organizationAuditEvent.id })
				.from(organizationAuditEvent)
				.where(
					and(
						eq(organizationAuditEvent.action, "invitation_claimed"),
						eq(organizationAuditEvent.entityId, invitation.invitation.id),
					),
				)
				.then(([record]) => record),
		]);
		assert.ok(membership);
		assert.equal(persistedSession?.activeOrganizationId, ids.organizationA);
		assert.ok(claimAudit);
	} finally {
		await cleanupFixture(ids);
	}
});

test("并发降级两位 owner 时，事务仍保留最后一位 owner", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		await db
			.delete(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.ownerC),
				),
			);
		const ownerMembers = await db
			.select({ id: organizationMember.id, userId: organizationMember.userId })
			.from(organizationMember)
			.where(eq(organizationMember.organizationId, ids.organizationA));
		const memberIdByUser = new Map(
			ownerMembers.map((member) => [member.userId, member.id]),
		);
		const ownerMemberId = memberIdByUser.get(ids.owner);
		const ownerBMemberId = memberIdByUser.get(ids.ownerB);
		assert.ok(ownerMemberId);
		assert.ok(ownerBMemberId);

		const results = await Promise.allSettled([
			updateMemberRecord({
				organizationId: ids.organizationA,
				actorUserId: ids.owner,
				memberId: ownerMemberId,
				role: "admin",
				campusAccessMode: "all",
				campusIds: [],
			}),
			updateMemberRecord({
				organizationId: ids.organizationA,
				actorUserId: ids.owner,
				memberId: ownerBMemberId,
				role: "admin",
				campusAccessMode: "all",
				campusIds: [],
			}),
		]);
		assert.equal(
			results.filter((result) => result.status === "fulfilled").length,
			1,
		);
		const rejection = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		const rejectionDetails =
			typeof rejection?.reason === "object" && rejection.reason !== null
				? rejection.reason
				: null;
		assert.ok(
			rejection?.reason instanceof OrganizationManagementError,
			`并发拒绝必须是领域错误，实际 code=${String(
				rejectionDetails && "code" in rejectionDetails
					? rejectionDetails.code
					: undefined,
			)} message=${String(
				rejectionDetails && "message" in rejectionDetails
					? rejectionDetails.message
					: rejection?.reason,
			)}`,
		);
		if (!(rejection?.reason instanceof OrganizationManagementError)) return;
		assert.ok(
			rejection.reason.code === "LAST_OWNER" ||
				rejection.reason.code === "MEMBER_FORBIDDEN",
		);

		const remainingOwners = await db
			.select({ id: organizationMember.id })
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.role, "owner"),
				),
			);
		assert.equal(remainingOwners.length, 1);
	} finally {
		await cleanupFixture(ids);
	}
});

test("成员角色、校区范围和移除均保留事务内审计", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const [ownerBMember, ownerCMember] = await Promise.all([
			db
				.select({ id: organizationMember.id })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, ids.organizationA),
						eq(organizationMember.userId, ids.ownerB),
					),
				)
				.then(([member]) => member),
			db
				.select({ id: organizationMember.id })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, ids.organizationA),
						eq(organizationMember.userId, ids.ownerC),
					),
				)
				.then(([member]) => member),
		]);
		assert.ok(ownerBMember);
		assert.ok(ownerCMember);

		await updateMemberRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			memberId: ownerBMember.id,
			role: "teacher",
			campusAccessMode: "selected",
			campusIds: [ids.campusA],
		});
		await updateMemberRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			memberId: ownerBMember.id,
			role: "teacher",
			campusAccessMode: "selected",
			campusIds: [ids.campusAOther],
		});
		await removeMemberRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			memberId: ownerBMember.id,
		});

		const events = await db
			.select({
				action: organizationAuditEvent.action,
				entityId: organizationAuditEvent.entityId,
				actorUserId: organizationAuditEvent.actorUserId,
				targetUserId: organizationAuditEvent.targetUserId,
				before: organizationAuditEvent.before,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationA),
					eq(organizationAuditEvent.entityId, ownerBMember.id),
				),
			);
		assert.deepEqual(events, [
			{
				action: "member_role_changed",
				entityId: ownerBMember.id,
				actorUserId: ids.owner,
				targetUserId: ids.ownerB,
				before: { role: "owner", campusAccessMode: "all", campusIds: [] },
				after: {
					role: "teacher",
					campusAccessMode: "selected",
					campusIds: [ids.campusA],
				},
			},
			{
				action: "member_access_changed",
				entityId: ownerBMember.id,
				actorUserId: ids.owner,
				targetUserId: ids.ownerB,
				before: {
					role: "teacher",
					campusAccessMode: "selected",
					campusIds: [ids.campusA],
				},
				after: {
					role: "teacher",
					campusAccessMode: "selected",
					campusIds: [ids.campusAOther],
				},
			},
			{
				action: "member_removed",
				entityId: ownerBMember.id,
				actorUserId: ids.owner,
				targetUserId: ids.ownerB,
				before: {
					role: "teacher",
					campusAccessMode: "selected",
					campusIds: [ids.campusAOther],
				},
				after: null,
			},
		]);

		await removeMemberRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			memberId: ownerCMember.id,
		});
		const [remainingOwner] = await db
			.select({ id: organizationMember.id })
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.owner),
				),
			);
		assert.ok(remainingOwner);
		await expectManagementError(
			removeMemberRecord({
				organizationId: ids.organizationA,
				actorUserId: ids.owner,
				memberId: remainingOwner.id,
			}),
			"LAST_OWNER",
		);
		const failedActionCount = await db
			.select({ id: organizationAuditEvent.id })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationA),
					eq(organizationAuditEvent.action, "member_removed"),
				),
			);
		assert.equal(failedActionCount.length, 2);
	} finally {
		await cleanupFixture(ids);
	}
});

test("成员权限预览与确认会原子清空失效学员负责人并保留历史", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const [ownerBMember] = await db
			.select({ id: organizationMember.id })
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationA),
					eq(organizationMember.userId, ids.ownerB),
				),
			);
		assert.ok(ownerBMember);
		const studentAId = randomUUID();
		const studentOtherId = randomUUID();
		await db.insert(student).values([
			{
				id: studentAId,
				organizationId: ids.organizationA,
				campusId: ids.campusA,
				name: "负责人范围内学员",
				guardianName: "联系人 A",
				guardianPhone: "13800138001",
				guardianPhoneNormalized: "13800138001",
				ownerUserId: ids.ownerB,
			},
			{
				id: studentOtherId,
				organizationId: ids.organizationA,
				campusId: ids.campusAOther,
				name: "负责人范围外学员",
				guardianName: "联系人 B",
				guardianPhone: "13800138002",
				guardianPhoneNormalized: "13800138002",
				ownerUserId: ids.ownerB,
			},
		]);

		const preview = await previewMemberOwnerImpactRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			change: {
				kind: "update",
				memberId: ownerBMember.id,
				role: "campus_manager",
				campusAccessMode: "selected",
				campusIds: [ids.campusA],
			},
		});
		assert.equal(preview.affectedStudentCount, 1);

		await updateMemberRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			memberId: ownerBMember.id,
			role: "campus_manager",
			campusAccessMode: "selected",
			campusIds: [ids.campusA],
		});
		const students = await db
			.select({
				id: student.id,
				ownerUserId: student.ownerUserId,
				version: student.version,
			})
			.from(student)
			.where(inArray(student.id, [studentAId, studentOtherId]));
		const byId = new Map(students.map((item) => [item.id, item]));
		assert.deepEqual(byId.get(studentAId), {
			id: studentAId,
			ownerUserId: ids.ownerB,
			version: 1,
		});
		assert.deepEqual(byId.get(studentOtherId), {
			id: studentOtherId,
			ownerUserId: null,
			version: 2,
		});
		const assignmentEvents = await db
			.select({
				studentId: studentOwnerAssignmentEvent.studentId,
				source: studentOwnerAssignmentEvent.source,
				beforeOwnerUserId: studentOwnerAssignmentEvent.beforeOwnerUserId,
				afterOwnerUserId: studentOwnerAssignmentEvent.afterOwnerUserId,
			})
			.from(studentOwnerAssignmentEvent)
			.where(eq(studentOwnerAssignmentEvent.studentId, studentOtherId));
		assert.deepEqual(assignmentEvents, [
			{
				studentId: studentOtherId,
				source: "authorization_revoked",
				beforeOwnerUserId: ids.ownerB,
				afterOwnerUserId: null,
			},
		]);
	} finally {
		await cleanupFixture(ids);
	}
});

test("校区范围阻止越权写入，停用校区拒绝新的线索写入", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const ownerMembers = await db
			.select({ id: organizationMember.id, userId: organizationMember.userId })
			.from(organizationMember)
			.where(eq(organizationMember.organizationId, ids.organizationA));
		const ownerBMemberId = ownerMembers.find(
			(member) => member.userId === ids.ownerB,
		)?.id;
		assert.ok(ownerBMemberId);

		await expectManagementError(
			updateMemberRecord({
				organizationId: ids.organizationA,
				actorUserId: ids.owner,
				memberId: ownerBMemberId,
				role: "teacher",
				campusAccessMode: "selected",
				campusIds: [ids.campusB],
			}),
			"INVALID_SCOPE",
		);
		const visibleCampuses = await listCampusRecords({
			organizationId: ids.organizationA,
			campusAccess: { kind: "selected", campusIds: [ids.campusA] },
			includeInactive: true,
		});
		assert.deepEqual(
			visibleCampuses.map((item) => item.id),
			[ids.campusA],
		);

		await setCampusActiveRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			id: ids.campusA,
			isActive: false,
		});
		await expectLeadError(
			createLeadRecord({
				organizationId: ids.organizationA,
				ownerUserId: ids.owner,
				providerUserId: null,
				campusAccess: { kind: "all" },
				name: "停用校区线索",
				phone: "13800000000",
				source: "集成测试",
				stage: "new",
				campusId: ids.campusA,
				interestedCourseId: null,
				nextFollowAt: null,
				note: null,
				requestId: randomUUID(),
			}),
			"CAMPUS_INACTIVE",
		);
		const persistedLeads = await db
			.select({ id: lead.id })
			.from(lead)
			.where(eq(lead.organizationId, ids.organizationA));
		assert.equal(persistedLeads.length, 0);
	} finally {
		await cleanupFixture(ids);
	}
});

test("hasActiveInvitationForEmail 仅匹配未撤销、未领取且未过期的邀请", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const email = `${ids.prefix}-invitee@example.invalid`;
		const invitation = await createInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			email,
			role: "consultant",
			campusAccessMode: "all",
			campusIds: [],
			requestId: randomUUID(),
		});
		const emailNormalized = normalizeInvitationEmail(email);

		assert.equal(await hasActiveInvitationForEmail(emailNormalized), true);
		assert.equal(
			await hasActiveInvitationForEmail(
				`${ids.prefix}-missing@example.invalid`,
			),
			false,
		);

		await revokeInvitationRecord({
			organizationId: ids.organizationA,
			actorUserId: ids.owner,
			id: invitation.invitation.id,
		});
		assert.equal(await hasActiveInvitationForEmail(emailNormalized), false);
	} finally {
		await cleanupFixture(ids);
	}
});
