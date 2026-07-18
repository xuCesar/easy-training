import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src";
import { convertLeadRecord } from "../src/repositories/enrollment-conversion";
import {
	createStudentRecord,
	createStudentTagRecord,
	getStudentRecord,
	listStudentRecords,
	renameStudentTagRecord,
	StudentRepositoryError,
	setStudentTagActiveRecord,
	updateStudentRecord,
} from "../src/repositories/students";
import {
	campus,
	course,
	enrollment,
	invoice,
	lead,
	organization,
	student,
	studentContact,
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
		operatorUserId: `${prefix}-operator`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

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

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];
	await db
		.delete(invoice)
		.where(inArray(invoice.organizationId, organizationIds));
	await db
		.delete(enrollment)
		.where(inArray(enrollment.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db.delete(user).where(eq(user.id, ids.operatorUserId));
}

async function seedFixture(ids: FixtureIds) {
	await db.insert(organization).values([
		{ id: ids.organizationA, name: `${ids.prefix} A` },
		{ id: ids.organizationB, name: `${ids.prefix} B` },
	]);
	await db.insert(user).values({
		id: ids.operatorUserId,
		name: "学员测试操作人",
		email: `${ids.operatorUserId}@example.invalid`,
	});
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

test("学员档案限制机构与校区范围，维护联系人、标签和 guardian 兼容字段", async () => {
	const ids = createFixtureIds();
	const allAccess = { kind: "all" as const };
	const selectedA = { kind: "selected" as const, campusIds: [ids.campusA] };

	try {
		await seedFixture(ids);
		const tag = await createStudentTagRecord({
			organizationId: ids.organizationA,
			campusAccess: allAccess,
			name: "  重点学员  ",
		});
		await expectStudentError(
			createStudentTagRecord({
				organizationId: ids.organizationA,
				campusAccess: allAccess,
				name: "重点学员",
			}),
			"STUDENT_TAG_DUPLICATE",
		);
		await renameStudentTagRecord({
			organizationId: ids.organizationA,
			campusAccess: allAccess,
			id: tag.id,
			name: "重点客户",
		});

		const created = await createStudentRecord({
			organizationId: ids.organizationA,
			campusAccess: selectedA,
			name: "校区 A 学员",
			campusId: ids.campusA,
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
			campusAccess: allAccess,
			name: "校区 A2 学员",
			campusId: ids.campusAOther,
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
			campusAccess: selectedA,
			id: created.id,
			data: {
				name: "校区 A 学员（更新）",
				birthDate: "2018-01-02",
				status: "active",
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
				campusAccess: selectedA,
				id: created.id,
				data: {
					name: updated.name,
					birthDate: updated.birthDate,
					status: updated.status,
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
				campusAccess: selectedA,
				name: "不能分配停用标签",
				campusId: ids.campusA,
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
				campusAccess: selectedA,
				id: created.id,
				data: {
					name: afterTagDisabled.name,
					birthDate: afterTagDisabled.birthDate,
					status: afterTagDisabled.status,
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

test("线索转报名的新学员在同一事务创建主要联系人并保留 guardian 兼容字段", async () => {
	const ids = createFixtureIds();
	try {
		await seedFixture(ids);
		const result = await convertLeadRecord({
			organizationId: ids.organizationA,
			operatorUserId: ids.operatorUserId,
			campusAccess: { kind: "selected", campusIds: [ids.campusAOther] },
			leadId: ids.leadConversion,
			student: {
				mode: "new",
				name: "转报名学员",
				guardianName: "转报名家长",
				campusId: ids.campusAOther,
			},
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
