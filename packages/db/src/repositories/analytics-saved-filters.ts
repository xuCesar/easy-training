import { and, desc, eq } from "drizzle-orm";

import { db } from "../index";
import { analyticsSavedFilter } from "../schema";
import { writeOrganizationAuditEvent } from "./audit";

export type AnalyticsSavedFilterConfig = {
	reportKind: "overview" | "comparison" | "resourceFinance";
	range: unknown;
	dimension?: "campus" | "course" | "teacher" | "class";
	sortBy?: string;
	sortDirection?: "asc" | "desc";
};

export async function listAnalyticsSavedFilters(input: {
	organizationId: string;
	userId: string;
}) {
	return db
		.select()
		.from(analyticsSavedFilter)
		.where(
			and(
				eq(analyticsSavedFilter.organizationId, input.organizationId),
				eq(analyticsSavedFilter.userId, input.userId),
			),
		)
		.orderBy(
			desc(analyticsSavedFilter.updatedAt),
			desc(analyticsSavedFilter.id),
		);
}

export async function createAnalyticsSavedFilter(input: {
	organizationId: string;
	userId: string;
	name: string;
	config: AnalyticsSavedFilterConfig;
}) {
	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(analyticsSavedFilter)
			.values({ ...input, reportKind: input.config.reportKind })
			.returning();
		if (!created)
			throw new Error("Saved filter creation did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "analytics_filter_saved",
			entityType: "analyticsSavedFilter",
			entityId: created.id,
			actorUserId: input.userId,
			after: { reportKind: input.config.reportKind },
		});
		return created;
	});
}

export async function updateAnalyticsSavedFilter(input: {
	id: string;
	organizationId: string;
	userId: string;
	name: string;
	config: AnalyticsSavedFilterConfig;
}) {
	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(analyticsSavedFilter)
			.set({
				name: input.name,
				config: input.config,
				reportKind: input.config.reportKind,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(analyticsSavedFilter.id, input.id),
					eq(analyticsSavedFilter.organizationId, input.organizationId),
					eq(analyticsSavedFilter.userId, input.userId),
				),
			)
			.returning();
		if (!updated) return null;
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "analytics_filter_updated",
			entityType: "analyticsSavedFilter",
			entityId: updated.id,
			actorUserId: input.userId,
			after: { reportKind: input.config.reportKind },
		});
		return updated;
	});
}

export async function deleteAnalyticsSavedFilter(input: {
	id: string;
	organizationId: string;
	userId: string;
}) {
	return db.transaction(async (tx) => {
		const [deleted] = await tx
			.delete(analyticsSavedFilter)
			.where(
				and(
					eq(analyticsSavedFilter.id, input.id),
					eq(analyticsSavedFilter.organizationId, input.organizationId),
					eq(analyticsSavedFilter.userId, input.userId),
				),
			)
			.returning();
		if (!deleted) return null;
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "analytics_filter_deleted",
			entityType: "analyticsSavedFilter",
			entityId: deleted.id,
			actorUserId: input.userId,
			before: { reportKind: deleted.reportKind },
		});
		return deleted;
	});
}

/** 导出不保存结果或筛选内容，仅保留最小可追溯事实。 */
export async function recordAnalyticsExport(input: {
	organizationId: string;
	userId: string;
	reportKind: AnalyticsSavedFilterConfig["reportKind"];
	rowCount: number;
}) {
	return db.transaction(async (tx) => {
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "analytics_exported",
			entityType: "analyticsExport",
			entityId: crypto.randomUUID(),
			actorUserId: input.userId,
			after: { reportKind: input.reportKind, rowCount: input.rowCount },
		});
	});
}
