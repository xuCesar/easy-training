import { and, eq, inArray, lte, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	operationTask,
	operationTaskHistory,
	operationTaskReminder,
	organizationMember,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { getCurrentOperationTaskWriteAccess } from "./operation-task-access";
import { createInAppNotification } from "./operations";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class OperationTaskError extends Error {
	constructor(
		public readonly code:
			| "MEMBER_FORBIDDEN"
			| "CAMPUS_OUT_OF_SCOPE"
			| "CAMPUS_INVALID"
			| "TASK_NOT_FOUND"
			| "TASK_VERSION_CONFLICT"
			| "TASK_STATE_CONFLICT",
	) {
		super(code);
	}
}

function canManageOthers(role: string) {
	return role === "owner" || role === "admin" || role === "campus_manager";
}

function canManageTask(input: {
	role: string;
	actorUserId: string;
	task: typeof operationTask.$inferSelect;
}) {
	return (
		canManageOthers(input.role) ||
		input.task.createdByUserId === input.actorUserId
	);
}

async function assertWritableCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusId: string | null;
		campusIds: string[] | null;
	},
) {
	if (!input.campusId) return;
	if (input.campusIds && !input.campusIds.includes(input.campusId)) {
		throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
	}
	const [record] = await tx
		.select({ id: campus.id })
		.from(campus)
		.where(
			and(
				eq(campus.id, input.campusId),
				eq(campus.organizationId, input.organizationId),
				eq(campus.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	if (!record) throw new OperationTaskError("CAMPUS_INVALID");
}

async function scheduleReminders(
	tx: Transaction,
	task: typeof operationTask.$inferSelect,
) {
	if (!task.ownerUserId || task.status !== "pending") return;
	const reminders: Array<{
		type: "before_due" | "due" | "overdue";
		scheduledAt: Date;
	}> = [
		{ type: "due", scheduledAt: task.dueAt },
		{
			type: "overdue",
			scheduledAt: new Date(task.dueAt.getTime() + 86_400_000),
		},
	];
	if (task.remindBeforeMinutes) {
		reminders.unshift({
			type: "before_due",
			scheduledAt: new Date(
				task.dueAt.getTime() - task.remindBeforeMinutes * 60_000,
			),
		});
	}
	await tx
		.insert(operationTaskReminder)
		.values(
			reminders.map((item) => ({
				organizationId: task.organizationId,
				taskId: task.id,
				taskVersion: task.version,
				recipientUserId: task.ownerUserId as string,
				type: item.type,
				scheduledAt: item.scheduledAt,
				dueAtSnapshot: task.dueAt,
				availableAt: item.scheduledAt,
			})),
		)
		.onConflictDoNothing();
}

async function cancelPendingReminders(tx: Transaction, taskId: string) {
	await tx
		.update(operationTaskReminder)
		.set({ status: "cancelled", cancelledAt: new Date() })
		.where(
			and(
				eq(operationTaskReminder.taskId, taskId),
				inArray(operationTaskReminder.status, ["pending", "leased"]),
			),
		);
}

async function getLockedTask(
	tx: Transaction,
	input: { organizationId: string; id: string },
) {
	const [task] = await tx
		.select()
		.from(operationTask)
		.where(
			and(
				eq(operationTask.id, input.id),
				eq(operationTask.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!task) throw new OperationTaskError("TASK_NOT_FOUND");
	return task;
}

async function getTaskWriteContext(
	tx: Transaction,
	input: { organizationId: string; actorUserId: string; taskId: string },
) {
	const access = await getCurrentOperationTaskWriteAccess(
		tx,
		{ organizationId: input.organizationId, userId: input.actorUserId },
		() => new OperationTaskError("MEMBER_FORBIDDEN"),
	);
	const task = await getLockedTask(tx, {
		organizationId: input.organizationId,
		id: input.taskId,
	});
	if (!task.campusId && access.role === "campus_manager") {
		throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
	}
	await assertWritableCampus(tx, {
		organizationId: input.organizationId,
		campusId: task.campusId,
		campusIds:
			access.campusAccess.kind === "selected"
				? access.campusAccess.campusIds
				: access.campusAccess.kind === "none"
					? []
					: null,
	});
	return { access, task };
}

function assertExpectedVersion(
	task: typeof operationTask.$inferSelect,
	version: number,
) {
	if (task.version !== version) {
		throw new OperationTaskError("TASK_VERSION_CONFLICT");
	}
}

async function appendHistory(
	tx: Transaction,
	input: {
		task: typeof operationTask.$inferSelect;
		action: (typeof operationTaskHistory.$inferInsert)["action"];
		fromStatus?: (typeof operationTask.$inferSelect)["status"];
		actorUserId: string;
	},
) {
	await tx.insert(operationTaskHistory).values({
		organizationId: input.task.organizationId,
		taskId: input.task.id,
		taskVersion: input.task.version,
		action: input.action,
		fromStatus: input.fromStatus,
		toStatus: input.task.status,
		actorUserId: input.actorUserId,
		ownerUserId: input.task.ownerUserId,
		dueAt: input.task.dueAt,
		remindBeforeMinutes: input.task.remindBeforeMinutes,
	});
}

async function updateTaskVersion(
	tx: Transaction,
	input: {
		task: typeof operationTask.$inferSelect;
		expectedVersion: number;
		values: Partial<typeof operationTask.$inferInsert>;
	},
) {
	const [task] = await tx
		.update(operationTask)
		.set({
			...input.values,
			version: sql`${operationTask.version} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(operationTask.id, input.task.id),
				eq(operationTask.organizationId, input.task.organizationId),
				eq(operationTask.version, input.expectedVersion),
			),
		)
		.returning();
	if (!task) throw new OperationTaskError("TASK_VERSION_CONFLICT");
	return task;
}

export async function createOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	campusId?: string | null;
	ownerUserId?: string | null;
	title: string;
	description?: string | null;
	module: (typeof operationTask.$inferInsert)["module"];
	priority: (typeof operationTask.$inferInsert)["priority"];
	dueAt: Date;
	remindBeforeMinutes?: number | null;
}) {
	return db.transaction(async (tx) => {
		const access = await getCurrentOperationTaskWriteAccess(
			tx,
			{ organizationId: input.organizationId, userId: input.actorUserId },
			() => new OperationTaskError("MEMBER_FORBIDDEN"),
		);
		const ownerUserId =
			input.ownerUserId === undefined ? input.actorUserId : input.ownerUserId;
		if (
			(ownerUserId !== input.actorUserId || ownerUserId === null) &&
			!canManageOthers(access.role)
		)
			throw new OperationTaskError("MEMBER_FORBIDDEN");
		if (!input.campusId && access.role === "campus_manager")
			throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusId: input.campusId ?? null,
			campusIds:
				access.campusAccess.kind === "selected"
					? access.campusAccess.campusIds
					: access.campusAccess.kind === "none"
						? []
						: null,
		});
		if (ownerUserId && ownerUserId !== input.actorUserId) {
			const [member] = await tx
				.select({ id: organizationMember.id })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, input.organizationId),
						eq(organizationMember.userId, ownerUserId),
					),
				)
				.limit(1)
				.for("update");
			if (!member) throw new OperationTaskError("MEMBER_FORBIDDEN");
		}
		const [task] = await tx
			.insert(operationTask)
			.values({
				...input,
				ownerUserId,
				createdByUserId: input.actorUserId,
				campusId: input.campusId ?? null,
				description: input.description ?? null,
				remindBeforeMinutes: input.remindBeforeMinutes ?? null,
			})
			.returning();
		if (!task) throw new OperationTaskError("TASK_NOT_FOUND");
		await tx.insert(operationTaskHistory).values({
			organizationId: task.organizationId,
			taskId: task.id,
			taskVersion: task.version,
			action: "created",
			toStatus: task.status,
			actorUserId: input.actorUserId,
			ownerUserId: task.ownerUserId,
			dueAt: task.dueAt,
			remindBeforeMinutes: task.remindBeforeMinutes,
		});
		await scheduleReminders(tx, task);
		if (task.ownerUserId && task.ownerUserId !== input.actorUserId)
			await createInAppNotification(tx, {
				organizationId: task.organizationId,
				recipientUserId: task.ownerUserId,
				campusId: task.campusId,
				type: "operation_task_assigned",
				title: "收到新的运营任务",
				body: task.title,
				entityType: "operation_task",
				entityId: task.id,
				idempotencyKey: `operation-task:${task.id}:v${task.version}:assigned`,
			});
		await writeOrganizationAuditEvent(tx, {
			organizationId: task.organizationId,
			action: "operation_task_created",
			entityType: "operation_task",
			entityId: task.id,
			actorUserId: input.actorUserId,
			campusId: task.campusId,
			after: {
				module: task.module,
				priority: task.priority,
				dueAt: task.dueAt,
				version: task.version,
				ownerUserId: task.ownerUserId,
			},
		});
		return task;
	});
}

export async function claimOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	expectedVersion: number;
}) {
	return db.transaction(async (tx) => {
		const { task } = await getTaskWriteContext(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			taskId: input.id,
		});
		assertExpectedVersion(task, input.expectedVersion);
		if (task.status !== "pending" || task.ownerUserId) {
			throw new OperationTaskError("TASK_STATE_CONFLICT");
		}
		const updatedTask = await updateTaskVersion(tx, {
			task,
			expectedVersion: input.expectedVersion,
			values: { ownerUserId: input.actorUserId },
		});
		await appendHistory(tx, {
			task: updatedTask,
			action: "claimed",
			fromStatus: task.status,
			actorUserId: input.actorUserId,
		});
		await scheduleReminders(tx, updatedTask);
		await writeOrganizationAuditEvent(tx, {
			organizationId: updatedTask.organizationId,
			action: "operation_task_claimed",
			entityType: "operation_task",
			entityId: updatedTask.id,
			actorUserId: input.actorUserId,
			campusId: updatedTask.campusId,
			after: { version: updatedTask.version, ownerUserId: input.actorUserId },
		});
		return updatedTask;
	});
}

export async function completeOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	expectedVersion: number;
}) {
	return db.transaction(async (tx) => {
		const { access, task } = await getTaskWriteContext(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			taskId: input.id,
		});
		assertExpectedVersion(task, input.expectedVersion);
		if (task.status !== "pending") {
			throw new OperationTaskError("TASK_STATE_CONFLICT");
		}
		if (
			task.ownerUserId !== input.actorUserId &&
			!canManageTask({
				role: access.role,
				actorUserId: input.actorUserId,
				task,
			})
		) {
			throw new OperationTaskError("MEMBER_FORBIDDEN");
		}
		const now = new Date();
		const updatedTask = await updateTaskVersion(tx, {
			task,
			expectedVersion: input.expectedVersion,
			values: {
				status: "completed",
				completedAt: now,
				completedByUserId: input.actorUserId,
			},
		});
		await appendHistory(tx, {
			task: updatedTask,
			action: "completed",
			fromStatus: task.status,
			actorUserId: input.actorUserId,
		});
		await cancelPendingReminders(tx, task.id);
		if (
			updatedTask.createdByUserId &&
			updatedTask.createdByUserId !== input.actorUserId
		) {
			await createInAppNotification(tx, {
				organizationId: updatedTask.organizationId,
				recipientUserId: updatedTask.createdByUserId,
				campusId: updatedTask.campusId,
				type: "operation_task_completed",
				title: "运营任务已完成",
				body: updatedTask.title,
				entityType: "operation_task",
				entityId: updatedTask.id,
				idempotencyKey: `operation-task:${updatedTask.id}:v${updatedTask.version}:completed`,
			});
		}
		await writeOrganizationAuditEvent(tx, {
			organizationId: updatedTask.organizationId,
			action: "operation_task_completed",
			entityType: "operation_task",
			entityId: updatedTask.id,
			actorUserId: input.actorUserId,
			campusId: updatedTask.campusId,
			after: { version: updatedTask.version, status: updatedTask.status },
		});
		return updatedTask;
	});
}

export async function reopenOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	expectedVersion: number;
}) {
	return db.transaction(async (tx) => {
		const { access, task } = await getTaskWriteContext(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			taskId: input.id,
		});
		assertExpectedVersion(task, input.expectedVersion);
		if (task.status !== "completed") {
			throw new OperationTaskError("TASK_STATE_CONFLICT");
		}
		if (
			!canManageTask({
				role: access.role,
				actorUserId: input.actorUserId,
				task,
			})
		) {
			throw new OperationTaskError("MEMBER_FORBIDDEN");
		}
		const updatedTask = await updateTaskVersion(tx, {
			task,
			expectedVersion: input.expectedVersion,
			values: {
				status: "pending",
				completedAt: null,
				completedByUserId: null,
			},
		});
		await appendHistory(tx, {
			task: updatedTask,
			action: "reopened",
			fromStatus: task.status,
			actorUserId: input.actorUserId,
		});
		await scheduleReminders(tx, updatedTask);
		await writeOrganizationAuditEvent(tx, {
			organizationId: updatedTask.organizationId,
			action: "operation_task_reopened",
			entityType: "operation_task",
			entityId: updatedTask.id,
			actorUserId: input.actorUserId,
			campusId: updatedTask.campusId,
			after: { version: updatedTask.version, status: updatedTask.status },
		});
		return updatedTask;
	});
}

export async function cancelOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	expectedVersion: number;
}) {
	return db.transaction(async (tx) => {
		const { access, task } = await getTaskWriteContext(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			taskId: input.id,
		});
		assertExpectedVersion(task, input.expectedVersion);
		if (task.status !== "pending") {
			throw new OperationTaskError("TASK_STATE_CONFLICT");
		}
		if (
			!canManageTask({
				role: access.role,
				actorUserId: input.actorUserId,
				task,
			})
		) {
			throw new OperationTaskError("MEMBER_FORBIDDEN");
		}
		const updatedTask = await updateTaskVersion(tx, {
			task,
			expectedVersion: input.expectedVersion,
			values: {
				status: "cancelled",
				cancelledAt: new Date(),
				cancelledByUserId: input.actorUserId,
			},
		});
		await appendHistory(tx, {
			task: updatedTask,
			action: "cancelled",
			fromStatus: task.status,
			actorUserId: input.actorUserId,
		});
		await cancelPendingReminders(tx, task.id);
		await writeOrganizationAuditEvent(tx, {
			organizationId: updatedTask.organizationId,
			action: "operation_task_cancelled",
			entityType: "operation_task",
			entityId: updatedTask.id,
			actorUserId: input.actorUserId,
			campusId: updatedTask.campusId,
			after: { version: updatedTask.version, status: updatedTask.status },
		});
		return updatedTask;
	});
}

const reminderTitles = {
	before_due: "运营任务即将到期",
	due: "运营任务已到期",
	overdue: "运营任务已逾期",
} as const;

/**
 * 领取并投递一批到期提醒。每条提醒的租约、站内通知和投递结果位于同一事务，
 * 多实例竞争时只有持有 leaseToken 的消费者能够结束投递。
 */
export async function processDueOperationTaskReminders(input?: {
	now?: Date;
	limit?: number;
}) {
	const now = input?.now ?? new Date();
	const limit = input?.limit ?? 50;
	let delivered = 0;
	for (let index = 0; index < limit; index += 1) {
		const processed = await db.transaction(async (tx) => {
			const [reminder] = await tx
				.select({
					reminder: operationTaskReminder,
					task: operationTask,
				})
				.from(operationTaskReminder)
				.innerJoin(
					operationTask,
					eq(operationTask.id, operationTaskReminder.taskId),
				)
				.where(
					and(
						or(
							and(
								eq(operationTaskReminder.status, "pending"),
								lte(operationTaskReminder.availableAt, now),
							),
							and(
								eq(operationTaskReminder.status, "leased"),
								lte(operationTaskReminder.leaseExpiresAt, now),
							),
						),
						eq(operationTask.status, "pending"),
					),
				)
				.orderBy(operationTaskReminder.scheduledAt, operationTaskReminder.id)
				.limit(1)
				.for("update", { skipLocked: true });
			if (!reminder) return false;
			const leaseToken = crypto.randomUUID();
			const [leased] = await tx
				.update(operationTaskReminder)
				.set({
					status: "leased",
					leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
					attemptCount: sql`${operationTaskReminder.attemptCount} + 1`,
				})
				.where(
					and(
						eq(operationTaskReminder.id, reminder.reminder.id),
						inArray(operationTaskReminder.status, ["pending", "leased"]),
					),
				)
				.returning({ id: operationTaskReminder.id });
			if (!leased) return false;
			await createInAppNotification(tx, {
				organizationId: reminder.reminder.organizationId,
				recipientUserId: reminder.reminder.recipientUserId,
				campusId: reminder.task.campusId,
				type: "operation_task_reminder",
				title: reminderTitles[reminder.reminder.type],
				body: reminder.task.title,
				entityType: "operation_task",
				entityId: reminder.task.id,
				idempotencyKey: `operation-task:${reminder.task.id}:v${reminder.reminder.taskVersion}:${reminder.reminder.type}`,
			});
			const [deliveredReminder] = await tx
				.update(operationTaskReminder)
				.set({
					status: "delivered",
					deliveredAt: now,
					leaseToken: null,
					leaseExpiresAt: null,
				})
				.where(
					and(
						eq(operationTaskReminder.id, reminder.reminder.id),
						eq(operationTaskReminder.leaseToken, leaseToken),
						eq(operationTaskReminder.status, "leased"),
					),
				)
				.returning({ id: operationTaskReminder.id });
			return Boolean(deliveredReminder);
		});
		if (!processed) break;
		delivered += 1;
	}
	return { delivered };
}
