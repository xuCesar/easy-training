import { createHash } from "node:crypto";

import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lte,
	sql,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	course,
	leadImportBatch,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	organizationNotification,
	user,
} from "../schema";
import { createLeadRecordInTransaction, type WritableLeadStage } from "./leads";
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
			| "IMPORT_INVALID_CSV"
			| "IMPORT_LIMIT_EXCEEDED"
			| "IMPORT_DEFAULT_CAMPUS_INVALID"
			| "IMPORT_IDEMPOTENCY_CONFLICT"
			| "MEMBER_FORBIDDEN",
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

const MAX_IMPORT_CONTENT_LENGTH = 500_000;
const MAX_IMPORT_ROWS = 1_000;

type CsvRow = { cells: string[]; row: number };

function parseCsv(content: string): CsvRow[] {
	if (content.length > MAX_IMPORT_CONTENT_LENGTH) {
		throw new OperationsRepositoryError("IMPORT_LIMIT_EXCEEDED");
	}

	const rows: CsvRow[] = [];
	let row: string[] = [];
	let value = "";
	let quoted = false;
	let line = 1;
	let rowStart = 1;
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
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && content[index + 1] === "\n") index += 1;
			line += 1;
			if (quoted) {
				value += "\n";
				continue;
			}
			row.push(value.trim());
			if (row.some(Boolean)) rows.push({ cells: row, row: rowStart });
			row = [];
			value = "";
			rowStart = line;
		} else value += char;
	}
	if (quoted) throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	row.push(value.trim());
	if (row.some(Boolean)) rows.push({ cells: row, row: rowStart });
	return rows;
}

type ParsedLead = {
	row: number;
	name: string;
	phone: string;
	source: string;
	stage: Exclude<WritableLeadStage, "lost">;
	note: string | null;
	interestedCourseCode: string | null;
	ownerEmail: string | null;
	campusCode: string | null;
};

type ParsedLeadImport = {
	rows: ParsedLead[];
	errors: ImportRowError[];
};

function getHeaderIndex(
	columns: Map<string, number>,
	aliases: readonly string[],
): number | undefined {
	for (const alias of aliases) {
		const index = columns.get(alias);
		if (index !== undefined) return index;
	}
	return undefined;
}

function parseLeadImport(content: string): ParsedLeadImport {
	const records = parseCsv(content.replace(/^\uFEFF/, ""));
	const [header, ...data] = records;
	if (!header) throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	if (data.length > MAX_IMPORT_ROWS) {
		throw new OperationsRepositoryError("IMPORT_LIMIT_EXCEEDED");
	}
	const columns = new Map<string, number>();
	for (const [index, value] of header.cells.entries()) {
		if (columns.has(value)) {
			throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
		}
		columns.set(value, index);
	}
	const nameColumn = getHeaderIndex(columns, ["姓名"]);
	const phoneColumn = getHeaderIndex(columns, ["手机号", "电话"]);
	const sourceColumn = getHeaderIndex(columns, ["来源"]);
	if (
		nameColumn === undefined ||
		phoneColumn === undefined ||
		sourceColumn === undefined
	) {
		throw new OperationsRepositoryError("IMPORT_INVALID_CSV");
	}
	const stageColumn = getHeaderIndex(columns, ["跟进状态", "阶段"]);
	const noteColumn = getHeaderIndex(columns, ["备注"]);
	const courseCodeColumn = getHeaderIndex(columns, ["意向课程编码"]);
	const ownerEmailColumn = getHeaderIndex(columns, ["负责人邮箱"]);
	const campusCodeColumn = getHeaderIndex(columns, ["校区编码"]);
	const rows: ParsedLead[] = [];
	const errors: ImportRowError[] = [];
	for (const record of data) {
		if (record.cells.length > header.cells.length) {
			errors.push({ row: record.row, message: "列数超过表头定义。" });
			continue;
		}
		const get = (column: number | undefined) =>
			column === undefined ? "" : (record.cells[column]?.trim() ?? "");
		const name = get(nameColumn);
		const phone = get(phoneColumn);
		const source = get(sourceColumn);
		const rawStage = get(stageColumn) || "new";
		const stage =
			rawStage === "new" ||
			rawStage === "contacted" ||
			rawStage === "trialBooked"
				? rawStage
				: null;
		if (
			!name ||
			name.length > 50 ||
			!phone ||
			phone.length > 30 ||
			!source ||
			source.length > 50 ||
			get(noteColumn).length > 1000 ||
			get(courseCodeColumn).length > 30 ||
			get(campusCodeColumn).length > 30 ||
			get(ownerEmailColumn).length > 254 ||
			!stage
		) {
			errors.push({
				row: record.row,
				message: "姓名、手机号、来源、跟进状态或字段长度不符合要求。",
			});
			continue;
		}
		const ownerEmail = get(ownerEmailColumn).toLocaleLowerCase("en-US");
		if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(ownerEmail)) {
			errors.push({ row: record.row, message: "负责人邮箱格式无效。" });
			continue;
		}
		rows.push({
			row: record.row,
			name,
			phone,
			source,
			stage,
			note: get(noteColumn) || null,
			interestedCourseCode: get(courseCodeColumn) || null,
			ownerEmail: ownerEmail || null,
			campusCode: get(campusCodeColumn) || null,
		});
	}
	return { rows, errors };
}

function isCampusAccessible(
	campusAccess: CampusAccess,
	campusId: string,
): boolean {
	return (
		campusAccess.kind === "all" ||
		(campusAccess.kind === "selected" &&
			campusAccess.campusIds.includes(campusId))
	);
}

function campusScopeCondition(campusAccess: CampusAccess) {
	if (campusAccess.kind === "none") return sql`false`;
	if (campusAccess.kind === "selected") {
		return inArray(campus.id, campusAccess.campusIds);
	}
	return sql`true`;
}

async function getCurrentImportCampusAccess(
	tx: Transaction,
	input: { organizationId: string; userId: string },
): Promise<CampusAccess> {
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
	if (
		!member ||
		!["owner", "admin", "campus_manager", "consultant"].includes(member.role)
	) {
		throw new OperationsRepositoryError("MEMBER_FORBIDDEN");
	}
	if (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	) {
		return { kind: "all" };
	}
	const scopes = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));
	return scopes.length > 0
		? { kind: "selected", campusIds: scopes.map((item) => item.campusId) }
		: { kind: "none" };
}

type ResolvedLead = Omit<
	ParsedLead,
	"row" | "interestedCourseCode" | "ownerEmail" | "campusCode"
> & {
	ownerUserId: string;
	interestedCourseId: string | null;
	campusId: string | null;
};

async function resolveLeadImport(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
		campusAccess: CampusAccess;
		defaultCampusId: string | null;
		parsed: ParsedLeadImport;
	},
): Promise<{ rows: ResolvedLead[]; errors: ImportRowError[] }> {
	let defaultCampusId: string | null = null;
	if (input.defaultCampusId) {
		const [defaultCampus] = await tx
			.select({ id: campus.id })
			.from(campus)
			.where(
				and(
					eq(campus.id, input.defaultCampusId),
					eq(campus.organizationId, input.organizationId),
					eq(campus.isActive, true),
					campusScopeCondition(input.campusAccess),
				),
			)
			.limit(1);
		if (!defaultCampus) {
			throw new OperationsRepositoryError("IMPORT_DEFAULT_CAMPUS_INVALID");
		}
		defaultCampusId = defaultCampus.id;
	}

	const campusCodes = input.parsed.rows
		.map((row) => row.campusCode)
		.filter((value): value is string => value !== null);
	const courseCodes = input.parsed.rows
		.map((row) => row.interestedCourseCode)
		.filter((value): value is string => value !== null);
	const ownerEmails = input.parsed.rows
		.map((row) => row.ownerEmail)
		.filter((value): value is string => value !== null);

	const [campuses, courses, owners] = await Promise.all([
		campusCodes.length > 0
			? tx
					.select({ id: campus.id, code: campus.code })
					.from(campus)
					.where(
						and(
							eq(campus.organizationId, input.organizationId),
							eq(campus.isActive, true),
							campusScopeCondition(input.campusAccess),
							inArray(campus.code, campusCodes),
						),
					)
			: Promise.resolve([]),
		courseCodes.length > 0
			? tx
					.select({ id: course.id, code: course.code })
					.from(course)
					.where(
						and(
							eq(course.organizationId, input.organizationId),
							inArray(course.code, courseCodes),
						),
					)
			: Promise.resolve([]),
		ownerEmails.length > 0
			? tx
					.select({ userId: organizationMember.userId, email: user.email })
					.from(organizationMember)
					.innerJoin(user, eq(user.id, organizationMember.userId))
					.where(
						and(
							eq(organizationMember.organizationId, input.organizationId),
							inArray(sql<string>`lower(${user.email})`, ownerEmails),
						),
					)
			: Promise.resolve([]),
	]);

	const campusByCode = new Map(campuses.map((item) => [item.code, item.id]));
	const courseByCode = new Map(courses.map((item) => [item.code, item.id]));
	const ownerByEmail = new Map(
		owners.map((item) => [item.email.toLocaleLowerCase("en-US"), item.userId]),
	);
	const rows: ResolvedLead[] = [];
	const errors = [...input.parsed.errors];
	for (const row of input.parsed.rows) {
		const campusId: string | null = row.campusCode
			? (campusByCode.get(row.campusCode) ?? null)
			: defaultCampusId;
		if (row.campusCode && !campusId) {
			errors.push({
				row: row.row,
				message: "校区编码不存在、已停用或不在当前可访问范围。",
			});
			continue;
		}
		if (!campusId && input.campusAccess.kind !== "all") {
			errors.push({
				row: row.row,
				message: "必须提供可访问的校区编码或默认校区。",
			});
			continue;
		}
		if (campusId && !isCampusAccessible(input.campusAccess, campusId)) {
			errors.push({ row: row.row, message: "校区不在当前可访问范围。" });
			continue;
		}
		const interestedCourseId: string | null = row.interestedCourseCode
			? (courseByCode.get(row.interestedCourseCode) ?? null)
			: null;
		if (row.interestedCourseCode && !interestedCourseId) {
			errors.push({ row: row.row, message: "意向课程编码不存在。" });
			continue;
		}
		const ownerUserId = row.ownerEmail
			? ownerByEmail.get(row.ownerEmail)
			: input.actorUserId;
		if (!ownerUserId) {
			errors.push({ row: row.row, message: "负责人邮箱不是当前机构成员。" });
			continue;
		}
		rows.push({
			name: row.name,
			phone: row.phone,
			source: row.source,
			stage: row.stage,
			note: row.note,
			ownerUserId,
			interestedCourseId,
			campusId,
		});
	}
	return {
		rows,
		errors: errors.sort((left, right) => left.row - right.row),
	};
}

function createImportInputHash(input: {
	userId: string;
	content: string;
	defaultCampusId: string | null;
}): string {
	return createHash("sha256")
		.update(JSON.stringify(input), "utf8")
		.digest("hex");
}

export async function previewLeadImport(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	defaultCampusId: string | null;
	content: string;
}): Promise<{ rows: ResolvedLead[]; errors: ImportRowError[] }> {
	const parsed = parseLeadImport(input.content);
	return db.transaction((tx) =>
		resolveLeadImport(tx, {
			organizationId: input.organizationId,
			actorUserId: input.userId,
			campusAccess: input.campusAccess,
			defaultCampusId: input.defaultCampusId,
			parsed,
		}),
	);
}

export async function confirmLeadImport(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	requestId: string;
	defaultCampusId: string | null;
	content: string;
}) {
	const parsed = parseLeadImport(input.content);
	const inputHash = createImportInputHash({
		userId: input.userId,
		content: input.content,
		defaultCampusId: input.defaultCampusId,
	});

	const result = await db.transaction(async (tx) => {
		const [createdBatch] = await tx
			.insert(leadImportBatch)
			.values({
				organizationId: input.organizationId,
				requestId: input.requestId,
				inputHash,
				createdByUserId: input.userId,
				status: "processing",
				totalRows: parsed.rows.length + parsed.errors.length,
				importedRows: 0,
				errorRows: parsed.errors.length,
				errors: parsed.errors,
			})
			.onConflictDoNothing()
			.returning({ id: leadImportBatch.id });
		if (!createdBatch) {
			const [existing] = await tx
				.select()
				.from(leadImportBatch)
				.where(
					and(
						eq(leadImportBatch.organizationId, input.organizationId),
						eq(leadImportBatch.requestId, input.requestId),
					),
				)
				.limit(1)
				.for("update");
			if (!existing) {
				throw new OperationsRepositoryError("IMPORT_IN_PROGRESS");
			}
			if (existing.inputHash !== inputHash) {
				throw new OperationsRepositoryError("IMPORT_IDEMPOTENCY_CONFLICT");
			}
			if (existing.status === "processing") {
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

		const campusAccess = await getCurrentImportCampusAccess(tx, input);
		const preview = await resolveLeadImport(tx, {
			organizationId: input.organizationId,
			actorUserId: input.userId,
			campusAccess,
			defaultCampusId: input.defaultCampusId,
			parsed,
		});
		const importedRowsByCampus = new Map<string | null, number>();
		for (const row of preview.rows) {
			await createLeadRecordInTransaction(tx, {
				organizationId: input.organizationId,
				ownerUserId: row.ownerUserId,
				operatorUserId: input.userId,
				campusAccess,
				requestId: crypto.randomUUID(),
				campusId: row.campusId,
				interestedCourseId: row.interestedCourseId,
				nextFollowAt: null,
				name: row.name,
				phone: row.phone,
				source: row.source,
				stage: row.stage,
				note: row.note,
			});
			importedRowsByCampus.set(
				row.campusId,
				(importedRowsByCampus.get(row.campusId) ?? 0) + 1,
			);
		}

		const importedRows = preview.rows.length;
		const errors = preview.errors;
		const status = errors.length > 0 ? "completed_with_errors" : "completed";
		await tx
			.update(leadImportBatch)
			.set({ status, importedRows, errorRows: errors.length, errors })
			.where(eq(leadImportBatch.id, createdBatch.id));
		if (importedRowsByCampus.size === 0) {
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "lead_imported",
				entityType: "lead_import_batch",
				entityId: createdBatch.id,
				actorUserId: input.userId,
				after: { importedRows, errorRows: errors.length },
			});
		} else {
			for (const [campusId, campusImportedRows] of importedRowsByCampus) {
				await writeOrganizationAuditEvent(tx, {
					organizationId: input.organizationId,
					action: "lead_imported",
					entityType: "lead_import_batch",
					entityId: createdBatch.id,
					actorUserId: input.userId,
					campusId,
					after: { importedRows: campusImportedRows, errorRows: 0 },
				});
			}
		}
		return {
			batchId: createdBatch.id,
			importedRows,
			errorRows: errors.length,
			errors,
			replayed: false,
		};
	});

	try {
		await db.transaction((tx) =>
			createInAppNotification(tx, {
				organizationId: input.organizationId,
				recipientUserId: input.userId,
				type:
					result.errorRows > 0 ? "lead_import_failed" : "lead_import_completed",
				title:
					result.errorRows > 0 ? "线索导入已完成，部分行失败" : "线索导入完成",
				body: `已导入 ${result.importedRows} 条线索${result.errorRows ? `，${result.errorRows} 行未导入` : ""}。`,
				entityType: "lead_import_batch",
				entityId: result.batchId,
				idempotencyKey: `lead-import:${result.batchId}`,
			}),
		);
	} catch (error) {
		// 通知是导入后的附属投递，失败不能回滚已完成的业务写入。
		console.error("Lead import notification delivery failed.", error);
	}
	return result;
}
