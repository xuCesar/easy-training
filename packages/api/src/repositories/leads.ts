import {
	campusExistsInOrganization,
	courseExistsInOrganization,
	createLeadRecord,
	findLeadStage,
	type LeadRecordRow,
	listLeadRecords,
	type UpdateLeadRecordInput,
	updateLeadRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CreateLeadInput,
	LeadListInput,
	LeadRecord,
	UpdateLeadInput,
} from "../contracts/training";

type LeadScope = {
	organizationId: string;
	userId: string;
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

function isForeignKeyViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23503"
	);
}

function throwDatabaseError(error: unknown): never {
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
	campusId?: string | null;
	interestedCourseId?: string | null;
}): Promise<void> {
	const checks: Promise<boolean>[] = [];

	if (input.campusId) {
		checks.push(
			campusExistsInOrganization({
				organizationId: input.organizationId,
				id: input.campusId,
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

export async function listLeads(
	scope: LeadScope,
	input: LeadListInput,
): Promise<{ items: LeadRecord[]; total: number }> {
	try {
		const result = await listLeadRecords({
			organizationId: scope.organizationId,
			query: input.query,
			stage: input.stage === "all" ? undefined : input.stage,
		});
		return { items: result.items.map(toLeadRecord), total: result.total };
	} catch (error) {
		if (error instanceof ORPCError) {
			throw error;
		}
		return throwDatabaseError(error);
	}
}

export async function createLead(
	scope: LeadScope,
	input: CreateLeadInput,
): Promise<LeadRecord> {
	try {
		await assertAssociationsBelongToOrganization({
			organizationId: scope.organizationId,
			campusId: input.campusId,
			interestedCourseId: input.interestedCourseId,
		});

		const created = await createLeadRecord({
			organizationId: scope.organizationId,
			ownerUserId: scope.userId,
			...input,
			nextFollowAt: input.nextFollowAt ? new Date(input.nextFollowAt) : null,
		});

		if (!created) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "暂时无法创建线索，请稍后重试。",
			});
		}

		return toLeadRecord(created);
	} catch (error) {
		if (error instanceof ORPCError) {
			throw error;
		}
		return throwDatabaseError(error);
	}
}

export async function updateLead(
	scope: LeadScope,
	input: UpdateLeadInput,
): Promise<LeadRecord> {
	try {
		const currentStage = await findLeadStage({
			organizationId: scope.organizationId,
			id: input.id,
		});

		if (!currentStage) {
			throw new ORPCError("NOT_FOUND", { message: "线索不存在。" });
		}
		if (currentStage === "enrolled") {
			throw new ORPCError("CONFLICT", {
				message: "已报名线索不能修改。",
			});
		}

		await assertAssociationsBelongToOrganization({
			organizationId: scope.organizationId,
			campusId: input.data.campusId,
			interestedCourseId: input.data.interestedCourseId,
		});

		const { nextFollowAt, ...dataWithoutNextFollowAt } = input.data;
		const data: UpdateLeadRecordInput = {
			...dataWithoutNextFollowAt,
			...(nextFollowAt === undefined
				? {}
				: { nextFollowAt: nextFollowAt ? new Date(nextFollowAt) : null }),
		};
		const updated = await updateLeadRecord({
			organizationId: scope.organizationId,
			id: input.id,
			data,
		});

		if (!updated) {
			const latestStage = await findLeadStage({
				organizationId: scope.organizationId,
				id: input.id,
			});
			if (latestStage === "enrolled") {
				throw new ORPCError("CONFLICT", {
					message: "已报名线索不能修改。",
				});
			}
			throw new ORPCError("NOT_FOUND", { message: "线索不存在。" });
		}

		return toLeadRecord(updated);
	} catch (error) {
		if (error instanceof ORPCError) {
			throw error;
		}
		return throwDatabaseError(error);
	}
}
