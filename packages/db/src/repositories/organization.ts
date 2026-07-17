import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../index";
import { organization, organizationMember, session, user } from "../schema";

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
	};
	role: (typeof organizationMember.$inferSelect)["role"];
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
	},
};

type MembershipRecord = {
	organization: CurrentOrganizationRecord["organization"];
	member: CurrentOrganizationRecord["member"];
};

function toCurrentOrganization(
	current: MembershipRecord,
	memberships: MembershipRecord[],
): CurrentOrganizationRecord {
	return {
		...current,
		role: current.member.role,
		organizations: memberships.map(
			({ organization: organizationRecord, member }) => ({
				...organizationRecord,
				role: member.role,
			}),
		),
	};
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

/**
 * 同一用户的首次业务访问由事务级 advisory lock 串行化，避免并发创建重复机构。
 */
export async function getOrCreateCurrentOrganization(input: {
	userId: string;
	userName: string;
	sessionId: string;
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

			return toCurrentOrganization(current, memberships);
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

		return toCurrentOrganization(selected, memberships);
	});
}
