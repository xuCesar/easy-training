import {
	addLeadFollowUpRecord,
	campusExistsInOrganization,
	courseExistsInOrganization,
	createLeadRecord,
	exportLeadRecords,
	type LeadActivityRow,
	type LeadRecordRow,
	LeadRepositoryError,
	listLeadActivities,
	listLeadFilterOptions,
	listLeadRecords,
	updateLeadRecord,
	type WritableLeadStage,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	AddLeadFollowUpInput,
	CreateLeadInput,
	CreateLeadResult,
	ExportLeadsInput,
	ExportLeadsResult,
	LeadActivityRecord,
	LeadFilterOptions,
	LeadHistoryResult,
	LeadListInput,
	LeadListResult,
	LeadRecord,
	UpdateLeadInput,
} from "../contracts/training";

type LeadScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listLeadRecords>[0]["campusAccess"];
};

function toLeadRecord(row: LeadRecordRow): LeadRecord {
	return {
		...row,
		interestedCourse: row.interestedCourse ?? "",
		owner: row.owner ?? "",
		nextFollowAt: row.nextFollowAt?.toISOString() ?? null,
		note: row.note ?? "",
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toLeadActivity(row: LeadActivityRow): LeadActivityRecord {
	return {
		...row,
		nextFollowAt: row.nextFollowAt?.toISOString() ?? null,
		lostReason: row.lostReason ?? null,
		createdAt: row.createdAt.toISOString(),
	};
}

function isForeignKeyViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23503"
	);
}

function throwRepositoryError(error: LeadRepositoryError): never {
	switch (error.code) {
		case "LEAD_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "线索不存在。" });
		case "LEAD_ENROLLED":
			throw new ORPCError("CONFLICT", {
				message: "已报名线索不能修改或继续跟进。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该创建请求已使用，且提交内容不一致。",
			});
		case "INVALID_CURSOR":
			throw new ORPCError("BAD_REQUEST", { message: "分页游标无效。" });
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权访问该校区。" });
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续写入。",
			});
	}
}

function throwDatabaseError(error: unknown): never {
	if (error instanceof LeadRepositoryError) return throwRepositoryError(error);
	if (isForeignKeyViolation(error)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "关联的校区或课程不可用。",
		});
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "暂时无法处理请求，请稍后重试。",
	});
}

async function assertAssociationsBelongToOrganization(input: {
	organizationId: string;
	campusAccess: LeadScope["campusAccess"];
	campusId?: string | null;
	interestedCourseId?: string | null;
}): Promise<void> {
	const checks: Promise<boolean>[] = [];

	if (input.campusId) {
		checks.push(
			campusExistsInOrganization({
				organizationId: input.organizationId,
				id: input.campusId,
				campusAccess: input.campusAccess,
			}),
		);
	}
	if (input.interestedCourseId) {
		checks.push(
			courseExistsInOrganization({
				organizationId: input.organizationId,
				id: input.interestedCourseId,
			}),
		);
	}

	if ((await Promise.all(checks)).some((result) => !result)) {
		throw new ORPCError("NOT_FOUND", { message: "关联资源不存在。" });
	}
}

function toListInput(input: LeadListInput) {
	return {
		query: input.query,
		stage: input.stage === "all" ? undefined : input.stage,
		campusId: input.campusId,
		ownerUserId: input.ownerUserId,
		createdAtFrom: input.createdAtFrom
			? new Date(input.createdAtFrom)
			: undefined,
		createdAtTo: input.createdAtTo ? new Date(input.createdAtTo) : undefined,
	};
}

export async function listLeads(
	scope: LeadScope,
	input: LeadListInput,
): Promise<LeadListResult> {
	try {
		const result = await listLeadRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			...toListInput(input),
			cursor: input.cursor,
			pageSize: input.pageSize,
		});
		return {
			items: result.items.map(toLeadRecord),
			total: result.total,
			nextCursor: result.nextCursor,
		};
	} catch (error) {
		return throwDatabaseError(error);
	}
}

export async function getLeadFilterOptions(
	scope: LeadScope,
): Promise<LeadFilterOptions> {
	try {
		return await listLeadFilterOptions({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
		});
	} catch (error) {
		return throwDatabaseError(error);
	}
}

export async function createLead(
	scope: LeadScope,
	input: CreateLeadInput,
): Promise<CreateLeadResult> {
	try {
		await assertAssociationsBelongToOrganization({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			campusId: input.campusId,
			interestedCourseId: input.interestedCourseId,
		});

		const result = await createLeadRecord({
			organizationId: scope.organizationId,
			ownerUserId: scope.userId,
			campusAccess: scope.campusAccess,
			...input,
			nextFollowAt: input.nextFollowAt ? new Date(input.nextFollowAt) : null,
		});

		return { lead: toLeadRecord(result.lead), replayed: result.replayed };
	} catch (error) {
		return throwDatabaseError(error);
	}
}

export async function updateLead(
	scope: LeadScope,
	input: UpdateLeadInput,
): Promise<LeadRecord> {
	try {
		await assertAssociationsBelongToOrganization({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			campusId: input.data.campusId,
			interestedCourseId: input.data.interestedCourseId,
		});

		const updated = await updateLeadRecord({
			organizationId: scope.organizationId,
			id: input.id,
			operatorUserId: scope.userId,
			campusAccess: scope.campusAccess,
			data: input.data,
		});

		return toLeadRecord(updated);
	} catch (error) {
		return throwDatabaseError(error);
	}
}

export async function addLeadFollowUp(
	scope: LeadScope,
	input: AddLeadFollowUpInput,
): Promise<LeadRecord> {
	try {
		const updated = await addLeadFollowUpRecord({
			organizationId: scope.organizationId,
			leadId: input.leadId,
			operatorUserId: scope.userId,
			campusAccess: scope.campusAccess,
			content: input.content,
			stage: input.stage as WritableLeadStage,
			nextFollowAt: input.nextFollowAt ? new Date(input.nextFollowAt) : null,
			lostReason: input.lostReason,
		});
		return toLeadRecord(updated);
	} catch (error) {
		return throwDatabaseError(error);
	}
}

export async function getLeadHistory(
	scope: LeadScope,
	leadId: string,
): Promise<LeadHistoryResult> {
	try {
		const items = await listLeadActivities({
			organizationId: scope.organizationId,
			leadId,
			campusAccess: scope.campusAccess,
		});
		return { items: items.map(toLeadActivity) };
	} catch (error) {
		return throwDatabaseError(error);
	}
}

function quoteCsv(value: string | number | null): string {
	const raw = value == null ? "" : String(value);
	// Avoid spreadsheet formula execution when users open a CSV export.
	const text = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
	return `"${text.replaceAll('"', '""')}"`;
}

export async function exportLeads(
	scope: LeadScope,
	input: ExportLeadsInput,
): Promise<ExportLeadsResult> {
	try {
		const rows = await exportLeadRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			...toListInput({ ...input, cursor: undefined, pageSize: 20 }),
			limit: input.limit,
		});
		const lines = [
			["姓名", "电话", "来源", "阶段", "负责人", "下次跟进", "创建时间"].join(
				",",
			),
			...rows.map((row) =>
				[
					quoteCsv(row.name),
					quoteCsv(row.phone),
					quoteCsv(row.source),
					quoteCsv(row.stage),
					quoteCsv(row.owner),
					quoteCsv(row.nextFollowAt?.toISOString() ?? null),
					quoteCsv(row.createdAt.toISOString()),
				].join(","),
			),
		];
		const date = new Date().toISOString().slice(0, 10);
		return {
			fileName: `招生线索-${date}.csv`,
			csv: `\uFEFF${lines.join("\n")}`,
		};
	} catch (error) {
		return throwDatabaseError(error);
	}
}
