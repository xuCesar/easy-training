import { and, asc, eq, sql } from "drizzle-orm";

import type { db } from "../index";
import { organizationMember, organizationMemberCampus } from "../schema";
import type { CampusAccess } from "./organization";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MemberRole = (typeof organizationMember.$inferSelect)["role"];

export type OperationTaskWriteAccess = {
	role: MemberRole;
	campusAccess: CampusAccess;
};

/**
 * 任务写操作在事务内重新读取成员关系，避免 middleware 通过后权限变更仍使用旧范围。
 */
export async function getCurrentOperationTaskWriteAccess(
	tx: Transaction,
	input: { organizationId: string; userId: string },
	createForbiddenError: () => Error,
): Promise<OperationTaskWriteAccess> {
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
	if (!member) throw createForbiddenError();
	if (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	) {
		return { role: member.role, campusAccess: { kind: "all" } };
	}
	const rows = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));
	return {
		role: member.role,
		campusAccess:
			rows.length > 0
				? { kind: "selected", campusIds: rows.map((row) => row.campusId) }
				: { kind: "none" },
	};
}
