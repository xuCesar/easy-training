import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createRouterClient } from "../../api/node_modules/@orpc/server/dist/index.mjs";
import type { Context } from "../../api/src/context";
import { appRouter } from "../../api/src/routers";
import { db } from "../src";
import { convertLeadRecord } from "../src/repositories/enrollment-conversion";
import {
	getStudentMergePreviewRecord,
	mergeStudentRecords,
} from "../src/repositories/student-merge";
import { listStudentTimelineRecords } from "../src/repositories/student-timeline";
import {
	createStudentRecord,
	createStudentTagRecord,
	findDuplicateStudentCandidates,
	getStudentRecord,
	listStudentOwnerCandidateRecords,
	listStudentRecords,
	renameStudentTagRecord,
	StudentRepositoryError,
	setStudentTagActiveRecord,
	updateStudentRecord,
} from "../src/repositories/students";
import {
	attendance,
	campus,
	classGroup,
	course,
	enrollment,
	invoice,
	lead,
	lesson,
	lessonConsumption,
	organization,
	organizationAuditEvent,
	organizationMember,
	organizationMemberCampus,
	payment,
	session,
	student,
	studentContact,
	studentOwnerAssignmentEvent,
	studentStatusEvent,
	teacher,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `students-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA: randomUUID(),
		campusAOther: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		leadConversion: randomUUID(),
		managerUserId: `${prefix}-manager`,
		operatorUserId: `${prefix}-operator`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function sessionId(userId: string) {
	return `${userId}-session`;
}

function createSessionClient(
	userId: string,
	name: string,
	expectedOrganizationId: string,
) {
	return createRouterClient(appRouter, {
		context: {
			auth: null,
			session: {
				session: { id: sessionId(userId) },
				user: { id: userId, name },
			},
			expectedOrganizationId,
		} as unknown as Context,
	});
}

async function expectStudentError(
	promise: Promise<unknown>,
	code: StudentRepositoryError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof StudentRepositoryError);
		assert.equal(error.code, code);
		return true;
	});
}

async function expectOrpcError(
	promise: Promise<unknown>,
	code: string,
	reason?: string,
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(typeof error === "object" && error !== null && "code" in error);
		assert.equal(error.code, code);
		if (reason) {
			assert.ok(
				"data" in error &&
					typeof error.data === "object" &&
					error.data !== null &&
					"reason" in error.data,
			);
			assert.equal(error.data.reason, reason);
		}
		return true;
	});
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	await db
		.delete(lessonConsumption)
		.where(inArray(lessonConsumption.organizationId, organizationIds));
	await db
		.delete(attendance)
		.where(
			inArray(
				attendance.lessonId,
				db
					.select({ id: lesson.id })
					.from(lesson)
					.where(inArray(lesson.organizationId, organizationIds)),
			),
		);
	await db
		.delete(payment)
		.where(inArray(payment.organizationId, organizationIds));
	await db
		.delete(studentStatusEvent)
		.where(inArray(studentStatusEvent.organizationId, organizationIds));
	await db
		.delete(invoice)
		.where(inArray(invoice.organizationId, organizationIds));
	await db
		.delete(enrollment)
		.where(inArray(enrollment.organizationId, organizationIds));
	await db
		.delete(lesson)
		.where(inArray(lesson.organizationId, organizationIds));
	await db
		.delete(classGroup)
		.where(inArray(classGroup.organizationId, organizationIds));
	await db
		.delete(teacher)
		.where(inArray(teacher.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db
		.delete(session)
		.where(inArray(session.userId, [ids.managerUserId, ids.operatorUserId]));
	await db
		.delete(user)
		.where(inArray(user.id, [ids.managerUserId, ids.operatorUserId]));
}

async function seedFixture(ids: FixtureIds) {
	const now = new Date();
	await db.insert(organization).values([
		{ id: ids.organizationA, name: `${ids.prefix} A` },
		{ id: ids.organizationB, name: `${ids.prefix} B` },
	]);
	await db.insert(user).values([
		{
			id: ids.managerUserId,
			name: "学员测试管理员",
			email: `${ids.managerUserId}@example.invalid`,
		},
		{
			id: ids.operatorUserId,
			name: "学员测试操作人",
			email: `${ids.operatorUserId}@example.invalid`,
		},
	]);
	await db.insert(session).values([
		{
			id: sessionId(ids.managerUserId),
			token: `${sessionId(ids.managerUserId)}-token`,
			userId: ids.managerUserId,
			expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
			updatedAt: now,
		},
		{
			id: sessionId(ids.operatorUserId),
			token: `${sessionId(ids.operatorUserId)}-token`,
			userId: ids.operatorUserId,
			expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
			updatedAt: now,
		},
	]);
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a`,
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusAOther,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a-other`,
			name: "A 第二校区",
			city: "上海",
			address: "A2",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationB,
			code: `${ids.prefix}-b`,
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	const createdMembers = await db
		.insert(organizationMember)
		.values([
			{
				organizationId: ids.organizationA,
				userId: ids.managerUserId,
				role: "owner",
			},
			{
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				role: "consultant",
				campusAccessMode: "selected",
			},
		])
		.returning({
			id: organizationMember.id,
			userId: organizationMember.userId,
		});
	const selectedOperatorMember = createdMembers.find(
		(member) => member.userId === ids.operatorUserId,
	);
	if (!selectedOperatorMember) {
		throw new Error("Operator membership was not created.");
	}
	await db.insert(organizationMemberCampus).values({
		organizationMemberId: selectedOperatorMember.id,
		campusId: ids.campusA,
	});
	await db.insert(course).values({
		id: ids.courseA,
		organizationId: ids.organizationA,
		code: `${ids.prefix}-course`,
		name: "学员测试课程",
		category: "language",
		level: "L1",
		durationMinutes: 60,
		listPriceInCents: 1_000,
		lessonsPerPackage: 10,
		tags: [],
	});
	await db.insert(lead).values({
		id: ids.leadConversion,
		organizationId: ids.organizationA,
		campusId: ids.campusAOther,
		interestedCourseId: ids.courseA,
		name: "转报名线索",
		phone: "139-0000-0001",
		source: "integration",
		stage: "new",
	});
}

test("学员负责人候选按角色与校区裁剪，并支持未分配筛选", async () => {
	const ids = createFixtureIds();
	const allAccess = { kind: "all" as const };
	const extraUsers = [
		{
			id: `${ids.prefix}-admin`,
			name: "全机构管理员",
			role: "admin" as const,
			campusAccessMode: "all" as const,
		},
		{
			id: `${ids.prefix}-campus-manager`,
			name: "A 校区负责人",
			role: "campus_manager" as const,
			campusAccessMode: "selected" as const,
		},
		{
			id: `${ids.prefix}-teacher`,
			name: "任课教师",
			role: "teacher" as const,
			campusAccessMode: "all" as const,
		},
		{
			id: `${ids.prefix}-finance`,
			name: "财务人员",
			role: "finance" as const,
			campusAccessMode: "all" as const,
		},
	];

	try {
		await seedFixture(ids);
		await db.insert(user).values(
			extraUsers.map((item) => ({
				id: item.id,
				name: item.name,
				email: `${item.id}@example.invalid`,
			})),
		);
		const members = await db
			.insert(organizationMember)
			.values(
				extraUsers.map((item) => ({
					organizationId: ids.organizationA,
					userId: item.id,
					role: item.role,
					campusAccessMode: item.campusAccessMode,
				})),
			)
			.returning({
				id: organizationMember.id,
				userId: organizationMember.userId,
			});
		const campusManagerMember = members.find(
			(item) => item.userId === `${ids.prefix}-campus-manager`,
		);
		assert.ok(campusManagerMember);
		await db.insert(organizationMemberCampus).values({
			organizationMemberId: campusManagerMember.id,
			campusId: ids.campusA,
		});

		const campusACandidates = await listStudentOwnerCandidateRecords({
			organizationId: ids.organizationA,
			campusAccess: allAccess,
			campusId: ids.campusA,
		});
		assert.deepEqual(
			new Set(campusACandidates.map((item) => item.userId)),
			new Set([
				ids.managerUserId,
				ids.operatorUserId,
				`${ids.prefix}-admin`,
				`${ids.prefix}-campus-manager`,
			]),
		);
		const otherCampusCandidates = await listStudentOwnerCandidateRecords({
			organizationId: ids.organizationA,
			campusAccess: allAccess,
			campusId: ids.campusAOther,
		});
		assert.deepEqual(
			new Set(otherCampusCandidates.map((item) => item.userId)),
			new Set([ids.managerUserId, `${ids.prefix}-admin`]),
		);

		const assigned = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			name: "已有负责人学员",
			campusId: ids.campusA,
			ownerUserId: ids.operatorUserId,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "已有负责人联系人",
					phone: "13600136001",
					relationship: null,
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		const unassigned = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			name: "未分配负责人学员",
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "未分配负责人联系人",
					phone: "13600136002",
					relationship: null,
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		const [assignedList, unassignedList] = await Promise.all([
			listStudentRecords({
				organizationId: ids.organizationA,
				campusAccess: allAccess,
				ownerUserId: ids.operatorUserId,
				pageSize: 20,
			}),
			listStudentRecords({
				organizationId: ids.organizationA,
				campusAccess: allAccess,
				ownerUserId: null,
				pageSize: 20,
			}),
		]);
		assert.deepEqual(
			assignedList.items.map((item) => item.id),
			[assigned.id],
		);
		assert.deepEqual(
			unassignedList.items.map((item) => item.id),
			[unassigned.id],
		);
	} finally {
		await cleanupFixture(ids);
		await db.delete(user).where(
			inArray(
				user.id,
				extraUsers.map((item) => item.id),
			),
		);
	}
});

test("学员档案限制机构与校区范围，维护联系人、标签和 guardian 兼容字段", async () => {
	const ids = createFixtureIds();
	const allAccess = { kind: "all" as const };
	const selectedA = { kind: "selected" as const, campusIds: [ids.campusA] };

	try {
		await seedFixture(ids);
		const tag = await createStudentTagRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			name: "  重点学员  ",
		});
		await expectStudentError(
			createStudentTagRecord({
				organizationId: ids.organizationA,
				userId: ids.managerUserId,
				campusAccess: allAccess,
				name: "重点学员",
			}),
			"STUDENT_TAG_DUPLICATE",
		);
		await renameStudentTagRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			id: tag.id,
			name: "重点客户",
		});

		const created = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: selectedA,
			name: "校区 A 学员",
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: "2018-01-02",
			status: "trial",
			contacts: [
				{
					name: "第一联系人",
					phone: "138-0013-8000",
					relationship: "母亲",
					isPrimary: true,
				},
			],
			tagIds: [tag.id],
		});
		assert.equal(created.primaryContactPhoneMasked, "138****8000");

		const listed = await listStudentRecords({
			organizationId: ids.organizationA,
			campusAccess: selectedA,
			pageSize: 20,
		});
		assert.deepEqual(
			listed.items.map((item) => item.id),
			[created.id],
		);
		assert.equal(listed.items[0]?.primaryContactPhoneMasked, "138****8000");
		assert.ok(!JSON.stringify(listed).includes("138-0013-8000"));

		const otherCampusStudent = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			name: "校区 A2 学员",
			campusId: ids.campusAOther,
			ownerUserId: null,
			birthDate: null,
			status: "active",
			contacts: [
				{
					name: "A2 家长",
					phone: "13700000000",
					relationship: null,
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		await expectStudentError(
			getStudentRecord({
				organizationId: ids.organizationA,
				campusAccess: selectedA,
				id: otherCampusStudent.id,
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);
		await expectStudentError(
			getStudentRecord({
				organizationId: ids.organizationB,
				campusAccess: { kind: "all" },
				id: created.id,
			}),
			"STUDENT_NOT_FOUND",
		);

		const primaryContact = created.contacts[0];
		assert.ok(primaryContact);
		const updated = await updateStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: selectedA,
			id: created.id,
			expectedVersion: created.version,
			data: {
				name: "校区 A 学员（更新）",
				birthDate: "2018-01-02",
				status: "active",
				ownerUserId: created.ownerUserId,
				contacts: [
					{
						id: primaryContact.id,
						name: primaryContact.name,
						phone: primaryContact.phone,
						relationship: primaryContact.relationship,
						isPrimary: false,
					},
					{
						name: "第二联系人",
						phone: "13900000000",
						relationship: "父亲",
						isPrimary: true,
					},
				],
				tagIds: [tag.id],
			},
		});
		assert.equal(
			updated.contacts.filter((contact) => contact.isPrimary).length,
			1,
		);
		const [persistedStudent] = await db
			.select({
				guardianName: student.guardianName,
				guardianPhone: student.guardianPhone,
			})
			.from(student)
			.where(eq(student.id, created.id));
		assert.deepEqual(persistedStudent, {
			guardianName: "第二联系人",
			guardianPhone: "13900000000",
		});
		await expectStudentError(
			updateStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				campusAccess: selectedA,
				id: created.id,
				expectedVersion: updated.version,
				data: {
					name: updated.name,
					birthDate: updated.birthDate,
					status: updated.status,
					ownerUserId: updated.ownerUserId,
					contacts: updated.contacts.map((contact) => ({
						...contact,
						isPrimary: false,
					})),
					tagIds: [tag.id],
				},
			}),
			"CONTACT_INVARIANT",
		);

		await setStudentTagActiveRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: allAccess,
			id: tag.id,
			isActive: false,
		});
		const afterTagDisabled = await getStudentRecord({
			organizationId: ids.organizationA,
			campusAccess: selectedA,
			id: created.id,
		});
		assert.deepEqual(afterTagDisabled.tags, [
			{ id: tag.id, name: "重点客户", isActive: false },
		]);
		await expectStudentError(
			createStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				campusAccess: selectedA,
				name: "不能分配停用标签",
				campusId: ids.campusA,
				ownerUserId: null,
				birthDate: null,
				status: "trial",
				contacts: [
					{
						name: "家长",
						phone: "13600000000",
						relationship: null,
						isPrimary: true,
					},
				],
				tagIds: [tag.id],
			}),
			"INVALID_TAGS",
		);

		await db
			.update(campus)
			.set({ isActive: false })
			.where(eq(campus.id, ids.campusA));
		assert.equal(
			(
				await getStudentRecord({
					organizationId: ids.organizationA,
					campusAccess: selectedA,
					id: created.id,
				})
			).id,
			created.id,
		);
		await expectStudentError(
			updateStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				campusAccess: selectedA,
				id: created.id,
				expectedVersion: afterTagDisabled.version,
				data: {
					name: afterTagDisabled.name,
					birthDate: afterTagDisabled.birthDate,
					status: afterTagDisabled.status,
					ownerUserId: afterTagDisabled.ownerUserId,
					contacts: afterTagDisabled.contacts,
					tagIds: [tag.id],
				},
			}),
			"CAMPUS_INACTIVE",
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("学员写入在事务内重新校验成员当前校区范围", async () => {
	const ids = createFixtureIds();
	const staleCampusAccess = {
		kind: "selected" as const,
		campusIds: [ids.campusA],
	};

	try {
		await seedFixture(ids);
		const created = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: staleCampusAccess,
			name: "撤销前学员",
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "撤销前联系人",
					phone: "13800138001",
					relationship: null,
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		const [operatorMember] = await db
			.select({ id: organizationMember.id })
			.from(organizationMember)
			.where(eq(organizationMember.userId, ids.operatorUserId))
			.limit(1);
		assert.ok(operatorMember);

		await db
			.delete(organizationMemberCampus)
			.where(
				eq(organizationMemberCampus.organizationMemberId, operatorMember.id),
			);
		await db.insert(organizationMemberCampus).values({
			organizationMemberId: operatorMember.id,
			campusId: ids.campusAOther,
		});

		await expectStudentError(
			createStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				campusAccess: staleCampusAccess,
				name: "撤销后新增",
				campusId: ids.campusA,
				ownerUserId: null,
				birthDate: null,
				status: "trial",
				contacts: [
					{
						name: "撤销后联系人",
						phone: "13800138002",
						relationship: null,
						isPrimary: true,
					},
				],
				tagIds: [],
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);
		await expectStudentError(
			updateStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.operatorUserId,
				campusAccess: staleCampusAccess,
				id: created.id,
				expectedVersion: created.version,
				data: {
					name: "不应保存的更新",
					birthDate: created.birthDate,
					status: created.status,
					ownerUserId: created.ownerUserId,
					contacts: created.contacts,
					tagIds: [],
				},
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);
		const persisted = await getStudentRecord({
			organizationId: ids.organizationA,
			campusAccess: { kind: "all" },
			id: created.id,
		});
		assert.equal(persisted.name, "撤销前学员");
	} finally {
		await cleanupFixture(ids);
	}
});

test("学员档案以版本令牌原子保护联系人、主要联系人和标签更新", async () => {
	const ids = createFixtureIds();
	const scope = {
		organizationId: ids.organizationA,
		userId: ids.operatorUserId,
		campusAccess: { kind: "selected" as const, campusIds: [ids.campusA] },
	};

	async function createConcurrentStudent(name: string, tagId: string) {
		return createStudentRecord({
			...scope,
			name,
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "初始联系人",
					phone: "13800138000",
					relationship: "母亲",
					isPrimary: true,
				},
			],
			tagIds: [tagId],
		});
	}

	async function assertWinnerPersisted(
		studentId: string,
		winner: Awaited<ReturnType<typeof getStudentRecord>>,
	) {
		const persisted = await getStudentRecord({
			organizationId: ids.organizationA,
			campusAccess: scope.campusAccess,
			id: studentId,
		});
		assert.deepEqual(persisted.contacts, winner.contacts);
		assert.deepEqual(persisted.tags, winner.tags);
		const primaryContact = winner.contacts.find((contact) => contact.isPrimary);
		assert.ok(primaryContact);
		const [guardian] = await db
			.select({
				guardianName: student.guardianName,
				guardianPhone: student.guardianPhone,
			})
			.from(student)
			.where(eq(student.id, studentId));
		assert.deepEqual(guardian, {
			guardianName: primaryContact.name,
			guardianPhone: primaryContact.phone,
		});
	}

	try {
		await seedFixture(ids);
		const tagInitial = await createStudentTagRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: { kind: "all" },
			name: "初始标签",
		});
		const tagWinner = await createStudentTagRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: { kind: "all" },
			name: "成功标签",
		});
		const tagLoser = await createStudentTagRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: { kind: "all" },
			name: "冲突标签",
		});

		const contactStudent = await createConcurrentStudent(
			"联系人并发学员",
			tagInitial.id,
		);
		const contactUpdates = await Promise.allSettled([
			updateStudentRecord({
				...scope,
				id: contactStudent.id,
				expectedVersion: contactStudent.version,
				data: {
					name: contactStudent.name,
					birthDate: contactStudent.birthDate,
					status: contactStudent.status,
					ownerUserId: contactStudent.ownerUserId,
					contacts: [
						...contactStudent.contacts,
						{
							name: "并发新增联系人 A",
							phone: "13900139001",
							relationship: "父亲",
							isPrimary: false,
						},
					],
					tagIds: [tagInitial.id],
				},
			}),
			updateStudentRecord({
				...scope,
				id: contactStudent.id,
				expectedVersion: contactStudent.version,
				data: {
					name: contactStudent.name,
					birthDate: contactStudent.birthDate,
					status: contactStudent.status,
					ownerUserId: contactStudent.ownerUserId,
					contacts: [
						...contactStudent.contacts,
						{
							name: "并发新增联系人 B",
							phone: "13900139002",
							relationship: "父亲",
							isPrimary: false,
						},
					],
					tagIds: [tagInitial.id],
				},
			}),
		]);
		const contactWinner = contactUpdates.find(
			(
				result,
			): result is PromiseFulfilledResult<
				Awaited<ReturnType<typeof updateStudentRecord>>
			> => result.status === "fulfilled",
		);
		const contactConflict = contactUpdates.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		assert.equal(
			contactUpdates.filter((result) => result.status === "fulfilled").length,
			1,
		);
		assert.equal(
			contactUpdates.filter((result) => result.status === "rejected").length,
			1,
		);
		assert.ok(contactWinner);
		assert.ok(contactConflict?.reason instanceof StudentRepositoryError);
		assert.equal(contactConflict.reason.code, "STUDENT_VERSION_CONFLICT");
		await assertWinnerPersisted(contactStudent.id, contactWinner.value);

		const primaryStudent = await createConcurrentStudent(
			"主要联系人并发学员",
			tagInitial.id,
		);
		const originalPrimary = primaryStudent.contacts[0];
		assert.ok(originalPrimary);
		const primaryWinner = await updateStudentRecord({
			...scope,
			id: primaryStudent.id,
			expectedVersion: primaryStudent.version,
			data: {
				name: primaryStudent.name,
				birthDate: primaryStudent.birthDate,
				status: primaryStudent.status,
				ownerUserId: primaryStudent.ownerUserId,
				contacts: [
					{ ...originalPrimary, isPrimary: false },
					{
						name: "成功主要联系人",
						phone: "13900139003",
						relationship: "父亲",
						isPrimary: true,
					},
				],
				tagIds: [tagInitial.id],
			},
		});
		await expectStudentError(
			updateStudentRecord({
				...scope,
				id: primaryStudent.id,
				expectedVersion: primaryStudent.version,
				data: {
					name: primaryStudent.name,
					birthDate: primaryStudent.birthDate,
					status: primaryStudent.status,
					ownerUserId: primaryStudent.ownerUserId,
					contacts: primaryStudent.contacts,
					tagIds: [tagInitial.id],
				},
			}),
			"STUDENT_VERSION_CONFLICT",
		);
		await assertWinnerPersisted(primaryStudent.id, primaryWinner);

		const tagStudent = await createConcurrentStudent(
			"标签并发学员",
			tagInitial.id,
		);
		const tagWinnerResult = await updateStudentRecord({
			...scope,
			id: tagStudent.id,
			expectedVersion: tagStudent.version,
			data: {
				name: tagStudent.name,
				birthDate: tagStudent.birthDate,
				status: tagStudent.status,
				ownerUserId: tagStudent.ownerUserId,
				contacts: tagStudent.contacts,
				tagIds: [tagWinner.id],
			},
		});
		await expectStudentError(
			updateStudentRecord({
				...scope,
				id: tagStudent.id,
				expectedVersion: tagStudent.version,
				data: {
					name: tagStudent.name,
					birthDate: tagStudent.birthDate,
					status: tagStudent.status,
					ownerUserId: tagStudent.ownerUserId,
					contacts: tagStudent.contacts,
					tagIds: [tagLoser.id],
				},
			}),
			"STUDENT_VERSION_CONFLICT",
		);
		await assertWinnerPersisted(tagStudent.id, tagWinnerResult);

		const client = createSessionClient(
			ids.managerUserId,
			"学员测试管理员",
			ids.organizationA,
		);
		await expectOrpcError(
			client.training.students.update({
				id: tagStudent.id,
				expectedVersion: tagStudent.version,
				data: {
					name: tagStudent.name,
					birthDate: tagStudent.birthDate,
					status: "trial",
					ownerUserId: tagStudent.ownerUserId,
					contacts: tagStudent.contacts,
					tagIds: [tagLoser.id],
				},
			}),
			"CONFLICT",
			"STUDENT_VERSION_CONFLICT",
		);
		await assertWinnerPersisted(tagStudent.id, tagWinnerResult);
	} finally {
		await cleanupFixture(ids);
	}
});

test("线索转报名的新学员在同一事务创建主要联系人并保留 guardian 兼容字段", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const result = await convertLeadRecord({
			organizationId: ids.organizationA,
			operatorUserId: ids.managerUserId,
			campusAccess: { kind: "all" },
			leadId: ids.leadConversion,
			student: {
				mode: "new",
				name: "转报名学员",
				guardianName: "转报名家长",
				campusId: ids.campusAOther,
			},
			conversionOwnerUserId: null,
			adjustStudentOwner: false,
			courseId: ids.courseA,
			classGroupId: null,
			purchasedLessons: 10,
			amountInCents: 1_000,
			invoiceDueDate: "2026-08-31",
			canOverridePackageTerms: false,
		});
		const [createdStudent, contacts] = await Promise.all([
			db
				.select({
					guardianName: student.guardianName,
					guardianPhone: student.guardianPhone,
				})
				.from(student)
				.where(eq(student.id, result.studentId)),
			db
				.select({
					name: studentContact.name,
					phone: studentContact.phone,
					isPrimary: studentContact.isPrimary,
				})
				.from(studentContact)
				.where(eq(studentContact.studentId, result.studentId)),
		]);
		assert.deepEqual(createdStudent, [
			{ guardianName: "转报名家长", guardianPhone: "139-0000-0001" },
		]);
		assert.deepEqual(contacts, [
			{ name: "转报名家长", phone: "139-0000-0001", isPrimary: true },
		]);
	} finally {
		await cleanupFixture(ids);
	}
});

test("学员合并显式选择主档案字段，迁移安全关联并冻结来源档案", async () => {
	const ids = createFixtureIds();
	const access = { kind: "all" as const };
	try {
		await seedFixture(ids);
		const source = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: access,
			name: "待合并来源",
			campusId: ids.campusA,
			ownerUserId: ids.operatorUserId,
			birthDate: "2017-01-02",
			status: "active",
			contacts: [
				{
					name: "来源家长",
					phone: "+86 138-0013-8000",
					relationship: "母亲",
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		const target = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			campusAccess: access,
			name: "主档案",
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "主档案家长",
					phone: "13900139000",
					relationship: "父亲",
					isPrimary: true,
				},
			],
			tagIds: [],
		});
		await db.insert(enrollment).values({
			organizationId: ids.organizationA,
			studentId: source.id,
			courseId: ids.courseA,
			purchasedLessons: 10,
			remainingLessons: 8,
			status: "transferred",
		});

		const duplicateCandidates = await findDuplicateStudentCandidates({
			organizationId: ids.organizationA,
			campusAccess: access,
			phone: "13800138000",
		});
		assert.deepEqual(
			duplicateCandidates.map((item) => item.id),
			[source.id],
		);

		const crossOrganizationStudentId = randomUUID();
		await db.insert(student).values({
			id: crossOrganizationStudentId,
			organizationId: ids.organizationB,
			campusId: ids.campusB,
			name: "跨机构同手机号学员",
			guardianName: "跨机构家长",
			guardianPhone: "13800138000",
			guardianPhoneNormalized: "13800138000",
			status: "active",
		});
		await db.insert(studentContact).values({
			studentId: crossOrganizationStudentId,
			name: "跨机构联系人",
			phone: "13800138000",
			phoneNormalized: "13800138000",
			relationship: "家长",
			isPrimary: true,
		});

		const scopedDuplicateCandidates = await findDuplicateStudentCandidates({
			organizationId: ids.organizationA,
			campusAccess: access,
			phone: "13800138000",
		});
		assert.deepEqual(
			scopedDuplicateCandidates.map((item) => item.id),
			[source.id],
		);

		const preview = await getStudentMergePreviewRecord({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			sourceStudentId: source.id,
			targetStudentId: target.id,
		});
		assert.deepEqual(preview.blockingReasons, []);
		assert.ok(preview.conflicts.includes("name"));
		assert.ok(preview.conflicts.includes("ownerUserId"));
		const targetPrimary = preview.contacts.find(
			(contact) => contact.studentId === target.id && contact.isPrimary,
		);
		assert.ok(targetPrimary);
		const requestId = randomUUID();
		const result = await mergeStudentRecords({
			organizationId: ids.organizationA,
			userId: ids.managerUserId,
			sourceStudentId: source.id,
			targetStudentId: target.id,
			expectedSourceVersion: preview.source.version,
			expectedTargetVersion: preview.target.version,
			requestId,
			fieldSources: {
				name: "target",
				campusId: "target",
				birthDate: "source",
				status: "source",
				ownerUserId: "source",
				primaryContactId: targetPrimary.id,
			},
		});
		assert.equal(result.replayed, false);
		assert.deepEqual(
			await mergeStudentRecords({
				organizationId: ids.organizationA,
				userId: ids.managerUserId,
				sourceStudentId: source.id,
				targetStudentId: target.id,
				expectedSourceVersion: preview.source.version,
				expectedTargetVersion: preview.target.version,
				requestId,
				fieldSources: {
					name: "target",
					campusId: "target",
					birthDate: "source",
					status: "source",
					ownerUserId: "source",
					primaryContactId: targetPrimary.id,
				},
			}),
			{ ...result, replayed: true },
		);

		const [sourceMapping, movedEnrollment, mergedTarget, ownerEvents, audits] =
			await Promise.all([
				db
					.select({ mergedIntoStudentId: student.mergedIntoStudentId })
					.from(student)
					.where(eq(student.id, source.id)),
				db
					.select({ studentId: enrollment.studentId })
					.from(enrollment)
					.where(eq(enrollment.studentId, target.id)),
				getStudentRecord({
					organizationId: ids.organizationA,
					campusAccess: access,
					id: target.id,
				}),
				db
					.select({
						beforeOwnerUserId: studentOwnerAssignmentEvent.beforeOwnerUserId,
						afterOwnerUserId: studentOwnerAssignmentEvent.afterOwnerUserId,
						source: studentOwnerAssignmentEvent.source,
					})
					.from(studentOwnerAssignmentEvent)
					.where(eq(studentOwnerAssignmentEvent.studentId, target.id)),
				db
					.select({ action: organizationAuditEvent.action })
					.from(organizationAuditEvent)
					.where(eq(organizationAuditEvent.organizationId, ids.organizationA)),
			]);
		assert.equal(sourceMapping[0]?.mergedIntoStudentId, target.id);
		assert.equal(movedEnrollment.length, 1);
		assert.equal(mergedTarget.birthDate, "2017-01-02");
		assert.equal(mergedTarget.status, "active");
		assert.equal(mergedTarget.ownerUserId, ids.operatorUserId);
		assert.equal(mergedTarget.contacts.length, 2);
		assert.ok(
			ownerEvents.some(
				(event) =>
					event.source === "merge" &&
					event.beforeOwnerUserId === null &&
					event.afterOwnerUserId === ids.operatorUserId,
			),
		);
		assert.ok(audits.some((audit) => audit.action === "student_merged"));
		await assert.rejects(
			updateStudentRecord({
				organizationId: ids.organizationA,
				userId: ids.managerUserId,
				campusAccess: access,
				id: source.id,
				expectedVersion: source.version,
				data: {
					name: source.name,
					birthDate: source.birthDate,
					status: source.status,
					ownerUserId: source.ownerUserId,
					contacts: source.contacts,
					tagIds: [],
				},
			}),
			(error: unknown) => {
				assert.ok(error instanceof StudentRepositoryError);
				assert.equal(error.code, "STUDENT_MERGED");
				return true;
			},
		);
	} finally {
		await cleanupFixture(ids);
	}
});

test("学员业务时间线稳定聚合事实，并按角色、机构和校区裁剪", async () => {
	const ids = createFixtureIds();
	const allAccess = { kind: "all" as const };
	const selectedA = { kind: "selected" as const, campusIds: [ids.campusA] };
	const enrolledAt = new Date("2026-07-01T01:00:00.000Z");
	const issuedAt = new Date("2026-07-02T01:00:00.000Z");
	const receivedAt = new Date("2026-07-03T01:00:00.000Z");
	const startsAt = new Date("2026-07-04T01:00:00.000Z");
	const recordedAt = new Date("2026-07-10T01:00:00.000Z");

	try {
		await seedFixture(ids);
		const created = await createStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: selectedA,
			name: "时间线学员",
			campusId: ids.campusA,
			ownerUserId: null,
			birthDate: null,
			status: "trial",
			contacts: [
				{
					name: "时间线联系人",
					phone: "13800138003",
					relationship: "母亲",
					isPrimary: true,
				},
			],
			tagIds: [],
		});

		const teacherId = randomUUID();
		const classGroupId = randomUUID();
		const enrollmentId = randomUUID();
		const invoiceIds = [randomUUID(), randomUUID()];
		const lessonId = randomUUID();
		await db.insert(teacher).values({
			id: teacherId,
			organizationId: ids.organizationA,
			name: "时间线教师",
			subjects: ["英语"],
			weeklyCapacityHours: 20,
		});
		await db.insert(classGroup).values({
			id: classGroupId,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA,
			teacherId,
			name: "时间线班级",
			status: "running",
			capacity: 20,
			scheduleText: "周六 09:00",
			startDate: "2026-07-01",
		});
		await db.insert(enrollment).values({
			id: enrollmentId,
			organizationId: ids.organizationA,
			studentId: created.id,
			courseId: ids.courseA,
			classGroupId,
			purchasedLessons: 10,
			remainingLessons: 9,
			amountInCents: 10_000,
			paidAmountInCents: 5_000,
			status: "active",
			enrolledAt,
		});
		await db.insert(invoice).values(
			invoiceIds.map((id, index) => ({
				id,
				organizationId: ids.organizationA,
				studentId: created.id,
				enrollmentId,
				amountInCents: index === 0 ? 5_000 : 2_000,
				paidAmountInCents: index === 0 ? 5_000 : 0,
				status: index === 0 ? ("paid" as const) : ("pending" as const),
				dueDate: "2026-07-31",
				issuedAt,
				paidAt: index === 0 ? receivedAt : null,
			})),
		);
		await db.insert(payment).values({
			organizationId: ids.organizationA,
			invoiceId: invoiceIds[0] as string,
			amountInCents: 5_000,
			receivedAt,
			method: "bank_transfer",
			operatorUserId: ids.managerUserId,
			operatorName: "学员测试管理员",
			requestId: randomUUID(),
			createdAt: recordedAt,
		});
		await db.insert(lesson).values({
			id: lessonId,
			organizationId: ids.organizationA,
			classGroupId,
			teacherId,
			campusId: ids.campusA,
			room: "A101",
			startsAt,
			endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
			status: "completed",
			completedAt: recordedAt,
			completedByUserId: ids.managerUserId,
		});
		const [attendanceRecord] = await db
			.insert(attendance)
			.values({
				lessonId,
				studentId: created.id,
				status: "present",
				recordedByUserId: ids.managerUserId,
				updatedAt: recordedAt,
			})
			.returning({ id: attendance.id });
		assert.ok(attendanceRecord);
		const [consumptionRecord] = await db
			.insert(lessonConsumption)
			.values({
				organizationId: ids.organizationA,
				enrollmentId,
				lessonId,
				attendanceStatus: "present",
				previousRemainingLessons: 10,
				remainingLessons: 9,
				consumedByUserId: ids.managerUserId,
				consumedAt: recordedAt,
			})
			.returning({ id: lessonConsumption.id });
		assert.ok(consumptionRecord);

		const updated = await updateStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: selectedA,
			id: created.id,
			expectedVersion: created.version,
			data: {
				name: created.name,
				birthDate: created.birthDate,
				status: "active",
				ownerUserId: created.ownerUserId,
				contacts: created.contacts,
				tagIds: [],
			},
		});
		await updateStudentRecord({
			organizationId: ids.organizationA,
			userId: ids.operatorUserId,
			campusAccess: selectedA,
			id: created.id,
			expectedVersion: updated.version,
			data: {
				name: `${updated.name}（资料更新）`,
				birthDate: updated.birthDate,
				status: "active",
				ownerUserId: updated.ownerUserId,
				contacts: updated.contacts,
				tagIds: [],
			},
		});
		const statusEvents = await db
			.select()
			.from(studentStatusEvent)
			.where(eq(studentStatusEvent.studentId, created.id));
		assert.equal(statusEvents.length, 1);
		assert.equal(statusEvents[0]?.beforeStatus, "trial");
		assert.equal(statusEvents[0]?.afterStatus, "active");

		const timelineItems = [];
		let cursor: string | undefined;
		do {
			const page = await listStudentTimelineRecords({
				organizationId: ids.organizationA,
				campusAccess: allAccess,
				studentId: created.id,
				includeFinancial: true,
				cursor,
				pageSize: 2,
			});
			timelineItems.push(...page.items);
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		assert.equal(
			new Set(timelineItems.map((item) => item.id)).size,
			timelineItems.length,
		);
		assert.deepEqual(
			new Set(timelineItems.map((item) => item.kind)),
			new Set([
				"student_status_changed",
				"lesson_consumed",
				"attendance_recorded",
				"payment_received",
				"invoice_issued",
				"enrollment_created",
			]),
		);
		const lessonEvents = timelineItems.filter(
			(item) => item.lessonId === lessonId,
		);
		assert.deepEqual(
			lessonEvents.map((item) => item.kind),
			["lesson_consumed", "attendance_recorded"],
		);
		assert.ok(
			lessonEvents.every(
				(item) => item.occurredAt.getTime() === startsAt.getTime(),
			),
		);
		assert.ok(
			lessonEvents.every(
				(item) => item.recordedAt?.getTime() === recordedAt.getTime(),
			),
		);
		const invoiceEvents = timelineItems.filter(
			(item) => item.kind === "invoice_issued",
		);
		assert.deepEqual(
			invoiceEvents.map((item) => item.sourceId),
			[...invoiceIds].sort().reverse(),
		);

		const restricted = await listStudentTimelineRecords({
			organizationId: ids.organizationA,
			campusAccess: selectedA,
			studentId: created.id,
			includeFinancial: false,
			pageSize: 50,
		});
		assert.ok(
			restricted.items.every(
				(item) =>
					!(
						[
							"invoice_issued",
							"payment_received",
							"enrollment_renewed",
							"enrollment_transferred",
							"refund_created",
						] as const
					).includes(
						item.kind as
							| "invoice_issued"
							| "payment_received"
							| "enrollment_renewed"
							| "enrollment_transferred"
							| "refund_created",
					),
			),
		);
		const restrictedEnrollment = restricted.items.find(
			(item) => item.kind === "enrollment_created",
		);
		assert.ok(restrictedEnrollment);
		assert.equal(restrictedEnrollment.amountInCents, null);
		assert.equal(restrictedEnrollment.invoiceId, null);

		await expectStudentError(
			listStudentTimelineRecords({
				organizationId: ids.organizationB,
				campusAccess: allAccess,
				studentId: created.id,
				includeFinancial: true,
				pageSize: 20,
			}),
			"STUDENT_NOT_FOUND",
		);
		await expectStudentError(
			listStudentTimelineRecords({
				organizationId: ids.organizationA,
				campusAccess: {
					kind: "selected",
					campusIds: [ids.campusAOther],
				},
				studentId: created.id,
				includeFinancial: true,
				pageSize: 20,
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);
		await expectStudentError(
			listStudentTimelineRecords({
				organizationId: ids.organizationA,
				campusAccess: allAccess,
				studentId: created.id,
				includeFinancial: true,
				cursor: "invalid-cursor",
				pageSize: 20,
			}),
			"INVALID_CURSOR",
		);

		const ownerClient = createSessionClient(
			ids.managerUserId,
			"学员测试管理员",
			ids.organizationA,
		);
		const ownerTimeline = await ownerClient.training.students.timeline({
			studentId: created.id,
			pageSize: 50,
		});
		assert.ok(
			ownerTimeline.items.some(
				(item) =>
					item.kind === "invoice_issued" && item.source.type === "invoice",
			),
		);
		assert.ok(
			ownerTimeline.items.some(
				(item) =>
					item.kind === "lesson_consumed" &&
					item.source.type === "lesson" &&
					item.occurredAt === startsAt.toISOString() &&
					item.recordedAt === recordedAt.toISOString(),
			),
		);

		const consultantClient = createSessionClient(
			ids.operatorUserId,
			"学员测试操作人",
			ids.organizationA,
		);
		const consultantTimeline =
			await consultantClient.training.students.timeline({
				studentId: created.id,
				pageSize: 50,
			});
		assert.ok(
			consultantTimeline.items.every((item) => item.source.type !== "invoice"),
		);
		assert.ok(
			consultantTimeline.items.every(
				(item) =>
					item.kind !== "invoice_issued" && item.kind !== "payment_received",
			),
		);
	} finally {
		await cleanupFixture(ids);
	}
});
