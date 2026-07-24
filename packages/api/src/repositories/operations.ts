import {
	confirmLeadImport as confirmLeadImportRecord,
	listNotifications,
	listOrganizationAuditEvents,
	markAllNotificationsRead,
	markNotificationRead,
	OperationsRepositoryError,
	previewLeadImport as previewLeadImportRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	AuditEventListInput,
	AuditEventListResult,
	ConfirmLeadImportInput,
	ConfirmLeadImportResult,
	NotificationListInput,
	NotificationListResult,
	PreviewLeadImportInput,
	PreviewLeadImportResult,
} from "../contracts/training";

type OperationsScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<
		typeof listOrganizationAuditEvents
	>[0]["campusAccess"];
};

function throwOperationsError(error: unknown): never {
	if (error instanceof OperationsRepositoryError) {
		switch (error.code) {
			case "NOTIFICATION_NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { message: "通知不存在。" });
			case "IMPORT_IN_PROGRESS":
				throw new ORPCError("CONFLICT", {
					message: "该导入正在处理，请稍后刷新。",
				});
			case "IMPORT_INVALID_CSV":
				throw new ORPCError("BAD_REQUEST", { message: "CSV 模板或内容无效。" });
			case "IMPORT_LIMIT_EXCEEDED":
				throw new ORPCError("BAD_REQUEST", {
					message: "CSV 文件或行数超过导入限制。",
				});
			case "IMPORT_DEFAULT_CAMPUS_INVALID":
				throw new ORPCError("BAD_REQUEST", { message: "默认校区不可用。" });
			case "IMPORT_IDEMPOTENCY_CONFLICT":
				throw new ORPCError("CONFLICT", {
					message: "该请求 ID 已用于不同的导入内容。",
				});
			case "MEMBER_FORBIDDEN":
				throw new ORPCError("FORBIDDEN", {
					message: "当前账号无权导入招生线索。",
				});
			case "AUDIT_FORBIDDEN":
				throw new ORPCError("FORBIDDEN", {
					message: "当前账号无权查看操作审计。",
				});
			case "INVALID_CURSOR":
				throw new ORPCError("BAD_REQUEST", {
					message: "分页位置无效，请重新加载审计列表。",
				});
		}
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "暂时无法处理请求，请稍后重试。",
	});
}

export async function listAuditEvents(
	scope: OperationsScope,
	input: AuditEventListInput,
): Promise<AuditEventListResult> {
	try {
		const result = await listOrganizationAuditEvents({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			action: input.action,
			actorUserId: input.actorUserId,
			createdAtFrom: input.createdAtFrom
				? new Date(input.createdAtFrom)
				: undefined,
			createdAtTo: input.createdAtTo ? new Date(input.createdAtTo) : undefined,
			cursor: input.cursor,
			pageSize: input.pageSize,
		});
		return {
			items: result.items.map((item) => ({
				...item,
				createdAt: item.createdAt.toISOString(),
			})),
			nextCursor: result.nextCursor,
		};
	} catch (error) {
		return throwOperationsError(error);
	}
}

export async function getNotifications(
	scope: OperationsScope,
	input: NotificationListInput,
): Promise<NotificationListResult> {
	try {
		const result = await listNotifications({
			organizationId: scope.organizationId,
			userId: scope.userId,
			limit: input.limit,
		});
		return {
			unreadCount: result.unreadCount,
			items: result.items.map((item) => ({
				id: item.id,
				type: item.type,
				title: item.title,
				body: item.body,
				entityType: item.entityType,
				entityId: item.entityId,
				readAt: item.readAt?.toISOString() ?? null,
				createdAt: item.createdAt.toISOString(),
			})),
		};
	} catch (error) {
		return throwOperationsError(error);
	}
}

export async function readNotification(scope: OperationsScope, id: string) {
	try {
		return await markNotificationRead({
			organizationId: scope.organizationId,
			userId: scope.userId,
			id,
		});
	} catch (error) {
		return throwOperationsError(error);
	}
}

export async function readAllNotifications(scope: OperationsScope) {
	try {
		return await markAllNotificationsRead({
			organizationId: scope.organizationId,
			userId: scope.userId,
		});
	} catch (error) {
		return throwOperationsError(error);
	}
}

export async function previewLeadImport(
	scope: OperationsScope,
	input: PreviewLeadImportInput,
): Promise<PreviewLeadImportResult> {
	try {
		const result = await previewLeadImportRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			campusAccess: scope.campusAccess,
			defaultCampusId: input.defaultCampusId ?? input.campusId ?? null,
			content: input.content,
		});
		return {
			totalRows: result.rows.length + result.errors.length,
			validRows: result.rows.length,
			errors: result.errors,
		};
	} catch (error) {
		return throwOperationsError(error);
	}
}

export async function confirmLeadImport(
	scope: OperationsScope,
	input: ConfirmLeadImportInput,
): Promise<ConfirmLeadImportResult> {
	try {
		return await confirmLeadImportRecord({
			...scope,
			requestId: input.requestId,
			defaultCampusId: input.defaultCampusId ?? input.campusId ?? null,
			content: input.content,
		});
	} catch (error) {
		return throwOperationsError(error);
	}
}
