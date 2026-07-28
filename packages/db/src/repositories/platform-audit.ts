import { platformAuditEvent } from "../schema";
import type { Transaction } from "./campus-access";

export type PlatformAuditAction =
	(typeof platformAuditEvent.$inferInsert)["action"];
export type PlatformAuditSource =
	(typeof platformAuditEvent.$inferInsert)["source"];

export async function writePlatformAuditEvent(
	tx: Transaction,
	input: {
		action: PlatformAuditAction;
		source: PlatformAuditSource;
		actorUserId: string | null;
		entityType: string;
		entityId: string;
		requestId?: string | null;
		metadata?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(platformAuditEvent).values({
		...input,
		requestId: input.requestId ?? null,
		metadata: input.metadata ?? null,
	});
}
