import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "../index";
import {
	leadImportBatch,
	organizationAuditEvent,
	organizationNotification,
	user,
} from "../schema";
import { createLeadRecord, type WritableLeadStage } from "./leads";
import type { CampusAccess } from "./organization";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuditAction = (typeof organizationAuditEvent.$inferInsert)["action"];
type NotificationType = (typeof organizationNotification.$inferInsert)["type"];

export class OperationsRepositoryError extends Error {
	constructor(
		public readonly code:
			| "AUDIT_FORBIDDEN"
			| "NOTIFICATION_NOT_FOUND"
			| "IMPORT_IN_PROGRESS"
			| "IMPORT_INVALID_CSV",
	) {
		super(code);
		this.name = "OperationsRepositoryError";
	}
}

export type ImportRowError = { row: number; message: string };

export async function writeOrganizationAuditEvent(
	tx: Transaction,
	input: {
		organizationId: string;
		action: AuditAction;
		entityType: string;
		entityId: string;
		actorUserId: string | null;
		campusId?: string | null;
		before?: Record<string, unknown> | null;
		after?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(organizationAuditEvent).values({
		...input,
		campusId: input.campusId ?? null,
		before: input.before ?? null,
		after: input.after ?? null,
	});
}

function auditCampusScope(campusAccess: CampusAccess) {
	if (campusAccess.kind === "all") return sql`true`;
	if (campusAccess.kind === "selected") {
		return inArray(organizationAuditEvent.campusId, campusAccess.campusIds);
	}
	return sql`false`;
}

export async function listOrganizationAuditEvents(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	action?: AuditAction;
	actorUserId?: string;
	createdAtFrom?: Date;
	createdAtTo?: Date;
	pageSize: number;
}) {
	const filters = [
		eq(organizationAuditEvent.organizationId, input.organizationId),
		auditCampusScope(input.campusAccess),
	];
	if (input.action)
		filters.push(eq(organizationAuditEvent.action, input.action));
	if (input.actorUserId)
		filters.push(eq(organizationAuditEvent.actorUserId, input.actorUserId));
	if (input.createdAtFrom)
		filters.push(gte(organizationAuditEvent.createdAt, input.createdAtFrom));
	if (input.createdAtTo)
		filters.push(lte(organizationAuditEvent.createdAt, input.createdAtTo));

	const rows = await db
		.select({
			id: organizationAuditEvent.id,
			action: organizationAuditEvent.action,
			entityType: organizationAuditEvent.entityType,
			entityId: organizationAuditEvent.entityId,
			campusId: organizationAuditEvent.campusId,
			actorUserId: organizationAuditEvent.actorUserId,
			actorName: user.name,
			createdAt: organizationAuditEvent.createdAt,
		})
		.from(organizationAuditEvent)
		.leftJoin(user, eq(user.id, organizationAuditEvent.actorUserId))
		.where(and(...filters))
		.orderBy(
			desc(organizationAuditEvent.createdAt),
			desc(organizationAuditEvent.id),
		)
		.limit(input.pageSize);

	return { items: rows };
}

export async function listNotifications(input: {
	organizationId: string;
	userId: string;
	limit: number;
}) {
	const [items, unread] = await Promise.all([
		db
			.select()
			.from(organizationNotification)
			.where(
				and(
					eq(organizationNotification.organizationId, input.organizationId),
					eq(organizationNotification.recipientUserId, input.userId),
				),
			)
			.orderBy(desc(organizationNotification.createdAt))
			.limit(input.limit),
		db
			.select({ value: sql<number>`count(*)` })
			.from(organizationNotification)
			.where(
				and(
					eq(organizationNotification.organizationId, input.organizationId),
					eq(organizationNotification.recipientUserId, input.userId),
					isNull(organizationNotification.readAt),
				),
			),
	]);
	return { items, unreadCount: Number(unread[0]?.value ?? 0) };
}

export async function markNotificationRead(input: {
	organizationId: string;
	userId: string;
	id: string;
}) {
	return db.transaction(async (tx) => {
		const [record] = await tx
			.update(organizationNotification)
			.set({ readAt: new Date() })
			.where(
				and(
					eq(organizationNotification.id, input.id),
					eq(organizationNotification.organizationId, input.organizationId),
					eq(organizationNotification.recipientUserId, input.userId),
				),
			)
			.returning({
				id: organizationNotification.id,
				readAt: organizationNotification.readAt,
			});
		if (!record) throw new OperationsRepositoryError("NOTIFICATION_NOT_FOUND");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "notification_read",
			entityType: "organization_notification",
			entityId: input.id,
			actorUserId: input.userId,
		});
		return record;
	});
}

export async function markAllNotificationsRead(input: {
	organizationId: string;
	userId: string;
}) {
	return db.transaction(async (tx) => {
		const records = await tx
			.update(organizationNotification)
			.set({ readAt: new Date() })
			.where(
				and(
					eq(organizationNotification.organizationId, input.organizationId),
					eq(organizationNotification.recipientUserId, input.userId),
					isNull(organizationNotification.readAt),
				),
			)
			.returning({ id: organizationNotification.id });
		if (records.length > 0) {
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "notifications_marked_read",
				entityType: "organization_notification",
				entityId: records[0]?.id ?? crypto.randomUUID(),
				actorUserId: input.userId,
				after: { count: records.length },
			});
		}
		return { count: records.length };
	});
}

export async function createInAppNotification(
	tx: Transaction,
	input: {
		organizationId: string;
		recipientUserId: string;
		campusId?: string | null;
		type: NotificationType;
		title: string;
		body: string;
		entityType: string;
		entityId: string;
		idempotencyKey: string;
	},
) {
	await tx
		.insert(organizationNotification)
		.values({ ...input, campusId: input.campusId ?? null })
		.onConflictDoNothing();
}

export async function recordLeadExport(input: {
	organizationId: string;
	userId: string;
	resultCount: number;
}): Promise<void> {
	await db.transaction((tx) =>
		writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "lead_exported",
			entityType: "lead_export",
			entityId: crypto.randomUUID(),
			actorUserId: input.userId,
			after: { resultCount: input.resultCount },
		}),
	);
}

function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let value = "";
	let quoted = false;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index] ?? "";
		if (char === '"') {
			if (quoted && content[index + 1] === '"') {
				value += '"';
				index += 1;
			} else quoted = !quoted;
		} else if (char === "," && !quoted) {
			row.push(value.trim());
			value = "";
		} else if ((char === "\n" || char === "\r") && !quoted) {
			if (char === "\r" && content[index + 1] === "\n") index += 1;
			row.push(value.trim());
			if (row.some(Boolean)) rows.push(row);
			row = [];
			value = "";
		} else value += char;
	}
	if (quoted) throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	row.push(value.trim());
	if (row.some(Boolean)) rows.push(row);
	return rows;
}

type ParsedLead = {
	name: string;
	phone: string;
	source: string;
	stage: Exclude<WritableLeadStage, "lost">;
	note: string | null;
};

export function previewLeadImport(content: string): {
	rows: ParsedLead[];
	errors: ImportRowError[];
} {
	const records = parseCsv(content.replace(/^\uFEFF/, ""));
	const [header, ...data] = records;
	if (!header) throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	const columns = new Map(header.map((value, index) => [value, index]));
	for (const required of ["姓名", "手机号", "来源"]) {
		if (!columns.has(required))
			throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	}
	const rows: ParsedLead[] = [];
	const errors: ImportRowError[] = [];
	for (const [index, cells] of data.entries()) {
		const get = (name: string) => cells[columns.get(name) ?? -1]?.trim() ?? "";
		const name = get("姓名");
		const phone = get("手机号");
		const source = get("来源");
		const rawStage = get("跟进状态") || "new";
		const stage =
			rawStage === "new" ||
			rawStage === "contacted" ||
			rawStage === "trialBooked"
				? rawStage
				: null;
		if (
			!name ||
			name.length > 100 ||
			!phone ||
			phone.length > 40 ||
			!source ||
			source.length > 100 ||
			!stage
		) {
			errors.push({
				row: index + 2,
				message: "姓名、手机号、来源或跟进状态不符合要求。",
			});
			continue;
		}
		rows.push({ name, phone, source, stage, note: get("备注") || null });
	}
	return { rows, errors };
}

export async function confirmLeadImport(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	requestId: string;
	campusId: string | null;
	content: string;
}) {
	const preview = previewLeadImport(input.content);
	const [createdBatch] = await db
		.insert(leadImportBatch)
		.values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			createdByUserId: input.userId,
			status: "processing",
			totalRows: preview.rows.length + preview.errors.length,
			importedRows: 0,
			errorRows: preview.errors.length,
			errors: preview.errors,
		})
		.onConflictDoNothing()
		.returning({ id: leadImportBatch.id });
	if (!createdBatch) {
		const [existing] = await db
			.select()
			.from(leadImportBatch)
			.where(
				and(
					eq(leadImportBatch.organizationId, input.organizationId),
					eq(leadImportBatch.requestId, input.requestId),
				),
			)
			.limit(1);
		if (!existing || existing.status === "processing") {
			throw new OperationsRepositoryError("IMPORT_IN_PROGRESS");
		}
		return {
			batchId: existing.id,
			importedRows: existing.importedRows,
			errorRows: existing.errorRows,
			errors: existing.errors as ImportRowError[],
			replayed: true,
		};
	}

	const errors = [...preview.errors];
	let importedRows = 0;
	for (const [index, row] of preview.rows.entries()) {
		try {
			await createLeadRecord({
				organizationId: input.organizationId,
				ownerUserId: input.userId,
				campusAccess: input.campusAccess,
				requestId: crypto.randomUUID(),
				campusId: input.campusId,
				interestedCourseId: null,
				nextFollowAt: null,
				...row,
			});
			importedRows += 1;
		} catch (error) {
			errors.push({
				row: index + 2,
				message:
					error instanceof Error
						? "当前行无法导入，请检查校区权限。"
						: "当前行无法导入。",
			});
		}
	}

	const status = errors.length > 0 ? "completed_with_errors" : "completed";
	await db.transaction(async (tx) => {
		await tx
			.update(leadImportBatch)
			.set({ status, importedRows, errorRows: errors.length, errors })
			.where(eq(leadImportBatch.id, createdBatch.id));
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "lead_imported",
			entityType: "lead_import_batch",
			entityId: createdBatch.id,
			actorUserId: input.userId,
			campusId: input.campusId,
			after: { importedRows, errorRows: errors.length },
		});
		await createInAppNotification(tx, {
			organizationId: input.organizationId,
			recipientUserId: input.userId,
			campusId: input.campusId,
			type: errors.length > 0 ? "lead_import_failed" : "lead_import_completed",
			title: errors.length > 0 ? "线索导入已完成，部分行失败" : "线索导入完成",
			body: `已导入 ${importedRows} 条线索${errors.length ? `，${errors.length} 行未导入` : ""}。`,
			entityType: "lead_import_batch",
			entityId: createdBatch.id,
			idempotencyKey: `lead-import:${createdBatch.id}`,
		});
	});

	return {
		batchId: createdBatch.id,
		importedRows,
		errorRows: errors.length,
		errors,
		replayed: false,
	};
}
