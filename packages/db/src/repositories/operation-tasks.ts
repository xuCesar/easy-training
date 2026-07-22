import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNull,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	operationTask,
	operationTaskHistory,
	operationTaskReminder,
	organizationMember,
	organizationMemberCampus,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { getCurrentOperationTaskWriteAccess } from "./operation-task-access";
import { createInAppNotification } from "./operations";
import type { CampusAccess } from "./organization";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class OperationTaskError extends Error {
	constructor(
		public readonly code:
			| "INVALID_CURSOR"
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

function canAccessTaskModule(
	role: string,
	module: (typeof operationTask.$inferSelect)["module"],
) {
	if (canManageOthers(role)) return true;
	switch (role) {
		case "consultant":
			return module === "enrollment" || module === "student_service";
		case "finance":
			return module === "finance";
		case "teacher":
			return module === "academic";
		default:
			return false;
	}
}

async function assertAssignableOwner(
	tx: Transaction,
	input: {
		organizationId: string;
		ownerUserId: string;
		campusId: string | null;
		module: (typeof operationTask.$inferSelect)["module"];
	},
) {
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
				eq(organizationMember.userId, input.ownerUserId),
			),
		)
		.limit(1)
		.for("update");
	if (!member || !canAccessTaskModule(member.role, input.module)) {
		throw new OperationTaskError("MEMBER_FORBIDDEN");
	}
	if (!input.campusId) {
		if (
			member.role === "owner" ||
			member.role === "admin" ||
			member.campusAccessMode === "all"
		) {
			return;
		}
		throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
	}
	if (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	) {
		return;
	}
	const [scope] = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(
			and(
				eq(organizationMemberCampus.organizationMemberId, member.id),
				eq(organizationMemberCampus.campusId, input.campusId),
			),
		)
		.limit(1);
	if (!scope) throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
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
	if (!input.campusId) {
		if (input.campusIds !== null) {
			throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
		}
		return;
	}
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

function readCampusScope(campusAccess: CampusAccess) {
	if (campusAccess.kind === "all") return sql`true`;
	if (campusAccess.kind === "selected") {
		return inArray(operationTask.campusId, campusAccess.campusIds);
	}
	return sql`false`;
}

function readModuleScope(role: string) {
	if (canManageOthers(role)) return sql`true`;
	switch (role) {
		case "consultant":
			return inArray(operationTask.module, ["enrollment", "student_service"]);
		case "finance":
			return eq(operationTask.module, "finance");
		case "teacher":
			return eq(operationTask.module, "academic");
		default:
			return sql`false`;
	}
}

type OperationTaskCursor = {
	dueAt: Date;
	createdAt: Date;
	id: string;
};

function encodeOperationTaskCursor(task: typeof operationTask.$inferSelect) {
	return Buffer.from(
		JSON.stringify({
			dueAt: task.dueAt.toISOString(),
			createdAt: task.createdAt.toISOString(),
			id: task.id,
		}),
		"utf8",
	).toString("base64url");
}

function decodeOperationTaskCursor(
	value: string | undefined,
): OperationTaskCursor | undefined {
	if (!value) return undefined;
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("dueAt" in parsed) ||
			!("createdAt" in parsed) ||
			!("id" in parsed) ||
			typeof parsed.dueAt !== "string" ||
			typeof parsed.createdAt !== "string" ||
			typeof parsed.id !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				parsed.id,
			)
		) {
			throw new Error("Invalid operation task cursor.");
		}
		const dueAt = new Date(parsed.dueAt);
		const createdAt = new Date(parsed.createdAt);
		if (Number.isNaN(dueAt.getTime()) || Number.isNaN(createdAt.getTime())) {
			throw new Error("Invalid operation task cursor dates.");
		}
		return { dueAt, createdAt, id: parsed.id };
	} catch {
		throw new OperationTaskError("INVALID_CURSOR");
	}
}

export async function listOperationTasks(input: {
	organizationId: string;
	userId: string;
	role: string;
	campusAccess: CampusAccess;
	view: "mine" | "created" | "public" | "managed";
	status?: (typeof operationTask.$inferSelect)["status"];
	campusId?: string;
	module?: (typeof operationTask.$inferSelect)["module"];
	dueAtFrom?: Date;
	dueAtTo?: Date;
	keyword?: string;
	cursor?: string;
	limit: number;
}) {
	const cursor = decodeOperationTaskCursor(input.cursor);
	const filters = [
		eq(operationTask.organizationId, input.organizationId),
		readCampusScope(input.campusAccess),
		readModuleScope(input.role),
	];
	switch (input.view) {
		case "mine":
			filters.push(eq(operationTask.ownerUserId, input.userId));
			break;
		case "created":
			filters.push(eq(operationTask.createdByUserId, input.userId));
			break;
		case "public":
			filters.push(eq(operationTask.status, "pending"));
			filters.push(isNull(operationTask.ownerUserId));
			break;
		case "managed":
			if (!canManageOthers(input.role)) {
				throw new OperationTaskError("MEMBER_FORBIDDEN");
			}
			break;
	}
	if (input.status) filters.push(eq(operationTask.status, input.status));
	if (input.campusId) filters.push(eq(operationTask.campusId, input.campusId));
	if (input.module) filters.push(eq(operationTask.module, input.module));
	if (input.dueAtFrom) filters.push(gte(operationTask.dueAt, input.dueAtFrom));
	if (input.dueAtTo) filters.push(lte(operationTask.dueAt, input.dueAtTo));
	if (input.keyword)
		filters.push(ilike(operationTask.title, `%${input.keyword}%`));
	if (cursor) {
		const cursorFilter = or(
			gt(operationTask.dueAt, cursor.dueAt),
			and(
				eq(operationTask.dueAt, cursor.dueAt),
				lt(operationTask.createdAt, cursor.createdAt),
			),
			and(
				eq(operationTask.dueAt, cursor.dueAt),
				eq(operationTask.createdAt, cursor.createdAt),
				gt(operationTask.id, cursor.id),
			),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}
	const rows = await db
		.select({ task: operationTask, ownerName: user.name })
		.from(operationTask)
		.leftJoin(user, eq(user.id, operationTask.ownerUserId))
		.where(and(...filters))
		.orderBy(
			asc(operationTask.dueAt),
			desc(operationTask.createdAt),
			asc(operationTask.id),
		)
		.limit(input.limit + 1);
	const pageRows = rows.slice(0, input.limit);
	const lastRow = pageRows.at(-1);
	return {
		items: pageRows.map(({ task, ownerName }) => ({ ...task, ownerName })),
		nextCursor:
			rows.length > input.limit && lastRow
				? encodeOperationTaskCursor(lastRow.task)
				: null,
	};
}

export async function listOperationTaskAssignees(input: {
	organizationId: string;
	userId: string;
	role: string;
	campusAccess: CampusAccess;
	campusId?: string | null;
	module: (typeof operationTask.$inferSelect)["module"];
}) {
	if (
		input.campusId &&
		input.campusAccess.kind === "selected" &&
		!input.campusAccess.campusIds.includes(input.campusId)
	) {
		throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
	}
	if (input.campusId && input.campusAccess.kind === "none") {
		throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
	}
	const allowedRoles =
		input.module === "finance"
			? (["owner", "admin", "campus_manager", "finance"] as const)
			: input.module === "academic"
				? (["owner", "admin", "campus_manager", "teacher"] as const)
				: (["owner", "admin", "campus_manager", "consultant"] as const);
	const filters = [
		eq(organizationMember.organizationId, input.organizationId),
		inArray(organizationMember.role, allowedRoles),
	];
	if (!canManageOthers(input.role)) {
		filters.push(eq(organizationMember.userId, input.userId));
	}
	if (input.campusId) {
		filters.push(
			sql`(
				${organizationMember.role} in ('owner', 'admin')
				or ${organizationMember.campusAccessMode} = 'all'
				or exists (
					select 1 from ${organizationMemberCampus}
					where ${organizationMemberCampus.organizationMemberId} = ${organizationMember.id}
					and ${organizationMemberCampus.campusId} = ${input.campusId}
				)
			)`,
		);
	} else {
		filters.push(
			sql`(${organizationMember.role} in ('owner', 'admin') or ${organizationMember.campusAccessMode} = 'all')`,
		);
	}
	return db
		.select({
			userId: organizationMember.userId,
			name: user.name,
			role: organizationMember.role,
		})
		.from(organizationMember)
		.innerJoin(user, eq(user.id, organizationMember.userId))
		.where(and(...filters))
		.orderBy(asc(user.name), asc(organizationMember.userId));
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
		if (ownerUserId) {
			await assertAssignableOwner(tx, {
				organizationId: input.organizationId,
				ownerUserId,
				campusId: input.campusId ?? null,
				module: input.module,
			});
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

export async function updateOperationTask(input: {
	organizationId: string;
	actorUserId: string;
	id: string;
	expectedVersion: number;
	data: {
		campusId?: string | null;
		ownerUserId?: string | null;
		title?: string;
		description?: string | null;
		module?: (typeof operationTask.$inferSelect)["module"];
		priority?: (typeof operationTask.$inferSelect)["priority"];
		dueAt?: Date;
		remindBeforeMinutes?: number | null;
	};
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

		const nextCampusId =
			input.data.campusId === undefined ? task.campusId : input.data.campusId;
		const nextOwnerUserId =
			input.data.ownerUserId === undefined
				? task.ownerUserId
				: input.data.ownerUserId;
		const nextModule = input.data.module ?? task.module;
		const ownerChanged = nextOwnerUserId !== task.ownerUserId;
		if (
			ownerChanged &&
			(nextOwnerUserId === null || nextOwnerUserId !== input.actorUserId) &&
			!canManageOthers(access.role)
		) {
			throw new OperationTaskError("MEMBER_FORBIDDEN");
		}
		if (!nextCampusId && access.role === "campus_manager") {
			throw new OperationTaskError("CAMPUS_OUT_OF_SCOPE");
		}
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusId: nextCampusId,
			campusIds:
				access.campusAccess.kind === "selected"
					? access.campusAccess.campusIds
					: access.campusAccess.kind === "none"
						? []
						: null,
		});
		if (nextOwnerUserId) {
			await assertAssignableOwner(tx, {
				organizationId: input.organizationId,
				ownerUserId: nextOwnerUserId,
				campusId: nextCampusId,
				module: nextModule,
			});
		}

		const dueAtChanged =
			input.data.dueAt !== undefined &&
			input.data.dueAt.getTime() !== task.dueAt.getTime();
		const reminderChanged =
			input.data.remindBeforeMinutes !== undefined &&
			input.data.remindBeforeMinutes !== task.remindBeforeMinutes;
		const updatedTask = await updateTaskVersion(tx, {
			task,
			expectedVersion: input.expectedVersion,
			values: input.data,
		});
		const historyAction = ownerChanged
			? "reassigned"
			: dueAtChanged || reminderChanged
				? "rescheduled"
				: "updated";
		await appendHistory(tx, {
			task: updatedTask,
			action: historyAction,
			fromStatus: task.status,
			actorUserId: input.actorUserId,
		});
		if (ownerChanged || dueAtChanged || reminderChanged) {
			await cancelPendingReminders(tx, task.id);
			await scheduleReminders(tx, updatedTask);
		}
		if (
			ownerChanged &&
			updatedTask.ownerUserId &&
			updatedTask.ownerUserId !== input.actorUserId
		) {
			await createInAppNotification(tx, {
				organizationId: updatedTask.organizationId,
				recipientUserId: updatedTask.ownerUserId,
				campusId: updatedTask.campusId,
				type: "operation_task_assigned",
				title: "收到新的运营任务",
				body: updatedTask.title,
				entityType: "operation_task",
				entityId: updatedTask.id,
				idempotencyKey: `operation-task:${updatedTask.id}:v${updatedTask.version}:assigned`,
			});
		}
		await writeOrganizationAuditEvent(tx, {
			organizationId: updatedTask.organizationId,
			action: "operation_task_updated",
			entityType: "operation_task",
			entityId: updatedTask.id,
			actorUserId: input.actorUserId,
			campusId: updatedTask.campusId,
			before: {
				campusId: task.campusId,
				ownerUserId: task.ownerUserId,
				module: task.module,
				priority: task.priority,
				dueAt: task.dueAt,
				remindBeforeMinutes: task.remindBeforeMinutes,
				version: task.version,
			},
			after: {
				campusId: updatedTask.campusId,
				ownerUserId: updatedTask.ownerUserId,
				module: updatedTask.module,
				priority: updatedTask.priority,
				dueAt: updatedTask.dueAt,
				remindBeforeMinutes: updatedTask.remindBeforeMinutes,
				version: updatedTask.version,
			},
		});
		return updatedTask;
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
		await assertAssignableOwner(tx, {
			organizationId: input.organizationId,
			ownerUserId: input.actorUserId,
			campusId: task.campusId,
			module: task.module,
		});
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

const REMINDER_LEASE_MS = 60_000;
const REMINDER_RETRY_BASE_MS = 30_000;
const REMINDER_RETRY_MAX_MS = 30 * 60_000;
const REMINDER_MAX_ATTEMPTS = 5;

type ReminderDelivery = (
	tx: Transaction,
	input: Parameters<typeof createInAppNotification>[1],
) => Promise<void>;

function getReminderRetryAt(now: Date, attemptCount: number) {
	const delayMs = Math.min(
		REMINDER_RETRY_BASE_MS * 2 ** Math.max(attemptCount - 1, 0),
		REMINDER_RETRY_MAX_MS,
	);
	return new Date(now.getTime() + delayMs);
}

/**
 * 领取并投递一批到期提醒。租约先独立提交，投递失败会持久记录并按退避时间重试；
 * 站内通知与成功状态位于同一事务，幂等键保证进程重启后不会重复通知。
 */
export async function processDueOperationTaskReminders(input?: {
	now?: Date;
	limit?: number;
	deliver?: ReminderDelivery;
}) {
	const now = input?.now ?? new Date();
	const limit = input?.limit ?? 50;
	const deliver = input?.deliver ?? createInAppNotification;
	let delivered = 0;
	let retried = 0;
	let dead = 0;
	for (let index = 0; index < limit; index += 1) {
		const claim = await db.transaction(async (tx) => {
			const [reminder] = await tx
				.select()
				.from(operationTaskReminder)
				.where(
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
				)
				.orderBy(operationTaskReminder.scheduledAt, operationTaskReminder.id)
				.limit(1)
				.for("update", { skipLocked: true });
			if (!reminder) return null;
			const leaseToken = crypto.randomUUID();
			const [leased] = await tx
				.update(operationTaskReminder)
				.set({
					status: "leased",
					leaseToken,
					leaseExpiresAt: new Date(now.getTime() + REMINDER_LEASE_MS),
					attemptCount: sql`${operationTaskReminder.attemptCount} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						eq(operationTaskReminder.id, reminder.id),
						inArray(operationTaskReminder.status, ["pending", "leased"]),
					),
				)
				.returning({
					id: operationTaskReminder.id,
					attemptCount: operationTaskReminder.attemptCount,
				});
			return leased ? { ...reminder, ...leased, leaseToken } : null;
		});
		if (!claim) break;

		try {
			const processed = await db.transaction(async (tx) => {
				const [task] = await tx
					.select()
					.from(operationTask)
					.where(
						and(
							eq(operationTask.id, claim.taskId),
							eq(operationTask.organizationId, claim.organizationId),
							eq(operationTask.status, "pending"),
						),
					)
					.limit(1)
					.for("update");
				if (!task) {
					await tx
						.update(operationTaskReminder)
						.set({
							status: "cancelled",
							cancelledAt: now,
							leaseToken: null,
							leaseExpiresAt: null,
							updatedAt: now,
						})
						.where(
							and(
								eq(operationTaskReminder.id, claim.id),
								eq(operationTaskReminder.leaseToken, claim.leaseToken),
								eq(operationTaskReminder.status, "leased"),
							),
						);
					return false;
				}
				const [activeReminder] = await tx
					.select()
					.from(operationTaskReminder)
					.where(
						and(
							eq(operationTaskReminder.id, claim.id),
							eq(operationTaskReminder.leaseToken, claim.leaseToken),
							eq(operationTaskReminder.status, "leased"),
						),
					)
					.limit(1)
					.for("update");
				if (!activeReminder) return false;
				await deliver(tx, {
					organizationId: activeReminder.organizationId,
					recipientUserId: activeReminder.recipientUserId,
					campusId: task.campusId,
					type: "operation_task_reminder",
					title: reminderTitles[activeReminder.type],
					body: task.title,
					entityType: "operation_task",
					entityId: task.id,
					idempotencyKey: `operation-task:${task.id}:v${activeReminder.taskVersion}:${activeReminder.type}`,
				});
				const [deliveredReminder] = await tx
					.update(operationTaskReminder)
					.set({
						status: "delivered",
						deliveredAt: now,
						leaseToken: null,
						leaseExpiresAt: null,
						lastErrorCode: null,
						lastErrorMessage: null,
						updatedAt: now,
					})
					.where(
						and(
							eq(operationTaskReminder.id, activeReminder.id),
							eq(operationTaskReminder.leaseToken, claim.leaseToken),
							eq(operationTaskReminder.status, "leased"),
						),
					)
					.returning({ id: operationTaskReminder.id });
				return Boolean(deliveredReminder);
			});
			if (processed) delivered += 1;
		} catch {
			const reachedMaxAttempts = claim.attemptCount >= REMINDER_MAX_ATTEMPTS;
			const [failedReminder] = await db
				.update(operationTaskReminder)
				.set({
					status: reachedMaxAttempts ? "dead" : "pending",
					availableAt: reachedMaxAttempts
						? now
						: getReminderRetryAt(now, claim.attemptCount),
					leaseToken: null,
					leaseExpiresAt: null,
					lastErrorCode: "DELIVERY_FAILED",
					lastErrorMessage: "Unexpected reminder delivery error",
					updatedAt: now,
				})
				.where(
					and(
						eq(operationTaskReminder.id, claim.id),
						eq(operationTaskReminder.leaseToken, claim.leaseToken),
						eq(operationTaskReminder.status, "leased"),
					),
				)
				.returning({ status: operationTaskReminder.status });
			if (failedReminder?.status === "dead") dead += 1;
			else if (failedReminder?.status === "pending") retried += 1;
		}
	}
	return { delivered, retried, dead };
}
