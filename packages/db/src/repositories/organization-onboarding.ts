import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../index";
import { organizationOnboardingInvitation, user } from "../schema";
import type { Transaction } from "./campus-access";
import { normalizeInvitationEmail } from "./organization-management";
import {
	type PlatformAuditSource,
	writePlatformAuditEvent,
} from "./platform-audit";

const DEFAULT_ONBOARDING_EXPIRES_DAYS = 7;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type OnboardingInvitationStatus =
	| "pending"
	| "claimed"
	| "expired"
	| "revoked";

export type PlatformOnboardingErrorCode =
	| "INVITATION_NOT_FOUND"
	| "INVITATION_PENDING"
	| "INVITATION_CLAIMED"
	| "INVITATION_EXPIRED"
	| "INVALID_CURSOR"
	| "REQUEST_REPLAY";

export class PlatformOnboardingError extends Error {
	constructor(public readonly code: PlatformOnboardingErrorCode) {
		super(code);
		this.name = "PlatformOnboardingError";
	}
}

export type PlatformOnboardingInvitationRecord = {
	id: string;
	email: string;
	organizationName: string;
	note: string | null;
	status: OnboardingInvitationStatus;
	expiresAt: Date;
	revokedAt: Date | null;
	claimedAt: Date | null;
	createdAt: Date;
	createdBy: {
		id: string;
		name: string;
		email: string;
	} | null;
	createdOrganizationId: string | null;
};

const cursorSchema = z.object({
	createdAt: z.iso.datetime(),
	id: z.uuid(),
});

function encodeCursor(record: { createdAt: Date; id: string }): string {
	return Buffer.from(
		JSON.stringify({
			createdAt: record.createdAt.toISOString(),
			id: record.id,
		}),
		"utf8",
	).toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
	if (!cursor) return null;
	try {
		const decoded = cursorSchema.parse(
			JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
		);
		return { createdAt: new Date(decoded.createdAt), id: decoded.id };
	} catch {
		throw new PlatformOnboardingError("INVALID_CURSOR");
	}
}

function hashOnboardingToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function generateOnboardingToken(): string {
	return randomBytes(32).toString("base64url");
}

function activeInvitationConditions(emailNormalized: string, now: Date) {
	return and(
		eq(organizationOnboardingInvitation.emailNormalized, emailNormalized),
		isNull(organizationOnboardingInvitation.revokedAt),
		isNull(organizationOnboardingInvitation.claimedAt),
		gt(organizationOnboardingInvitation.expiresAt, now),
	);
}

function openInvitationConditions(emailNormalized: string) {
	return and(
		eq(organizationOnboardingInvitation.emailNormalized, emailNormalized),
		isNull(organizationOnboardingInvitation.revokedAt),
		isNull(organizationOnboardingInvitation.claimedAt),
	);
}

function invitationStatusSql(now: Date) {
	return sql<OnboardingInvitationStatus>`CASE
		WHEN ${organizationOnboardingInvitation.claimedAt} IS NOT NULL THEN 'claimed'
		WHEN ${organizationOnboardingInvitation.closedReason} IN ('revoked', 'rotated', 'break_glass_rotated') THEN 'revoked'
		WHEN ${organizationOnboardingInvitation.closedReason} = 'expired_superseded' THEN 'expired'
		WHEN ${organizationOnboardingInvitation.revokedAt} IS NOT NULL THEN 'revoked'
		WHEN ${organizationOnboardingInvitation.expiresAt} <= ${now} THEN 'expired'
		ELSE 'pending'
	END`;
}

function statusFilter(status: OnboardingInvitationStatus, now: Date): SQL {
	return sql`${invitationStatusSql(now)} = ${status}`;
}

function isPostgresConstraint(error: unknown, constraint: string): boolean {
	let current = error;
	while (typeof current === "object" && current !== null) {
		if (
			"code" in current &&
			current.code === "23505" &&
			"constraint" in current &&
			current.constraint === constraint
		) {
			return true;
		}
		current = "cause" in current ? current.cause : null;
	}
	return false;
}

async function lockEmail(tx: Transaction, emailNormalized: string) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${emailNormalized}))`,
	);
}

async function assertUnusedRequestId(
	tx: Transaction,
	requestId: string | null | undefined,
) {
	if (!requestId) return;
	const [existing] = await tx
		.select({ id: organizationOnboardingInvitation.id })
		.from(organizationOnboardingInvitation)
		.where(eq(organizationOnboardingInvitation.requestId, requestId))
		.limit(1);
	if (existing) throw new PlatformOnboardingError("REQUEST_REPLAY");
}

async function getOpenInvitationForUpdate(
	tx: Transaction,
	emailNormalized: string,
) {
	const [record] = await tx
		.select()
		.from(organizationOnboardingInvitation)
		.where(openInvitationConditions(emailNormalized))
		.limit(1)
		.for("update");
	return record ?? null;
}

async function closeExpiredOpenInvitation(
	tx: Transaction,
	record: typeof organizationOnboardingInvitation.$inferSelect,
	now: Date,
) {
	if (record.expiresAt > now) {
		throw new PlatformOnboardingError("INVITATION_PENDING");
	}
	await tx
		.update(organizationOnboardingInvitation)
		.set({
			revokedAt: now,
			closedReason: "expired_superseded",
		})
		.where(eq(organizationOnboardingInvitation.id, record.id));
}

export async function listPlatformOnboardingInvitations(input: {
	cursor?: string;
	limit?: number;
	status?: OnboardingInvitationStatus;
	email?: string;
}): Promise<{
	items: PlatformOnboardingInvitationRecord[];
	nextCursor: string | null;
}> {
	const now = new Date();
	const limit = Math.min(
		Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1),
		MAX_PAGE_SIZE,
	);
	const cursor = decodeCursor(input.cursor);
	const conditions: SQL[] = [];
	if (input.status) conditions.push(statusFilter(input.status, now));
	if (input.email?.trim()) {
		conditions.push(
			eq(
				organizationOnboardingInvitation.emailNormalized,
				normalizeInvitationEmail(input.email),
			),
		);
	}
	if (cursor) {
		conditions.push(
			or(
				lt(organizationOnboardingInvitation.createdAt, cursor.createdAt),
				and(
					eq(organizationOnboardingInvitation.createdAt, cursor.createdAt),
					lt(organizationOnboardingInvitation.id, cursor.id),
				),
			) as SQL,
		);
	}

	const rows = await db
		.select({
			id: organizationOnboardingInvitation.id,
			email: organizationOnboardingInvitation.emailNormalized,
			organizationName: organizationOnboardingInvitation.organizationName,
			note: organizationOnboardingInvitation.note,
			status: invitationStatusSql(now),
			expiresAt: organizationOnboardingInvitation.expiresAt,
			revokedAt: organizationOnboardingInvitation.revokedAt,
			claimedAt: organizationOnboardingInvitation.claimedAt,
			createdAt: organizationOnboardingInvitation.createdAt,
			createdByUserId: user.id,
			createdByName: user.name,
			createdByEmail: user.email,
			createdOrganizationId:
				organizationOnboardingInvitation.createdOrganizationId,
		})
		.from(organizationOnboardingInvitation)
		.leftJoin(
			user,
			eq(user.id, organizationOnboardingInvitation.createdByUserId),
		)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(
			desc(organizationOnboardingInvitation.createdAt),
			desc(organizationOnboardingInvitation.id),
		)
		.limit(limit + 1);

	const hasNextPage = rows.length > limit;
	const page = hasNextPage ? rows.slice(0, limit) : rows;
	const last = page.at(-1);
	return {
		items: page.map((row) => ({
			id: row.id,
			email: row.email,
			organizationName: row.organizationName,
			note: row.note,
			status: row.status,
			expiresAt: row.expiresAt,
			revokedAt: row.revokedAt,
			claimedAt: row.claimedAt,
			createdAt: row.createdAt,
			createdBy:
				row.createdByUserId && row.createdByName && row.createdByEmail
					? {
							id: row.createdByUserId,
							name: row.createdByName,
							email: row.createdByEmail,
						}
					: null,
			createdOrganizationId: row.createdOrganizationId,
		})),
		nextCursor: hasNextPage && last ? encodeCursor(last) : null,
	};
}

/**
 * 创建机构开通邀请。明文 token 只随本次成功调用返回，数据库只存 hash。
 */
export async function createOnboardingInvitationRecord(input: {
	email: string;
	organizationName: string;
	note?: string | null;
	expiresInDays?: number;
	actorUserId?: string | null;
	requestId?: string | null;
	source?: PlatformAuditSource;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
	const emailNormalized = normalizeInvitationEmail(input.email);
	const organizationName = input.organizationName.trim();
	if (!organizationName) throw new Error("Organization name is required.");
	const token = generateOnboardingToken();
	const now = new Date();
	const expiresAt = new Date(
		now.getTime() +
			(input.expiresInDays ?? DEFAULT_ONBOARDING_EXPIRES_DAYS) *
				24 *
				60 *
				60 *
				1000,
	);

	try {
		return await db.transaction(async (tx) => {
			await lockEmail(tx, emailNormalized);
			await assertUnusedRequestId(tx, input.requestId);
			const openInvitation = await getOpenInvitationForUpdate(
				tx,
				emailNormalized,
			);
			if (openInvitation) {
				await closeExpiredOpenInvitation(tx, openInvitation, now);
			}

			const [created] = await tx
				.insert(organizationOnboardingInvitation)
				.values({
					emailNormalized,
					tokenHash: hashOnboardingToken(token),
					organizationName,
					note: input.note?.trim() || null,
					createdByUserId: input.actorUserId ?? null,
					requestId: input.requestId ?? null,
					expiresAt,
				})
				.returning({ id: organizationOnboardingInvitation.id });
			if (!created) {
				throw new Error("Onboarding invitation creation returned no record.");
			}
			await writePlatformAuditEvent(tx, {
				action: "onboarding_invitation_created",
				source: input.source ?? "break_glass",
				actorUserId: input.actorUserId ?? null,
				entityType: "organizationOnboardingInvitation",
				entityId: created.id,
				requestId: input.requestId,
				metadata: { emailNormalized, organizationName },
			});
			return { id: created.id, token, expiresAt };
		});
	} catch (error) {
		if (
			isPostgresConstraint(
				error,
				"organization_onboarding_invitation_request_uidx",
			)
		) {
			throw new PlatformOnboardingError("REQUEST_REPLAY");
		}
		if (
			isPostgresConstraint(
				error,
				"organization_onboarding_invitation_open_email_uidx",
			)
		) {
			throw new PlatformOnboardingError("INVITATION_PENDING");
		}
		throw error;
	}
}

export async function rotateOnboardingInvitationRecord(input: {
	invitationId: string;
	actorUserId: string | null;
	requestId: string;
	source?: PlatformAuditSource;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
	const token = generateOnboardingToken();
	const now = new Date();
	const expiresAt = new Date(
		now.getTime() + DEFAULT_ONBOARDING_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
	);

	try {
		return await db.transaction(async (tx) => {
			const [candidate] = await tx
				.select({ email: organizationOnboardingInvitation.emailNormalized })
				.from(organizationOnboardingInvitation)
				.where(eq(organizationOnboardingInvitation.id, input.invitationId))
				.limit(1);
			if (!candidate) {
				throw new PlatformOnboardingError("INVITATION_NOT_FOUND");
			}

			await lockEmail(tx, candidate.email);
			await assertUnusedRequestId(tx, input.requestId);
			const [current] = await tx
				.select()
				.from(organizationOnboardingInvitation)
				.where(eq(organizationOnboardingInvitation.id, input.invitationId))
				.limit(1)
				.for("update");
			if (!current) {
				throw new PlatformOnboardingError("INVITATION_NOT_FOUND");
			}
			if (current.claimedAt) {
				throw new PlatformOnboardingError("INVITATION_CLAIMED");
			}

			const openInvitation = await getOpenInvitationForUpdate(
				tx,
				current.emailNormalized,
			);
			if (openInvitation && openInvitation.id !== current.id) {
				await closeExpiredOpenInvitation(tx, openInvitation, now);
			}
			if (openInvitation?.id === current.id) {
				await tx
					.update(organizationOnboardingInvitation)
					.set({
						revokedAt: now,
						revokedByUserId: input.actorUserId,
						closedReason:
							current.expiresAt <= now ? "expired_superseded" : "rotated",
					})
					.where(eq(organizationOnboardingInvitation.id, current.id));
			}

			const [created] = await tx
				.insert(organizationOnboardingInvitation)
				.values({
					emailNormalized: current.emailNormalized,
					tokenHash: hashOnboardingToken(token),
					organizationName: current.organizationName,
					note: current.note,
					createdByUserId: input.actorUserId,
					requestId: input.requestId,
					replacesInvitationId: current.id,
					expiresAt,
				})
				.returning({ id: organizationOnboardingInvitation.id });
			if (!created) {
				throw new Error("Onboarding invitation rotation returned no record.");
			}
			await writePlatformAuditEvent(tx, {
				action: "onboarding_invitation_rotated",
				source: input.source ?? "web",
				actorUserId: input.actorUserId,
				entityType: "organizationOnboardingInvitation",
				entityId: created.id,
				requestId: input.requestId,
				metadata: { previousInvitationId: current.id },
			});
			return { id: created.id, token, expiresAt };
		});
	} catch (error) {
		if (
			isPostgresConstraint(
				error,
				"organization_onboarding_invitation_request_uidx",
			)
		) {
			throw new PlatformOnboardingError("REQUEST_REPLAY");
		}
		if (
			isPostgresConstraint(
				error,
				"organization_onboarding_invitation_open_email_uidx",
			)
		) {
			throw new PlatformOnboardingError("INVITATION_PENDING");
		}
		throw error;
	}
}

export async function revokeOnboardingInvitationRecord(input: {
	invitationId: string;
	actorUserId: string | null;
	source?: PlatformAuditSource;
}): Promise<{ id: string; revokedAt: Date }> {
	return db.transaction(async (tx) => {
		const [candidate] = await tx
			.select({ email: organizationOnboardingInvitation.emailNormalized })
			.from(organizationOnboardingInvitation)
			.where(eq(organizationOnboardingInvitation.id, input.invitationId))
			.limit(1);
		if (!candidate) {
			throw new PlatformOnboardingError("INVITATION_NOT_FOUND");
		}
		await lockEmail(tx, candidate.email);
		const [current] = await tx
			.select()
			.from(organizationOnboardingInvitation)
			.where(eq(organizationOnboardingInvitation.id, input.invitationId))
			.limit(1)
			.for("update");
		if (!current) {
			throw new PlatformOnboardingError("INVITATION_NOT_FOUND");
		}
		if (current.claimedAt) {
			throw new PlatformOnboardingError("INVITATION_CLAIMED");
		}
		if (current.revokedAt) {
			return { id: current.id, revokedAt: current.revokedAt };
		}
		const now = new Date();
		if (current.expiresAt <= now) {
			throw new PlatformOnboardingError("INVITATION_EXPIRED");
		}
		await tx
			.update(organizationOnboardingInvitation)
			.set({
				revokedAt: now,
				revokedByUserId: input.actorUserId,
				closedReason: "revoked",
			})
			.where(eq(organizationOnboardingInvitation.id, current.id));
		await writePlatformAuditEvent(tx, {
			action: "onboarding_invitation_revoked",
			source: input.source ?? "web",
			actorUserId: input.actorUserId,
			entityType: "organizationOnboardingInvitation",
			entityId: current.id,
			metadata: null,
		});
		return { id: current.id, revokedAt: now };
	});
}

/** 注册闸门：目标邮箱必须存在仍有效且 token 匹配的开通邀请。 */
export async function hasActiveOnboardingInvitationForEmail(
	email: string,
	token: string | null | undefined,
): Promise<boolean> {
	if (!token) return false;
	const [record] = await db
		.select({ tokenHash: organizationOnboardingInvitation.tokenHash })
		.from(organizationOnboardingInvitation)
		.where(
			and(
				activeInvitationConditions(normalizeInvitationEmail(email), new Date()),
				eq(
					organizationOnboardingInvitation.tokenHash,
					hashOnboardingToken(token),
				),
			),
		)
		.limit(1);
	return record !== undefined;
}

/** 在建机构事务内锁定并返回邮箱 + 同一 token 对应的有效邀请。 */
export async function lockActiveOnboardingInvitation(
	tx: Transaction,
	email: string,
	token: string | null | undefined,
): Promise<{ id: string; organizationName: string } | null> {
	if (!token) return null;
	const [record] = await tx
		.select({
			id: organizationOnboardingInvitation.id,
			organizationName: organizationOnboardingInvitation.organizationName,
		})
		.from(organizationOnboardingInvitation)
		.where(
			and(
				activeInvitationConditions(normalizeInvitationEmail(email), new Date()),
				eq(
					organizationOnboardingInvitation.tokenHash,
					hashOnboardingToken(token),
				),
			),
		)
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
	const emailNormalized = normalizeInvitationEmail(email);
	return db.transaction(async (tx) => {
		await lockEmail(tx, emailNormalized);
		const [record] = await tx
			.select({ id: organizationOnboardingInvitation.id })
			.from(organizationOnboardingInvitation)
			.where(activeInvitationConditions(emailNormalized, new Date()))
			.limit(1)
			.for("update");
		if (!record) return 0;
		await tx
			.update(organizationOnboardingInvitation)
			.set({ revokedAt: new Date(), closedReason: "revoked" })
			.where(eq(organizationOnboardingInvitation.id, record.id));
		await writePlatformAuditEvent(tx, {
			action: "onboarding_invitation_revoked",
			source: "break_glass",
			actorUserId: null,
			entityType: "organizationOnboardingInvitation",
			entityId: record.id,
		});
		return 1;
	});
}
