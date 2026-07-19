import type { db } from "../index";
import { organizationAuditEvent } from "../schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OrganizationAuditAction =
	(typeof organizationAuditEvent.$inferInsert)["action"];

export async function writeOrganizationAuditEvent(
	tx: Transaction,
	input: {
		organizationId: string;
		action: OrganizationAuditAction;
		entityType: string;
		entityId: string;
		actorUserId: string | null;
		targetUserId?: string | null;
		campusId?: string | null;
		before?: Record<string, unknown> | null;
		after?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(organizationAuditEvent).values({
		...input,
		targetUserId: input.targetUserId ?? null,
		campusId: input.campusId ?? null,
		before: input.before ?? null,
		after: input.after ?? null,
	});
}
