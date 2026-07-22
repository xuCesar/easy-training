import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	completeOperationTask,
	createOperationTask,
	listOperationTasks,
	OperationTaskError,
	processDueOperationTaskReminders,
	updateOperationTask,
} from "../src/repositories/operation-tasks";
import {
	campus,
	operationTask,
	operationTaskHistory,
	operationTaskReminder,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	organizationNotification,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `operation-task-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		otherOrganizationId: randomUUID(),
		campusId: randomUUID(),
		otherCampusId: randomUUID(),
		ownerId: `${prefix}-owner`,
		consultantId: `${prefix}-consultant`,
		financeId: `${prefix}-finance`,
		otherOwnerId: `${prefix}-other-owner`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

async function seedFixture(ids: FixtureIds) {
	await db.insert(user).values([
		{
			id: ids.ownerId,
			name: "机构负责人",
			email: `${ids.ownerId}@test.invalid`,
		},
		{
			id: ids.consultantId,
			name: "招生顾问",
			email: `${ids.consultantId}@test.invalid`,
		},
		{ id: ids.financeId, name: "财务", email: `${ids.financeId}@test.invalid` },
		{
			id: ids.otherOwnerId,
			name: "其他机构负责人",
			email: `${ids.otherOwnerId}@test.invalid`,
		},
	]);
	await db.insert(organization).values([
		{ id: ids.organizationId, name: `${ids.prefix} 机构` },
		{ id: ids.otherOrganizationId, name: `${ids.prefix} 其他机构` },
	]);
	const members = await db
		.insert(organizationMember)
		.values([
			{
				organizationId: ids.organizationId,
				userId: ids.ownerId,
				role: "owner",
			},
			{
				organizationId: ids.organizationId,
				userId: ids.consultantId,
				role: "consultant",
				campusAccessMode: "selected",
			},
			{
				organizationId: ids.organizationId,
				userId: ids.financeId,
				role: "finance",
				campusAccessMode: "selected",
			},
			{
				organizationId: ids.otherOrganizationId,
				userId: ids.otherOwnerId,
				role: "owner",
			},
		])
		.returning({
			id: organizationMember.id,
			userId: organizationMember.userId,
		});
	await db.insert(campus).values([
		{
			id: ids.campusId,
			organizationId: ids.organizationId,
			code: `${ids.prefix}-main`,
			name: "主校区",
			city: "上海",
			address: "测试地址",
		},
		{
			id: ids.otherCampusId,
			organizationId: ids.otherOrganizationId,
			code: `${ids.prefix}-other`,
			name: "其他校区",
			city: "上海",
			address: "其他地址",
		},
	]);
	const scopedMemberIds = members
		.filter(
			(member) =>
				member.userId === ids.consultantId || member.userId === ids.financeId,
		)
		.map((member) => member.id);
	await db.insert(organizationMemberCampus).values(
		scopedMemberIds.map((organizationMemberId) => ({
			organizationMemberId,
			campusId: ids.campusId,
		})),
	);
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationId, ids.otherOrganizationId];
	await db
		.delete(organizationNotification)
		.where(inArray(organizationNotification.organizationId, organizationIds));
	await db
		.delete(organizationAuditEvent)
		.where(inArray(organizationAuditEvent.organizationId, organizationIds));
	await db
		.delete(operationTask)
		.where(inArray(operationTask.organizationId, organizationIds));
	await db
		.delete(organizationMemberCampus)
		.where(
			inArray(organizationMemberCampus.campusId, [
				ids.campusId,
				ids.otherCampusId,
			]),
		);
	await db
		.delete(campus)
		.where(inArray(campus.organizationId, organizationIds));
	await db
		.delete(organizationMember)
		.where(inArray(organizationMember.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db
		.delete(user)
		.where(
			inArray(user.id, [
				ids.ownerId,
				ids.consultantId,
				ids.financeId,
				ids.otherOwnerId,
			]),
		);
}

async function expectTaskError(
	promise: Promise<unknown>,
	code: OperationTaskError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof OperationTaskError);
		assert.equal(error.code, code);
		return true;
	});
}

test("运营任务保持角色、校区、版本、历史和提醒一致", async () => {
	const ids = createFixtureIds();
	await seedFixture(ids);
	try {
		const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
		const personalTask = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.consultantId,
			campusId: ids.campusId,
			title: "跟进试听学员",
			description: "只保存在任务正文",
			module: "enrollment",
			priority: "high",
			dueAt,
			remindBeforeMinutes: 60,
		});
		assert.equal(personalTask.ownerUserId, ids.consultantId);
		assert.equal(personalTask.version, 1);

		const reminders = await db
			.select()
			.from(operationTaskReminder)
			.where(eq(operationTaskReminder.taskId, personalTask.id));
		assert.equal(reminders.length, 3);

		const mine = await listOperationTasks({
			organizationId: ids.organizationId,
			userId: ids.consultantId,
			role: "consultant",
			campusAccess: { kind: "selected", campusIds: [ids.campusId] },
			view: "mine",
			limit: 30,
		});
		assert.deepEqual(
			mine.items.map((task) => task.id),
			[personalTask.id],
		);
		assert.equal(mine.items[0]?.ownerName, "招生顾问");

		const laterTask = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.consultantId,
			campusId: ids.campusId,
			title: "准备试听回访",
			module: "student_service",
			priority: "medium",
			dueAt: new Date(dueAt.getTime() + 30 * 60 * 1000),
		});
		const firstPage = await listOperationTasks({
			organizationId: ids.organizationId,
			userId: ids.consultantId,
			role: "consultant",
			campusAccess: { kind: "selected", campusIds: [ids.campusId] },
			view: "mine",
			limit: 1,
		});
		assert.equal(firstPage.items[0]?.id, personalTask.id);
		assert.ok(firstPage.nextCursor);
		const secondPage = await listOperationTasks({
			organizationId: ids.organizationId,
			userId: ids.consultantId,
			role: "consultant",
			campusAccess: { kind: "selected", campusIds: [ids.campusId] },
			view: "mine",
			cursor: firstPage.nextCursor ?? undefined,
			limit: 1,
		});
		assert.equal(secondPage.items[0]?.id, laterTask.id);
		assert.equal(secondPage.nextCursor, null);
		await expectTaskError(
			listOperationTasks({
				organizationId: ids.organizationId,
				userId: ids.consultantId,
				role: "consultant",
				campusAccess: { kind: "selected", campusIds: [ids.campusId] },
				view: "mine",
				cursor: "invalid-cursor",
				limit: 1,
			}),
			"INVALID_CURSOR",
		);

		const financePublicTask = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.ownerId,
			ownerUserId: null,
			campusId: ids.campusId,
			title: "公共财务任务",
			module: "finance",
			priority: "medium",
			dueAt,
		});
		const consultantPublic = await listOperationTasks({
			organizationId: ids.organizationId,
			userId: ids.consultantId,
			role: "consultant",
			campusAccess: { kind: "selected", campusIds: [ids.campusId] },
			view: "public",
			limit: 30,
		});
		assert.equal(
			consultantPublic.items.some((task) => task.id === financePublicTask.id),
			false,
		);

		await expectTaskError(
			createOperationTask({
				organizationId: ids.organizationId,
				actorUserId: ids.consultantId,
				campusId: ids.campusId,
				ownerUserId: ids.financeId,
				title: "越权派单",
				module: "finance",
				priority: "medium",
				dueAt,
			}),
			"MEMBER_FORBIDDEN",
		);
		await expectTaskError(
			createOperationTask({
				organizationId: ids.organizationId,
				actorUserId: ids.consultantId,
				campusId: null,
				title: "越过校区范围",
				module: "enrollment",
				priority: "medium",
				dueAt,
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);

		const rescheduledAt = new Date(dueAt.getTime() + 60 * 60 * 1000);
		const updated = await updateOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.consultantId,
			id: personalTask.id,
			expectedVersion: personalTask.version,
			data: { dueAt: rescheduledAt, remindBeforeMinutes: 15 },
		});
		assert.equal(updated.version, 2);
		assert.equal(updated.dueAt.toISOString(), rescheduledAt.toISOString());

		await expectTaskError(
			updateOperationTask({
				organizationId: ids.organizationId,
				actorUserId: ids.consultantId,
				id: personalTask.id,
				expectedVersion: personalTask.version,
				data: { title: "陈旧版本覆盖" },
			}),
			"TASK_VERSION_CONFLICT",
		);

		const reminderRows = await db
			.select({
				taskVersion: operationTaskReminder.taskVersion,
				status: operationTaskReminder.status,
			})
			.from(operationTaskReminder)
			.where(eq(operationTaskReminder.taskId, personalTask.id));
		assert.equal(
			reminderRows
				.filter((item) => item.taskVersion === 1)
				.every((item) => item.status === "cancelled"),
			true,
		);
		assert.equal(
			reminderRows.filter(
				(item) => item.taskVersion === 2 && item.status === "pending",
			).length,
			3,
		);
		const history = await db
			.select({ action: operationTaskHistory.action })
			.from(operationTaskHistory)
			.where(eq(operationTaskHistory.taskId, personalTask.id));
		assert.deepEqual(
			history.map((item) => item.action),
			["created", "rescheduled"],
		);

		const [audit] = await db
			.select({
				before: organizationAuditEvent.before,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.entityId, personalTask.id),
					eq(organizationAuditEvent.action, "operation_task_updated"),
				),
			);
		assert.equal(JSON.stringify(audit).includes("只保存在任务正文"), false);
	} finally {
		await cleanupFixture(ids);
	}
});

test("提醒消费者并发投递不重复，完成后撤销剩余提醒", async () => {
	const ids = createFixtureIds();
	await seedFixture(ids);
	try {
		const now = new Date();
		const task = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.ownerId,
			ownerUserId: ids.financeId,
			campusId: ids.campusId,
			title: "核对今日收款",
			module: "finance",
			priority: "high",
			dueAt: new Date(now.getTime() - 1_000),
		});
		const results = await Promise.all([
			processDueOperationTaskReminders({ now, limit: 1 }),
			processDueOperationTaskReminders({ now, limit: 1 }),
		]);
		assert.equal(
			results.reduce((sum, item) => sum + item.delivered, 0),
			1,
		);

		const reminderNotifications = await db
			.select({ id: organizationNotification.id })
			.from(organizationNotification)
			.where(
				and(
					eq(organizationNotification.entityId, task.id),
					eq(organizationNotification.type, "operation_task_reminder"),
				),
			);
		assert.equal(reminderNotifications.length, 1);

		const completed = await completeOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.financeId,
			id: task.id,
			expectedVersion: task.version,
		});
		assert.equal(completed.status, "completed");
		const remaining = await db
			.select({ status: operationTaskReminder.status })
			.from(operationTaskReminder)
			.where(eq(operationTaskReminder.taskId, task.id));
		assert.equal(
			remaining.some((item) => item.status === "pending"),
			false,
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("提醒投递失败会退避重试并在达到上限后进入死信", async () => {
	const ids = createFixtureIds();
	await seedFixture(ids);
	try {
		const firstAttemptAt = new Date();
		const retryTask = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.ownerId,
			ownerUserId: ids.financeId,
			campusId: ids.campusId,
			title: "提醒重试任务",
			module: "finance",
			priority: "high",
			dueAt: new Date(firstAttemptAt.getTime() - 1_000),
		});
		const firstFailure = await processDueOperationTaskReminders({
			now: firstAttemptAt,
			limit: 1,
			deliver: async () => {
				throw new Error("transient notification error");
			},
		});
		assert.deepEqual(firstFailure, { delivered: 0, retried: 1, dead: 0 });
		const [failedReminder] = await db
			.select()
			.from(operationTaskReminder)
			.where(
				and(
					eq(operationTaskReminder.taskId, retryTask.id),
					eq(operationTaskReminder.type, "due"),
				),
			);
		assert.equal(failedReminder?.status, "pending");
		assert.equal(failedReminder?.attemptCount, 1);
		assert.equal(failedReminder?.lastErrorCode, "DELIVERY_FAILED");
		assert.equal(
			failedReminder?.lastErrorMessage,
			"Unexpected reminder delivery error",
		);
		assert.equal(
			failedReminder?.availableAt.getTime(),
			firstAttemptAt.getTime() + 30_000,
		);

		const retrySuccess = await processDueOperationTaskReminders({
			now: new Date((failedReminder?.availableAt.getTime() ?? 0) + 1),
			limit: 1,
		});
		assert.deepEqual(retrySuccess, { delivered: 1, retried: 0, dead: 0 });
		const [deliveredReminder] = await db
			.select()
			.from(operationTaskReminder)
			.where(eq(operationTaskReminder.id, failedReminder?.id ?? randomUUID()));
		assert.equal(deliveredReminder?.status, "delivered");
		assert.equal(deliveredReminder?.attemptCount, 2);
		assert.equal(deliveredReminder?.lastErrorCode, null);

		const deadTask = await createOperationTask({
			organizationId: ids.organizationId,
			actorUserId: ids.ownerId,
			ownerUserId: ids.financeId,
			campusId: ids.campusId,
			title: "提醒死信任务",
			module: "finance",
			priority: "high",
			dueAt: new Date(firstAttemptAt.getTime() - 500),
		});
		let attemptAt = firstAttemptAt;
		for (let attempt = 1; attempt <= 5; attempt += 1) {
			const result = await processDueOperationTaskReminders({
				now: attemptAt,
				limit: 1,
				deliver: async () => {
					throw new Error("persistent notification error");
				},
			});
			assert.deepEqual(result, {
				delivered: 0,
				retried: attempt < 5 ? 1 : 0,
				dead: attempt === 5 ? 1 : 0,
			});
			const [currentReminder] = await db
				.select()
				.from(operationTaskReminder)
				.where(
					and(
						eq(operationTaskReminder.taskId, deadTask.id),
						eq(operationTaskReminder.type, "due"),
					),
				);
			attemptAt = new Date(currentReminder?.availableAt.getTime() ?? 0);
		}
		const [deadReminder] = await db
			.select()
			.from(operationTaskReminder)
			.where(
				and(
					eq(operationTaskReminder.taskId, deadTask.id),
					eq(operationTaskReminder.type, "due"),
				),
			);
		assert.equal(deadReminder?.status, "dead");
		assert.equal(deadReminder?.attemptCount, 5);
	} finally {
		await cleanupFixture(ids);
	}
});
