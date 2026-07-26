import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "../index";
import { organizationOnboardingInvitation } from "../schema";
import type { Transaction } from "./campus-access";
import { normalizeInvitationEmail } from "./organization-management";

const DEFAULT_ONBOARDING_EXPIRES_DAYS = 7;

function hashOnboardingToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function activeInvitationConditions(emailNormalized: string) {
	return and(
		eq(organizationOnboardingInvitation.emailNormalized, emailNormalized),
		isNull(organizationOnboardingInvitation.revokedAt),
		isNull(organizationOnboardingInvitation.claimedAt),
		gt(organizationOnboardingInvitation.expiresAt, sql`now()`),
	);
}

/**
 * 创建机构开通邀请(#66)。同邮箱同时至多一个有效邀请:
 * 创建前撤销该邮箱的既有有效邀请。返回明文 token(仅此一次,库中只存 hash)。
 */
export async function createOnboardingInvitationRecord(input: {
	email: string;
	organizationName: string;
	note?: string | null;
	expiresInDays?: number;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
	const emailNormalized = normalizeInvitationEmail(input.email);
	const organizationName = input.organizationName.trim();
	if (!organizationName) {
		throw new Error("Organization name is required.");
	}
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(
		Date.now() +
			(input.expiresInDays ?? DEFAULT_ONBOARDING_EXPIRES_DAYS) *
				24 *
				60 *
				60 *
				1000,
	);

	return db.transaction(async (tx) => {
		await tx
			.update(organizationOnboardingInvitation)
			.set({ revokedAt: new Date() })
			.where(activeInvitationConditions(emailNormalized));
		const [created] = await tx
			.insert(organizationOnboardingInvitation)
			.values({
				emailNormalized,
				tokenHash: hashOnboardingToken(token),
				organizationName,
				note: input.note ?? null,
				expiresAt,
			})
			.returning({ id: organizationOnboardingInvitation.id });
		if (!created) {
			throw new Error("Onboarding invitation creation returned no record.");
		}
		return { id: created.id, token, expiresAt };
	});
}

/**
 * 注册闸门:该邮箱是否存在有效开通邀请,且请求携带的 token 与之匹配。
 * token 校验防止仅知邮箱者抢注(比 #58 的成员邀请闸门收得更紧)。
 */
export async function hasActiveOnboardingInvitationForEmail(
	email: string,
	token: string | null | undefined,
): Promise<boolean> {
	if (!token) return false;
	const [record] = await db
		.select({ tokenHash: organizationOnboardingInvitation.tokenHash })
		.from(organizationOnboardingInvitation)
		.where(activeInvitationConditions(normalizeInvitationEmail(email)))
		.limit(1);
	return (
		record !== undefined && record.tokenHash === hashOnboardingToken(token)
	);
}

/**
 * 在建机构事务内锁定并返回该邮箱的有效开通邀请(无则返回 null)。
 */
export async function lockActiveOnboardingInvitation(
	tx: Transaction,
	email: string,
): Promise<{ id: string; organizationName: string } | null> {
	const [record] = await tx
		.select({
			id: organizationOnboardingInvitation.id,
			organizationName: organizationOnboardingInvitation.organizationName,
		})
		.from(organizationOnboardingInvitation)
		.where(activeInvitationConditions(normalizeInvitationEmail(email)))
		.limit(1)
		.for("update");
	return record ?? null;
}

export async function markOnboardingInvitationClaimed(
	tx: Transaction,
	input: {
		invitationId: string;
		userId: string;
		organizationId: string;
	},
): Promise<void> {
	await tx
		.update(organizationOnboardingInvitation)
		.set({
			claimedAt: new Date(),
			claimedByUserId: input.userId,
			createdOrganizationId: input.organizationId,
		})
		.where(eq(organizationOnboardingInvitation.id, input.invitationId));
}

export async function revokeOnboardingInvitationsForEmail(
	email: string,
): Promise<number> {
	const revoked = await db
		.update(organizationOnboardingInvitation)
		.set({ revokedAt: new Date() })
		.where(activeInvitationConditions(normalizeInvitationEmail(email)))
		.returning({ id: organizationOnboardingInvitation.id });
	return revoked.length;
}
