import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	organization,
	organizationInvitation,
	organizationInvitationCampus,
	organizationMember,
	organizationMemberCampus,
	session,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";

export type OrganizationManagementErrorCode =
	| "CAMPUS_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "MEMBER_NOT_FOUND"
	| "MEMBER_FORBIDDEN"
	| "LAST_OWNER"
	| "INVITATION_NOT_FOUND"
	| "INVITATION_INVALID"
	| "INVITATION_EMAIL_MISMATCH"
	| "INVITATION_ALREADY_MEMBER"
	| "INVITATION_REQUEST_REPLAY"
	| "INVALID_SCOPE";

export class OrganizationManagementError extends Error {
	constructor(public readonly code: OrganizationManagementErrorCode) {
		super(code);
		this.name = "OrganizationManagementError";
	}
}

export type CampusRecord = {
	id: string;
	code: string;
	name: string;
	city: string;
	address: string;
	roomCount: number;
	capacity: number;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type MemberRecord = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: (typeof organizationMember.$inferSelect)["role"];
	campusAccessMode: (typeof organizationMember.$inferSelect)["campusAccessMode"];
	campusIds: string[];
	createdAt: Date;
};

export type InvitationRecord = {
	id: string;
	emailMasked: string;
	role: (typeof organizationInvitation.$inferSelect)["role"];
	campusAccessMode: (typeof organizationInvitation.$inferSelect)["campusAccessMode"];
	campusIds: string[];
	expiresAt: Date;
	revokedAt: Date | null;
	claimedAt: Date | null;
	createdAt: Date;
};

type MemberRole = (typeof organizationMember.$inferSelect)["role"];
type AccessMode = (typeof organizationMember.$inferSelect)["campusAccessMode"];
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function normalizeEmail(value: string): string {
	return value.trim().toLocaleLowerCase("en-US");
}

function maskEmail(email: string): string {
	const [local = "", domain = ""] = email.split("@");
	if (!domain) return "***";
	return `${local.slice(0, 2)}***@${domain}`;
}

function hashInvitationToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function generateInvitationToken(): string {
	return randomBytes(32).toString("base64url");
}

function isOrganizationWideRole(role: MemberRole): boolean {
	return role === "owner" || role === "admin";
}

function ensureCampusAccess(access: CampusAccess, campusId: string): void {
	if (access.kind === "all") return;
	if (access.kind === "selected" && access.campusIds.includes(campusId)) return;
	throw new OrganizationManagementError("CAMPUS_OUT_OF_SCOPE");
}

function ensureManagementPermission(
	actorRole: MemberRole,
	targetRole: MemberRole,
	nextRole?: MemberRole,
): void {
	if (actorRole === "owner") return;
	if (actorRole !== "admin") {
		throw new OrganizationManagementError("MEMBER_FORBIDDEN");
	}
	if (targetRole === "owner" || nextRole === "owner") {
		throw new OrganizationManagementError("MEMBER_FORBIDDEN");
	}
}

async function lockOrganization(tx: Transaction, organizationId: string) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`,
	);
	const [record] = await tx
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1)
		.for("update");
	if (!record) throw new OrganizationManagementError("MEMBER_NOT_FOUND");
}

async function getLockedMember(
	tx: Transaction,
	organizationId: string,
	userId: string,
) {
	const [record] = await tx
		.select({
			id: organizationMember.id,
			userId: organizationMember.userId,
			role: organizationMember.role,
			campusAccessMode: organizationMember.campusAccessMode,
		})
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, organizationId),
				eq(organizationMember.userId, userId),
			),
		)
		.limit(1)
		.for("update");
	return record ?? null;
}

async function assertCampusManagementPermission(
	tx: Transaction,
	organizationId: string,
	actorUserId: string,
) {
	await lockOrganization(tx, organizationId);
	const actor = await getLockedMember(tx, organizationId, actorUserId);
	if (!actor || !isOrganizationWideRole(actor.role)) {
		throw new OrganizationManagementError("MEMBER_FORBIDDEN");
	}
}

async function assertScopedCampuses(
	tx: Transaction,
	organizationId: string,
	campusIds: string[],
): Promise<void> {
	if (campusIds.length === 0) return;
	const uniqueCampusIds = [...new Set(campusIds)];
	const rows = await tx
		.select({ id: campus.id })
		.from(campus)
		.where(
			and(
				eq(campus.organizationId, organizationId),
				inArray(campus.id, uniqueCampusIds),
			),
		);
	if (rows.length !== uniqueCampusIds.length) {
		throw new OrganizationManagementError("INVALID_SCOPE");
	}
}

async function replaceMemberCampusAccess(
	tx: Transaction,
	input: {
		organizationMemberId: string;
		organizationId: string;
		role: MemberRole;
		campusAccessMode: AccessMode;
		campusIds: string[];
	},
) {
	const campusAccessMode = isOrganizationWideRole(input.role)
		? "all"
		: input.campusAccessMode;
	const campusIds = campusAccessMode === "selected" ? input.campusIds : [];
	await assertScopedCampuses(tx, input.organizationId, campusIds);
	await tx
		.update(organizationMember)
		.set({ campusAccessMode })
		.where(eq(organizationMember.id, input.organizationMemberId));
	await tx
		.delete(organizationMemberCampus)
		.where(
			eq(
				organizationMemberCampus.organizationMemberId,
				input.organizationMemberId,
			),
		);
	if (campusIds.length > 0) {
		await tx.insert(organizationMemberCampus).values(
			[...new Set(campusIds)].map((campusId) => ({
				organizationMemberId: input.organizationMemberId,
				campusId,
			})),
		);
	}
}

function toCampusRecord(row: typeof campus.$inferSelect): CampusRecord {
	return {
		id: row.id,
		code: row.code,
		name: row.name,
		city: row.city,
		address: row.address,
		roomCount: row.roomCount,
		capacity: row.capacity,
		isActive: row.isActive,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toCampusAuditSnapshot(row: typeof campus.$inferSelect) {
	return {
		code: row.code,
		name: row.name,
		city: row.city,
		address: row.address,
		roomCount: row.roomCount,
		capacity: row.capacity,
		isActive: row.isActive,
	};
}

export async function listCampusRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	includeInactive?: boolean;
}): Promise<CampusRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [eq(campus.organizationId, input.organizationId)];
	if (!input.includeInactive) filters.push(eq(campus.isActive, true));
	if (input.campusAccess.kind === "selected") {
		filters.push(inArray(campus.id, input.campusAccess.campusIds));
	}
	return (
		await db
			.select()
			.from(campus)
			.where(and(...filters))
			.orderBy(asc(campus.name), asc(campus.id))
	).map(toCampusRecord);
}

export async function createCampusRecord(input: {
	organizationId: string;
	actorUserId: string;
	code: string;
	name: string;
	city: string;
	address: string;
	roomCount: number;
	capacity: number;
}): Promise<CampusRecord> {
	return db.transaction(async (tx) => {
		await assertCampusManagementPermission(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		const [created] = await tx
			.insert(campus)
			.values({
				organizationId: input.organizationId,
				code: input.code,
				name: input.name,
				city: input.city,
				address: input.address,
				roomCount: input.roomCount,
				capacity: input.capacity,
			})
			.returning();
		if (!created) throw new Error("Campus creation did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "campus_created",
			entityType: "campus",
			entityId: created.id,
			actorUserId: input.actorUserId,
			after: toCampusAuditSnapshot(created),
		});
		return toCampusRecord(created);
	});
}

export async function updateCampusRecord(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	data: Partial<
		Pick<
			CampusRecord,
			"code" | "name" | "city" | "address" | "roomCount" | "capacity"
		>
	>;
}): Promise<CampusRecord> {
	return db.transaction(async (tx) => {
		await assertCampusManagementPermission(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		const [current] = await tx
			.select()
			.from(campus)
			.where(
				and(
					eq(campus.id, input.id),
					eq(campus.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new OrganizationManagementError("CAMPUS_NOT_FOUND");
		const [updated] = await tx
			.update(campus)
			.set(input.data)
			.where(eq(campus.id, current.id))
			.returning();
		if (!updated) throw new Error("Campus update did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "campus_updated",
			entityType: "campus",
			entityId: updated.id,
			actorUserId: input.actorUserId,
			before: toCampusAuditSnapshot(current),
			after: toCampusAuditSnapshot(updated),
		});
		return toCampusRecord(updated);
	});
}

export async function setCampusActiveRecord(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	isActive: boolean;
}): Promise<CampusRecord> {
	return db.transaction(async (tx) => {
		await assertCampusManagementPermission(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		const [current] = await tx
			.select()
			.from(campus)
			.where(
				and(
					eq(campus.id, input.id),
					eq(campus.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new OrganizationManagementError("CAMPUS_NOT_FOUND");
		const [updated] = await tx
			.update(campus)
			.set({ isActive: input.isActive })
			.where(eq(campus.id, current.id))
			.returning();
		if (!updated)
			throw new Error("Campus state update did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: input.isActive ? "campus_activated" : "campus_deactivated",
			entityType: "campus",
			entityId: updated.id,
			actorUserId: input.actorUserId,
			before: { isActive: current.isActive },
			after: { isActive: updated.isActive },
		});
		return toCampusRecord(updated);
	});
}

export async function listMemberRecords(input: {
	organizationId: string;
}): Promise<MemberRecord[]> {
	const members = await db
		.select({
			id: organizationMember.id,
			userId: organizationMember.userId,
			name: user.name,
			email: user.email,
			role: organizationMember.role,
			campusAccessMode: organizationMember.campusAccessMode,
			createdAt: organizationMember.createdAt,
		})
		.from(organizationMember)
		.innerJoin(user, eq(user.id, organizationMember.userId))
		.where(eq(organizationMember.organizationId, input.organizationId))
		.orderBy(asc(organizationMember.createdAt), asc(organizationMember.id));
	const memberIds = members.map((member) => member.id);
	const scopes = memberIds.length
		? await db
				.select({
					organizationMemberId: organizationMemberCampus.organizationMemberId,
					campusId: organizationMemberCampus.campusId,
				})
				.from(organizationMemberCampus)
				.where(
					inArray(organizationMemberCampus.organizationMemberId, memberIds),
				)
		: [];
	const campusIdsByMember = new Map<string, string[]>();
	for (const scope of scopes) {
		const campusIds = campusIdsByMember.get(scope.organizationMemberId) ?? [];
		campusIds.push(scope.campusId);
		campusIdsByMember.set(scope.organizationMemberId, campusIds);
	}
	return members.map((member) => ({
		...member,
		campusIds: campusIdsByMember.get(member.id) ?? [],
	}));
}

export async function updateMemberRecord(input: {
	organizationId: string;
	actorUserId: string;
	memberId: string;
	role: MemberRole;
	campusAccessMode: AccessMode;
	campusIds: string[];
}): Promise<void> {
	await db.transaction(async (tx) => {
		await lockOrganization(tx, input.organizationId);
		const actor = await getLockedMember(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		if (!actor) throw new OrganizationManagementError("MEMBER_FORBIDDEN");
		const [target] = await tx
			.select()
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.id, input.memberId),
					eq(organizationMember.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!target) throw new OrganizationManagementError("MEMBER_NOT_FOUND");
		ensureManagementPermission(actor.role, target.role, input.role);
		if (target.role === "owner" && input.role !== "owner") {
			const [owners] = await tx
				.select({ value: count() })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, input.organizationId),
						eq(organizationMember.role, "owner"),
					),
				);
			if ((owners?.value ?? 0) <= 1) {
				throw new OrganizationManagementError("LAST_OWNER");
			}
		}
		const nextCampusAccessMode = isOrganizationWideRole(input.role)
			? "all"
			: input.campusAccessMode;
		const nextCampusIds =
			nextCampusAccessMode === "selected" ? [...new Set(input.campusIds)] : [];
		const currentScopes = await tx
			.select({ campusId: organizationMemberCampus.campusId })
			.from(organizationMemberCampus)
			.where(eq(organizationMemberCampus.organizationMemberId, target.id));
		const before = {
			role: target.role,
			campusAccessMode: target.campusAccessMode,
			campusIds: currentScopes.map((scope) => scope.campusId),
		};
		await tx
			.update(organizationMember)
			.set({
				role: input.role,
				campusAccessMode: nextCampusAccessMode,
			})
			.where(eq(organizationMember.id, target.id));
		await replaceMemberCampusAccess(tx, {
			organizationMemberId: target.id,
			organizationId: input.organizationId,
			role: input.role,
			campusAccessMode: nextCampusAccessMode,
			campusIds: nextCampusIds,
		});
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action:
				target.role === input.role
					? "member_access_changed"
					: "member_role_changed",
			entityType: "organization_member",
			entityId: target.id,
			actorUserId: input.actorUserId,
			targetUserId: target.userId,
			before,
			after: {
				role: input.role,
				campusAccessMode: nextCampusAccessMode,
				campusIds: nextCampusIds,
			},
		});
	});
}

export async function removeMemberRecord(input: {
	organizationId: string;
	actorUserId: string;
	memberId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		await lockOrganization(tx, input.organizationId);
		const actor = await getLockedMember(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		if (!actor) throw new OrganizationManagementError("MEMBER_FORBIDDEN");
		const [target] = await tx
			.select()
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.id, input.memberId),
					eq(organizationMember.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!target) throw new OrganizationManagementError("MEMBER_NOT_FOUND");
		ensureManagementPermission(actor.role, target.role);
		if (target.role === "owner") {
			const [owners] = await tx
				.select({ value: count() })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, input.organizationId),
						eq(organizationMember.role, "owner"),
					),
				);
			if ((owners?.value ?? 0) <= 1) {
				throw new OrganizationManagementError("LAST_OWNER");
			}
		}
		const currentScopes = await tx
			.select({ campusId: organizationMemberCampus.campusId })
			.from(organizationMemberCampus)
			.where(eq(organizationMemberCampus.organizationMemberId, target.id));
		await tx
			.delete(organizationMember)
			.where(eq(organizationMember.id, target.id));
		await tx
			.update(session)
			.set({ activeOrganizationId: null })
			.where(
				and(
					eq(session.userId, target.userId),
					eq(session.activeOrganizationId, input.organizationId),
				),
			);
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "member_removed",
			entityType: "organization_member",
			entityId: target.id,
			actorUserId: input.actorUserId,
			targetUserId: target.userId,
			before: {
				role: target.role,
				campusAccessMode: target.campusAccessMode,
				campusIds: currentScopes.map((scope) => scope.campusId),
			},
		});
	});
}

async function insertInvitation(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
		emailNormalized: string;
		role: MemberRole;
		campusAccessMode: AccessMode;
		campusIds: string[];
		requestId: string;
	},
): Promise<{ invitation: InvitationRecord; token: string }> {
	if (input.role === "owner") {
		throw new OrganizationManagementError("MEMBER_FORBIDDEN");
	}
	const actor = await getLockedMember(
		tx,
		input.organizationId,
		input.actorUserId,
	);
	if (!actor) throw new OrganizationManagementError("MEMBER_FORBIDDEN");
	ensureManagementPermission(actor.role, "consultant", input.role);
	const campusAccessMode = isOrganizationWideRole(input.role)
		? "all"
		: input.campusAccessMode;
	const campusIds = campusAccessMode === "selected" ? input.campusIds : [];
	await assertScopedCampuses(tx, input.organizationId, campusIds);
	const [existingMember] = await tx
		.select({ id: organizationMember.id })
		.from(organizationMember)
		.innerJoin(user, eq(user.id, organizationMember.userId))
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				sql`lower(${user.email}) = ${input.emailNormalized}`,
			),
		)
		.limit(1);
	if (existingMember) {
		throw new OrganizationManagementError("INVITATION_ALREADY_MEMBER");
	}
	const [existingRequest] = await tx
		.select({ id: organizationInvitation.id })
		.from(organizationInvitation)
		.where(
			and(
				eq(organizationInvitation.organizationId, input.organizationId),
				eq(organizationInvitation.requestId, input.requestId),
			),
		)
		.limit(1);
	if (existingRequest) {
		throw new OrganizationManagementError("INVITATION_REQUEST_REPLAY");
	}
	const now = new Date();
	await tx
		.update(organizationInvitation)
		.set({ revokedAt: now })
		.where(
			and(
				eq(organizationInvitation.organizationId, input.organizationId),
				eq(organizationInvitation.emailNormalized, input.emailNormalized),
				isNull(organizationInvitation.revokedAt),
				isNull(organizationInvitation.claimedAt),
				gt(organizationInvitation.expiresAt, now),
			),
		);
	const token = generateInvitationToken();
	const [created] = await tx
		.insert(organizationInvitation)
		.values({
			organizationId: input.organizationId,
			emailNormalized: input.emailNormalized,
			tokenHash: hashInvitationToken(token),
			role: input.role,
			campusAccessMode,
			createdByUserId: input.actorUserId,
			requestId: input.requestId,
			expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
		})
		.returning();
	if (!created) throw new Error("Invitation creation did not return a record.");
	if (campusIds.length > 0) {
		await tx.insert(organizationInvitationCampus).values(
			[...new Set(campusIds)].map((campusId) => ({
				organizationInvitationId: created.id,
				campusId,
			})),
		);
	}
	await writeOrganizationAuditEvent(tx, {
		organizationId: input.organizationId,
		action: "invitation_created",
		entityType: "organization_invitation",
		entityId: created.id,
		actorUserId: input.actorUserId,
		after: {
			emailMasked: maskEmail(created.emailNormalized),
			role: created.role,
			campusAccessMode: created.campusAccessMode,
			campusIds,
			expiresAt: created.expiresAt.toISOString(),
		},
	});
	return {
		invitation: {
			id: created.id,
			emailMasked: maskEmail(created.emailNormalized),
			role: created.role,
			campusAccessMode: created.campusAccessMode,
			campusIds,
			expiresAt: created.expiresAt,
			revokedAt: null,
			claimedAt: null,
			createdAt: created.createdAt,
		},
		token,
	};
}

export async function createInvitationRecord(input: {
	organizationId: string;
	actorUserId: string;
	email: string;
	role: MemberRole;
	campusAccessMode: AccessMode;
	campusIds: string[];
	requestId: string;
}): Promise<{ invitation: InvitationRecord; token: string }> {
	return db.transaction(async (tx) => {
		await lockOrganization(tx, input.organizationId);
		return insertInvitation(tx, {
			...input,
			emailNormalized: normalizeEmail(input.email),
		});
	});
}

export async function listInvitationRecords(input: {
	organizationId: string;
}): Promise<InvitationRecord[]> {
	const invitations = await db
		.select()
		.from(organizationInvitation)
		.where(eq(organizationInvitation.organizationId, input.organizationId))
		.orderBy(
			asc(organizationInvitation.createdAt),
			asc(organizationInvitation.id),
		);
	const invitationIds = invitations.map((invitation) => invitation.id);
	const scopes = invitationIds.length
		? await db
				.select({
					organizationInvitationId:
						organizationInvitationCampus.organizationInvitationId,
					campusId: organizationInvitationCampus.campusId,
				})
				.from(organizationInvitationCampus)
				.where(
					inArray(
						organizationInvitationCampus.organizationInvitationId,
						invitationIds,
					),
				)
		: [];
	const campusIdsByInvitation = new Map<string, string[]>();
	for (const scope of scopes) {
		const campusIds =
			campusIdsByInvitation.get(scope.organizationInvitationId) ?? [];
		campusIds.push(scope.campusId);
		campusIdsByInvitation.set(scope.organizationInvitationId, campusIds);
	}
	return invitations.map((invitation) => ({
		id: invitation.id,
		emailMasked: maskEmail(invitation.emailNormalized),
		role: invitation.role,
		campusAccessMode: invitation.campusAccessMode,
		campusIds: campusIdsByInvitation.get(invitation.id) ?? [],
		expiresAt: invitation.expiresAt,
		revokedAt: invitation.revokedAt,
		claimedAt: invitation.claimedAt,
		createdAt: invitation.createdAt,
	}));
}

export async function revokeInvitationRecord(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		await lockOrganization(tx, input.organizationId);
		const actor = await getLockedMember(
			tx,
			input.organizationId,
			input.actorUserId,
		);
		if (!actor) throw new OrganizationManagementError("MEMBER_FORBIDDEN");
		ensureManagementPermission(actor.role, "consultant");
		const [invitation] = await tx
			.select()
			.from(organizationInvitation)
			.where(
				and(
					eq(organizationInvitation.id, input.id),
					eq(organizationInvitation.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!invitation)
			throw new OrganizationManagementError("INVITATION_NOT_FOUND");
		if (invitation.claimedAt)
			throw new OrganizationManagementError("INVITATION_INVALID");
		if (!invitation.revokedAt) {
			await tx
				.update(organizationInvitation)
				.set({ revokedAt: new Date() })
				.where(eq(organizationInvitation.id, invitation.id));
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "invitation_revoked",
				entityType: "organization_invitation",
				entityId: invitation.id,
				actorUserId: input.actorUserId,
				before: { emailMasked: maskEmail(invitation.emailNormalized) },
			});
		}
	});
}

export async function resendInvitationRecord(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	requestId: string;
}): Promise<{ invitation: InvitationRecord; token: string }> {
	return db.transaction(async (tx) => {
		await lockOrganization(tx, input.organizationId);
		const [existing] = await tx
			.select()
			.from(organizationInvitation)
			.where(
				and(
					eq(organizationInvitation.id, input.id),
					eq(organizationInvitation.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!existing)
			throw new OrganizationManagementError("INVITATION_NOT_FOUND");
		if (existing.claimedAt)
			throw new OrganizationManagementError("INVITATION_INVALID");
		const scopes = await tx
			.select({ campusId: organizationInvitationCampus.campusId })
			.from(organizationInvitationCampus)
			.where(
				eq(organizationInvitationCampus.organizationInvitationId, existing.id),
			);
		return insertInvitation(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			emailNormalized: existing.emailNormalized,
			role: existing.role,
			campusAccessMode: existing.campusAccessMode,
			campusIds: scopes.map((scope) => scope.campusId),
			requestId: input.requestId,
		});
	});
}

export async function claimInvitationRecord(input: {
	token: string;
	userId: string;
	userEmail: string;
	sessionId: string;
}): Promise<{ organizationId: string }> {
	return db.transaction(async (tx) => {
		// 所有邀请写操作先锁定机构，再锁定具体邀请，避免领取与撤销交叉等待。
		const [matchedInvitation] = await tx
			.select()
			.from(organizationInvitation)
			.where(
				eq(organizationInvitation.tokenHash, hashInvitationToken(input.token)),
			)
			.limit(1);
		if (!matchedInvitation)
			throw new OrganizationManagementError("INVITATION_INVALID");
		await lockOrganization(tx, matchedInvitation.organizationId);
		const [invitation] = await tx
			.select()
			.from(organizationInvitation)
			.where(eq(organizationInvitation.id, matchedInvitation.id))
			.limit(1)
			.for("update");
		if (!invitation)
			throw new OrganizationManagementError("INVITATION_INVALID");
		const now = new Date();
		if (
			invitation.revokedAt ||
			invitation.claimedAt ||
			invitation.expiresAt <= now
		) {
			throw new OrganizationManagementError("INVITATION_INVALID");
		}
		if (normalizeEmail(input.userEmail) !== invitation.emailNormalized) {
			throw new OrganizationManagementError("INVITATION_EMAIL_MISMATCH");
		}
		const existingMember = await getLockedMember(
			tx,
			invitation.organizationId,
			input.userId,
		);
		if (existingMember) {
			throw new OrganizationManagementError("INVITATION_ALREADY_MEMBER");
		}
		const scopes = await tx
			.select({ campusId: organizationInvitationCampus.campusId })
			.from(organizationInvitationCampus)
			.where(
				eq(
					organizationInvitationCampus.organizationInvitationId,
					invitation.id,
				),
			);
		await assertScopedCampuses(
			tx,
			invitation.organizationId,
			scopes.map((scope) => scope.campusId),
		);
		const [member] = await tx
			.insert(organizationMember)
			.values({
				organizationId: invitation.organizationId,
				userId: input.userId,
				role: invitation.role,
				campusAccessMode: invitation.campusAccessMode,
			})
			.returning({ id: organizationMember.id });
		if (!member) throw new Error("Invitation claim did not create a member.");
		if (invitation.campusAccessMode === "selected" && scopes.length > 0) {
			await tx.insert(organizationMemberCampus).values(
				scopes.map((scope) => ({
					organizationMemberId: member.id,
					campusId: scope.campusId,
				})),
			);
		}
		await tx
			.update(organizationInvitation)
			.set({ claimedAt: now, claimedByUserId: input.userId })
			.where(eq(organizationInvitation.id, invitation.id));
		await tx
			.update(session)
			.set({ activeOrganizationId: invitation.organizationId })
			.where(
				and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
			);
		await writeOrganizationAuditEvent(tx, {
			organizationId: invitation.organizationId,
			action: "invitation_claimed",
			entityType: "organization_invitation",
			entityId: invitation.id,
			actorUserId: input.userId,
			targetUserId: input.userId,
			after: {
				role: invitation.role,
				campusAccessMode: invitation.campusAccessMode,
				campusIds: scopes.map((scope) => scope.campusId),
			},
		});
		return { organizationId: invitation.organizationId };
	});
}

export function isCampusAccessible(
	campusAccess: CampusAccess,
	campusId: string | null,
): boolean {
	if (campusAccess.kind === "all") return true;
	if (!campusId) return false;
	return (
		campusAccess.kind === "selected" &&
		campusAccess.campusIds.includes(campusId)
	);
}

export function assertCampusAccessible(
	campusAccess: CampusAccess,
	campusId: string,
): void {
	ensureCampusAccess(campusAccess, campusId);
}
