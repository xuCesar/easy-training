import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, eq, inArray } from "drizzle-orm";
import {
	commitStudentBulkOperationRecord,
	db,
	previewStudentBulkOperationRecord,
	StudentBulkOperationError,
} from "../src";
import {
	campus,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	student,
	studentBulkOperationBatch,
	studentOwnerAssignmentEvent,
	studentTag,
	studentTagAssignment,
	user,
} from "../src/schema";

function createIds() {
	const prefix = `student-bulk-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusA: randomUUID(),
		campusB: randomUUID(),
		actorUserId: `${prefix}-actor`,
		ownerAUserId: `${prefix}-owner-a`,
		ownerBUserId: `${prefix}-owner-b`,
		studentA1: randomUUID(),
		studentA2: randomUUID(),
		studentB: randomUUID(),
		tagId: randomUUID(),
		inactiveTagId: randomUUID(),
	};
}

type Ids = ReturnType<typeof createIds>;

async function seed(ids: Ids) {
	await db.insert(organization).values({
		id: ids.organizationId,
		name: ids.prefix,
	});
	await db.insert(user).values([
		{
			id: ids.actorUserId,
			name: "批量操作管理员",
			email: `${ids.actorUserId}@example.invalid`,
		},
		{
			id: ids.ownerAUserId,
			name: "A 校区顾问",
			email: `${ids.ownerAUserId}@example.invalid`,
		},
		{
			id: ids.ownerBUserId,
			name: "B 校区顾问",
			email: `${ids.ownerBUserId}@example.invalid`,
		},
	]);
	const members = await db
		.insert(organizationMember)
		.values([
			{
				organizationId: ids.organizationId,
				userId: ids.actorUserId,
				role: "admin",
				campusAccessMode: "all",
			},
			{
				organizationId: ids.organizationId,
				userId: ids.ownerAUserId,
				role: "consultant",
				campusAccessMode: "selected",
			},
			{
				organizationId: ids.organizationId,
				userId: ids.ownerBUserId,
				role: "consultant",
				campusAccessMode: "selected",
			},
		])
		.returning({
			id: organizationMember.id,
			userId: organizationMember.userId,
		});
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationId,
			code: `${ids.prefix.slice(-8)}-A`,
			name: "批量 A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationId,
			code: `${ids.prefix.slice(-8)}-B`,
			name: "批量 B 校区",
			city: "上海",
			address: "B",
		},
	]);
	const memberByUserId = new Map(members.map((item) => [item.userId, item.id]));
	await db.insert(organizationMemberCampus).values([
		{
			organizationMemberId: memberByUserId.get(ids.ownerAUserId) ?? "",
			campusId: ids.campusA,
		},
		{
			organizationMemberId: memberByUserId.get(ids.ownerBUserId) ?? "",
			campusId: ids.campusB,
		},
	]);
	await db.insert(student).values([
		{
			id: ids.studentA1,
			organizationId: ids.organizationId,
			campusId: ids.campusA,
			name: "批量学员 A1",
			guardianName: "A1 家长",
			guardianPhone: "13600136001",
		},
		{
			id: ids.studentA2,
			organizationId: ids.organizationId,
			campusId: ids.campusA,
			name: "批量学员 A2",
			guardianName: "A2 家长",
			guardianPhone: "13600136002",
		},
		{
			id: ids.studentB,
			organizationId: ids.organizationId,
			campusId: ids.campusB,
			name: "批量学员 B",
			guardianName: "B 家长",
			guardianPhone: "13600136003",
		},
	]);
	await db.insert(studentTag).values([
		{
			id: ids.tagId,
			organizationId: ids.organizationId,
			name: "重点学员",
			nameNormalized: "重点学员",
		},
		{
			id: ids.inactiveTagId,
			organizationId: ids.organizationId,
			name: "停用标签",
			nameNormalized: "停用标签",
			isActive: false,
		},
	]);
}

async function cleanup(ids: Ids) {
	await db.delete(organization).where(eq(organization.id, ids.organizationId));
	await db
		.delete(user)
		.where(
			inArray(user.id, [ids.actorUserId, ids.ownerAUserId, ids.ownerBUserId]),
		);
}

test("负责人和标签批量调整按版本原子提交、重放并保留批次历史", async () => {
	const ids = createIds();
	const scope = { organizationId: ids.organizationId, userId: ids.actorUserId };
	try {
		await seed(ids);
		const ownerInput = {
			...scope,
			kind: "setStudentOwner" as const,
			targets: [
				{ studentId: ids.studentA1, expectedVersion: 1 },
				{ studentId: ids.studentA2, expectedVersion: 1 },
			],
			ownerUserId: ids.ownerAUserId,
		};
		const ownerPreview = await previewStudentBulkOperationRecord(ownerInput);
		assert.deepEqual(
			{
				changeCount: ownerPreview.changeCount,
				noChangeCount: ownerPreview.noChangeCount,
				blockedCount: ownerPreview.blockedCount,
			},
			{ changeCount: 2, noChangeCount: 0, blockedCount: 0 },
		);
		const ownerRequestId = randomUUID();
		const ownerResult = await commitStudentBulkOperationRecord({
			...ownerInput,
			requestId: ownerRequestId,
		});
		assert.deepEqual(
			await commitStudentBulkOperationRecord({
				...ownerInput,
				requestId: ownerRequestId,
			}),
			{ ...ownerResult, replayed: true },
		);
		await assert.rejects(
			commitStudentBulkOperationRecord({
				...scope,
				kind: "clearStudentOwner",
				targets: ownerInput.targets,
				requestId: ownerRequestId,
			}),
			(error: unknown) => {
				assert.ok(error instanceof StudentBulkOperationError);
				assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
				return true;
			},
		);

		await db.insert(studentTagAssignment).values({
			studentId: ids.studentA1,
			studentTagId: ids.tagId,
		});
		const tagInput = {
			...scope,
			kind: "addStudentTag" as const,
			targets: [
				{ studentId: ids.studentA1, expectedVersion: 2 },
				{ studentId: ids.studentA2, expectedVersion: 2 },
			],
			tagId: ids.tagId,
		};
		const tagPreview = await previewStudentBulkOperationRecord(tagInput);
		assert.deepEqual(
			tagPreview.items
				.map((item) => [item.studentId, item.status])
				.sort(([left], [right]) => String(left).localeCompare(String(right))),
			[
				[ids.studentA1, "no_change"],
				[ids.studentA2, "change"],
			].sort(([left], [right]) => String(left).localeCompare(String(right))),
		);
		await commitStudentBulkOperationRecord({
			...tagInput,
			requestId: randomUUID(),
		});

		const [students, ownerEvents, batches, audits] = await Promise.all([
			db
				.select({
					id: student.id,
					ownerUserId: student.ownerUserId,
					version: student.version,
				})
				.from(student)
				.where(inArray(student.id, [ids.studentA1, ids.studentA2]))
				.orderBy(student.id),
			db
				.select({ batchId: studentOwnerAssignmentEvent.batchId })
				.from(studentOwnerAssignmentEvent)
				.where(eq(studentOwnerAssignmentEvent.source, "bulk")),
			db
				.select({ id: studentBulkOperationBatch.id })
				.from(studentBulkOperationBatch)
				.where(
					eq(studentBulkOperationBatch.organizationId, ids.organizationId),
				),
			db
				.select({ action: organizationAuditEvent.action })
				.from(organizationAuditEvent)
				.where(
					and(
						eq(organizationAuditEvent.organizationId, ids.organizationId),
						eq(organizationAuditEvent.action, "students_bulk_updated"),
					),
				),
		]);
		const studentById = new Map(students.map((item) => [item.id, item]));
		assert.deepEqual(studentById.get(ids.studentA1), {
			id: ids.studentA1,
			ownerUserId: ids.ownerAUserId,
			version: 2,
		});
		assert.deepEqual(studentById.get(ids.studentA2), {
			id: ids.studentA2,
			ownerUserId: ids.ownerAUserId,
			version: 3,
		});
		assert.equal(ownerEvents.length, 2);
		assert.ok(
			ownerEvents.every((event) => event.batchId === ownerResult.batchId),
		);
		assert.equal(batches.length, 2);
		assert.equal(audits.length, 2);
	} finally {
		await cleanup(ids);
	}
});

test("批量调整遇到陈旧版本、越权负责人或非管理角色时整批不写入", async () => {
	const ids = createIds();
	const scope = { organizationId: ids.organizationId, userId: ids.actorUserId };
	try {
		await seed(ids);
		await db
			.update(student)
			.set({ ownerUserId: ids.ownerAUserId, version: 2 })
			.where(inArray(student.id, [ids.studentA1, ids.studentA2]));
		const invalidOwnerPreview = await previewStudentBulkOperationRecord({
			...scope,
			kind: "setStudentOwner",
			targets: [{ studentId: ids.studentA1, expectedVersion: 2 }],
			ownerUserId: ids.ownerBUserId,
		});
		assert.equal(
			invalidOwnerPreview.items[0]?.blockerCode,
			"STUDENT_OWNER_NOT_ELIGIBLE",
		);

		const staleInput = {
			...scope,
			kind: "clearStudentOwner" as const,
			targets: [
				{ studentId: ids.studentA1, expectedVersion: 2 },
				{ studentId: ids.studentA2, expectedVersion: 1 },
			],
			requestId: randomUUID(),
		};
		await assert.rejects(
			commitStudentBulkOperationRecord(staleInput),
			(error: unknown) => {
				assert.ok(error instanceof StudentBulkOperationError);
				assert.equal(error.code, "BULK_BLOCKED");
				assert.ok(
					error.items.some(
						(item) => item.blockerCode === "STUDENT_VERSION_CONFLICT",
					),
				);
				return true;
			},
		);
		const unchanged = await db
			.select({ ownerUserId: student.ownerUserId, version: student.version })
			.from(student)
			.where(inArray(student.id, [ids.studentA1, ids.studentA2]));
		assert.ok(
			unchanged.every(
				(item) => item.ownerUserId === ids.ownerAUserId && item.version === 2,
			),
		);
		assert.equal(
			(
				await db
					.select({ id: studentBulkOperationBatch.id })
					.from(studentBulkOperationBatch)
					.where(
						eq(studentBulkOperationBatch.organizationId, ids.organizationId),
					)
			).length,
			0,
		);

		await assert.rejects(
			previewStudentBulkOperationRecord({
				organizationId: ids.organizationId,
				userId: ids.ownerAUserId,
				kind: "clearStudentOwner",
				targets: [{ studentId: ids.studentA1, expectedVersion: 2 }],
			}),
			(error: unknown) => {
				assert.ok(error instanceof StudentBulkOperationError);
				assert.equal(error.code, "MEMBER_FORBIDDEN");
				return true;
			},
		);
	} finally {
		await cleanup(ids);
	}
});
