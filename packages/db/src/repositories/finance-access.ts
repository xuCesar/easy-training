import { and, asc, eq, sql } from "drizzle-orm";

import type { db } from "../index";
import { organizationMember, organizationMemberCampus } from "../schema";
import type { CampusAccess } from "./organization";

export type FinanceTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

type MemberRole = (typeof organizationMember.$inferSelect)["role"];

export type FinanceWriteAccess = {
	role: MemberRole;
	campusAccess: CampusAccess;
};

const financeWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"finance",
]);

export async function getCurrentFinanceWriteCampusAccess(
	tx: FinanceTransaction,
	input: { organizationId: string; userId: string },
	createForbiddenError: () => Error,
): Promise<CampusAccess> {
	return (await getCurrentFinanceWriteAccess(tx, input, createForbiddenError))
		.campusAccess;
}

export async function getCurrentFinanceWriteAccess(
	tx: FinanceTransaction,
	input: { organizationId: string; userId: string },
	createForbiddenError: () => Error,
): Promise<FinanceWriteAccess> {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`,
	);
	const [member] = await tx
		.select({
			id: organizationMember.id,
			role: organizationMember.role,
			campusAccessMode: organizationMember.campusAccessMode,
		})
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.userId),
			),
		)
		.limit(1)
		.for("update");
	if (!member || !financeWriteRoles.has(member.role)) {
		throw createForbiddenError();
	}
	if (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	) {
		return { role: member.role, campusAccess: { kind: "all" } };
	}
	const scopes = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));
	return {
		role: member.role,
		campusAccess:
			scopes.length > 0
				? { kind: "selected", campusIds: scopes.map((item) => item.campusId) }
				: { kind: "none" },
	};
}
