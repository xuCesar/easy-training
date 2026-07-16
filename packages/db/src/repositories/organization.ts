import { asc, eq, sql } from "drizzle-orm";

import { db } from "../index";
import { organization, organizationMember } from "../schema";

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
};

/**
 * 同一用户的首次业务访问由事务级 advisory lock 串行化，避免并发创建重复机构。
 */
export async function getOrCreateCurrentOrganization(input: {
	userId: string;
	userName: string;
}): Promise<CurrentOrganizationRecord> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`,
		);

		const [existingMembership] = await tx
			.select({
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
			})
			.from(organizationMember)
			.innerJoin(
				organization,
				eq(organization.id, organizationMember.organizationId),
			)
			.where(eq(organizationMember.userId, input.userId))
			.orderBy(asc(organizationMember.createdAt))
			.limit(1);

		if (existingMembership) {
			return {
				...existingMembership,
				role: existingMembership.member.role,
			};
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

		return {
			organization: createdOrganization,
			member: createdMember,
			role: createdMember.role,
		};
	});
}
