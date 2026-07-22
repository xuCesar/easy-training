import {
	cancelOperationTask,
	claimOperationTask,
	completeOperationTask,
	createOperationTask,
	OperationTaskError,
	reopenOperationTask,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CreateOperationTaskInput,
	OperationTask,
	OperationTaskActionInput,
} from "../contracts/training";

type OperationTaskScope = {
	organizationId: string;
	userId: string;
};

function toOperationTask(
	record: Awaited<ReturnType<typeof createOperationTask>>,
): OperationTask {
	return {
		...record,
		dueAt: record.dueAt.toISOString(),
		completedAt: record.completedAt?.toISOString() ?? null,
		cancelledAt: record.cancelledAt?.toISOString() ?? null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function throwOperationTaskError(error: unknown): never {
	if (!(error instanceof OperationTaskError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理运营任务，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权操作该任务。" });
		case "CAMPUS_INVALID":
			throw new ORPCError("CONFLICT", { message: "任务所属校区不可用。" });
		case "TASK_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标任务不存在。" });
		case "TASK_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "任务已被其他成员更新，请刷新后重试。",
				data: { reason: "TASK_VERSION_CONFLICT" },
			});
		case "TASK_STATE_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "当前任务状态不支持此操作。",
				data: { reason: "TASK_STATE_CONFLICT" },
			});
	}
}

export async function createOperationTaskForOrganization(
	scope: OperationTaskScope,
	input: CreateOperationTaskInput,
): Promise<OperationTask> {
	try {
		return toOperationTask(
			await createOperationTask({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
				dueAt: new Date(input.dueAt),
			}),
		);
	} catch (error) {
		return throwOperationTaskError(error);
	}
}

async function mutateOperationTask(
	scope: OperationTaskScope,
	input: OperationTaskActionInput,
	action: (input: {
		organizationId: string;
		actorUserId: string;
		id: string;
		expectedVersion: number;
	}) => ReturnType<typeof claimOperationTask>,
): Promise<OperationTask> {
	try {
		return toOperationTask(
			await action({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwOperationTaskError(error);
	}
}

export function claimOperationTaskForOrganization(
	scope: OperationTaskScope,
	input: OperationTaskActionInput,
) {
	return mutateOperationTask(scope, input, claimOperationTask);
}

export function completeOperationTaskForOrganization(
	scope: OperationTaskScope,
	input: OperationTaskActionInput,
) {
	return mutateOperationTask(scope, input, completeOperationTask);
}

export function reopenOperationTaskForOrganization(
	scope: OperationTaskScope,
	input: OperationTaskActionInput,
) {
	return mutateOperationTask(scope, input, reopenOperationTask);
}

export function cancelOperationTaskForOrganization(
	scope: OperationTaskScope,
	input: OperationTaskActionInput,
) {
	return mutateOperationTask(scope, input, cancelOperationTask);
}
