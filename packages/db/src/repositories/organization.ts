import { env } from "@easy-training/env/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import {
	organization,
	organizationMember,
	organizationMemberCampus,
	session,
	user,
} from "../schema";

export type OrganizationContextErrorCode =
	| "SESSION_NOT_FOUND"
	| "ORGANIZATION_NOT_FOUND"
	| "ORGANIZATION_MEMBERSHIP_REQUIRED";

export class OrganizationContextError extends Error {
	constructor(public readonly code: OrganizationContextErrorCode) {
		super(code);
		this.name = "OrganizationContextError";
	}
}

export type OrganizationSummaryRecord = {
	id: string;
	name: string;
	role: (typeof organizationMember.$inferSelect)["role"];
};

export type CampusAccess =
	| { kind: "all" }
	| { kind: "selected"; campusIds: string[] }
	| { kind: "none" };

export type CurrentOrganizationRecord = {
	organization: {
		id: string;
		name: string;
	};
	member: {
		id: string;
		organizationId: string;
		userId: string;
		role: (typeof organizationMember.$inferSelect)["role"];
		campusAccessMode: (typeof organizationMember.$inferSelect)["campusAccessMode"];
	};
	role: (typeof organizationMember.$inferSelect)["role"];
	campusAccess: CampusAccess;
	organizations: OrganizationSummaryRecord[];
};

const membershipSelection = {
	organization: {
		id: organization.id,
		name: organization.name,
	},
	member: {
		id: organizationMember.id,
		organizationId: organizationMember.organizationId,
		userId: organizationMember.userId,
		role: organizationMember.role,
		campusAccessMode: organizationMember.campusAccessMode,
	},
};

type MembershipRecord = {
	organization: CurrentOrganizationRecord["organization"];
	member: CurrentOrganizationRecord["member"];
};

function toCurrentOrganization(
	current: MembershipRecord,
	memberships: MembershipRecord[],
	campusAccess: CampusAccess,
): CurrentOrganizationRecord {
	return {
		...current,
		role: current.member.role,
		campusAccess,
		organizations: memberships.map(
			({ organization: organizationRecord, member }) => ({
				...organizationRecord,
				role: member.role,
			}),
		),
	};
}

function isOrganizationWideRole(
	role: CurrentOrganizationRecord["role"],
): boolean {
	return role === "owner" || role === "admin";
}

async function getCampusAccess(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	member: CurrentOrganizationRecord["member"],
): Promise<CampusAccess> {
	if (
		isOrganizationWideRole(member.role) ||
		member.campusAccessMode === "all"
	) {
		return { kind: "all" };
	}

	const rows = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));

	return rows.length > 0
		? { kind: "selected", campusIds: rows.map((row) => row.campusId) }
		: { kind: "none" };
}

async function listMemberships(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	userId: string,
): Promise<MembershipRecord[]> {
	return tx
		.select(membershipSelection)
		.from(organizationMember)
		.innerJoin(
			organization,
			eq(organization.id, organizationMember.organizationId),
		)
		.where(eq(organizationMember.userId, userId))
		.orderBy(asc(organizationMember.createdAt), asc(organizationMember.id));
}

async function listMembershipsReadOnly(
	userId: string,
): Promise<MembershipRecord[]> {
	return db
		.select(membershipSelection)
		.from(organizationMember)
		.innerJoin(
			organization,
			eq(organization.id, organizationMember.organizationId),
		)
		.where(eq(organizationMember.userId, userId))
		.orderBy(asc(organizationMember.createdAt), asc(organizationMember.id));
}

async function getCampusAccessReadOnly(
	member: CurrentOrganizationRecord["member"],
): Promise<CampusAccess> {
	if (
		isOrganizationWideRole(member.role) ||
		member.campusAccessMode === "all"
	) {
		return { kind: "all" };
	}

	const rows = await db
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));

	return rows.length > 0
		? { kind: "selected", campusIds: rows.map((row) => row.campusId) }
		: { kind: "none" };
}

async function readCurrentOrganization(input: {
	userId: string;
	sessionId: string;
}): Promise<CurrentOrganizationRecord | null> {
	const [sessionRecord] = await db
		.select({ activeOrganizationId: session.activeOrganizationId })
		.from(session)
		.where(
			and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
		)
		.limit(1);

	if (!sessionRecord) {
		throw new OrganizationContextError("SESSION_NOT_FOUND");
	}

	const memberships = await listMembershipsReadOnly(input.userId);
	if (memberships.length === 0) return null;

	const current =
		memberships.find(
			(item) => item.organization.id === sessionRecord.activeOrganizationId,
		) ?? memberships[0];

	if (!current) {
		throw new Error("Membership list unexpectedly became empty.");
	}

	if (current.organization.id !== sessionRecord.activeOrganizationId) {
		return null;
	}

	const [userRecord] = await db
		.select({ organizationInitializedAt: user.organizationInitializedAt })
		.from(user)
		.where(eq(user.id, input.userId))
		.limit(1);

	if (!userRecord) {
		throw new OrganizationContextError("SESSION_NOT_FOUND");
	}
	if (!userRecord.organizationInitializedAt) return null;

	return toCurrentOrganization(
		current,
		memberships,
		await getCampusAccessReadOnly(current.member),
	);
}

/**
 * 稳态请求只读解析机构上下文；需要首次建机构、修正 session 选择或补迁移标记时，
 * 才进入事务级 advisory lock，避免只读 RPC 在用户维度串行化。
 */
export async function getOrCreateCurrentOrganization(input: {
	userId: string;
	userName: string;
	sessionId: string;
	allowAutoCreateOrganization?: boolean;
}): Promise<CurrentOrganizationRecord> {
	const current = await readCurrentOrganization(input);
	if (current) return current;
	return getOrCreateCurrentOrganizationWithLock(input);
}

async function getOrCreateCurrentOrganizationWithLock(input: {
	userId: string;
	userName: string;
	sessionId: string;
	allowAutoCreateOrganization?: boolean;
}): Promise<CurrentOrganizationRecord> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`,
		);

		const [sessionRecord] = await tx
			.select({ activeOrganizationId: session.activeOrganizationId })
			.from(session)
			.where(
				and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
			)
			.limit(1)
			.for("update");

		if (!sessionRecord) {
			throw new OrganizationContextError("SESSION_NOT_FOUND");
		}

		const memberships = await listMemberships(tx, input.userId);
		if (memberships.length > 0) {
			const current =
				memberships.find(
					(item) => item.organization.id === sessionRecord.activeOrganizationId,
				) ?? memberships[0];

			if (!current) {
				throw new Error("Membership list unexpectedly became empty.");
			}

			if (current.organization.id !== sessionRecord.activeOrganizationId) {
				await tx
					.update(session)
					.set({ activeOrganizationId: current.organization.id })
					.where(
						and(
							eq(session.id, input.sessionId),
							eq(session.userId, input.userId),
						),
					);
			}

			// 兼容迁移前已有 membership 的用户，避免其日后被移除后误建新机构。
			await tx
				.update(user)
				.set({ organizationInitializedAt: new Date() })
				.where(
					and(
						eq(user.id, input.userId),
						isNull(user.organizationInitializedAt),
					),
				);

			return toCurrentOrganization(
				current,
				memberships,
				await getCampusAccess(tx, current.member),
			);
		}

		const [userRecord] = await tx
			.select({ organizationInitializedAt: user.organizationInitializedAt })
			.from(user)
			.where(eq(user.id, input.userId))
			.limit(1)
			.for("update");

		if (!userRecord) {
			throw new OrganizationContextError("SESSION_NOT_FOUND");
		}
		if (userRecord.organizationInitializedAt) {
			throw new OrganizationContextError("ORGANIZATION_MEMBERSHIP_REQUIRED");
		}

		const allowAutoCreate =
			input.allowAutoCreateOrganization ?? env.ALLOW_PUBLIC_SIGNUP;
		if (!allowAutoCreate) {
			throw new OrganizationContextError("ORGANIZATION_MEMBERSHIP_REQUIRED");
		}

		const [createdOrganization] = await tx
			.insert(organization)
			.values({ name: `${input.userName.trim() || "我的"}的机构` })
			.returning({ id: organization.id, name: organization.name });

		if (!createdOrganization) {
			throw new Error("Organization creation did not return a record.");
		}

		const [createdMember] = await tx
			.insert(organizationMember)
			.values({
				organizationId: createdOrganization.id,
				userId: input.userId,
				role: "owner",
			})
			.returning({
				id: organizationMember.id,
				organizationId: organizationMember.organizationId,
				userId: organizationMember.userId,
				role: organizationMember.role,
				campusAccessMode: organizationMember.campusAccessMode,
			});

		if (!createdMember) {
			throw new Error("Organization member creation did not return a record.");
		}

		await tx
			.update(user)
			.set({ organizationInitializedAt: new Date() })
			.where(eq(user.id, input.userId));
		await tx
			.update(session)
			.set({ activeOrganizationId: createdOrganization.id })
			.where(
				and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
			);

		return toCurrentOrganization(
			{ organization: createdOrganization, member: createdMember },
			[{ organization: createdOrganization, member: createdMember }],
			{ kind: "all" },
		);
	});
}

export async function selectCurrentOrganization(input: {
	userId: string;
	sessionId: string;
	organizationId: string;
}): Promise<CurrentOrganizationRecord> {
	return db.transaction(async (tx) => {
		const [sessionRecord] = await tx
			.select({ id: session.id })
			.from(session)
			.where(
				and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
			)
			.limit(1)
			.for("update");

		if (!sessionRecord) {
			throw new OrganizationContextError("SESSION_NOT_FOUND");
		}

		const memberships = await listMemberships(tx, input.userId);
		const selected = memberships.find(
			(item) => item.organization.id === input.organizationId,
		);
		if (!selected) {
			throw new OrganizationContextError("ORGANIZATION_NOT_FOUND");
		}

		await tx
			.update(session)
			.set({ activeOrganizationId: selected.organization.id })
			.where(
				and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
			);
		await tx
			.update(user)
			.set({ organizationInitializedAt: new Date() })
			.where(
				and(eq(user.id, input.userId), isNull(user.organizationInitializedAt)),
			);

		return toCurrentOrganization(
			selected,
			memberships,
			await getCampusAccess(tx, selected.member),
		);
	});
}
