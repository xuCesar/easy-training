import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
	createIndependentEnrollmentRecord,
	db,
	EnrollmentRegistrationError,
	getIndependentEnrollmentOptionsRecord,
} from "../src";
import {
	campus,
	classGroup,
	course,
	enrollment,
	enrollmentRegistration,
	invoice,
	invoiceArrearsCycle,
	invoiceArrearsEvent,
	organization,
	organizationAuditEvent,
	organizationMember,
	student,
	studentContact,
	teacher,
	user,
} from "../src/schema";

function createIds() {
	const prefix = `registration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusId: randomUUID(),
		courseId: randomUUID(),
		teacherId: randomUUID(),
		classId: randomUUID(),
		concurrentClassId: randomUUID(),
		studentId: randomUUID(),
		ownerAdjustmentStudentId: randomUUID(),
		pausedStudentId: randomUUID(),
		userId: `${prefix}-user`,
	};
}

type Ids = ReturnType<typeof createIds>;

async function seed(ids: Ids) {
	await db
		.insert(organization)
		.values({ id: ids.organizationId, name: ids.prefix });
	await db.insert(user).values({
		id: ids.userId,
		name: "报名操作人",
		email: `${ids.userId}@example.invalid`,
	});
	await db.insert(organizationMember).values({
		organizationId: ids.organizationId,
		userId: ids.userId,
		role: "owner",
		campusAccessMode: "all",
	});
	await db.insert(campus).values({
		id: ids.campusId,
		organizationId: ids.organizationId,
		code: `${ids.prefix}-campus`,
		name: "报名校区",
		city: "上海",
		address: "测试地址",
	});
	await db.insert(course).values({
		id: ids.courseId,
		organizationId: ids.organizationId,
		code: `${ids.prefix}-course`,
		name: "报名课程",
		category: "language",
		level: "L1",
		durationMinutes: 60,
		listPriceInCents: 9_900,
		lessonsPerPackage: 12,
		tags: [],
	});
	await db.insert(teacher).values({
		id: ids.teacherId,
		organizationId: ids.organizationId,
		name: "报名教师",
		subjects: ["英语"],
	});
	await db.insert(classGroup).values([
		{
			id: ids.classId,
			organizationId: ids.organizationId,
			courseId: ids.courseId,
			campusId: ids.campusId,
			teacherId: ids.teacherId,
			name: "可报名班级",
			status: "recruiting",
			capacity: 3,
			scheduleText: "周六 10:00",
			startDate: "2026-08-01",
		},
		{
			id: ids.concurrentClassId,
			organizationId: ids.organizationId,
			courseId: ids.courseId,
			campusId: ids.campusId,
			teacherId: ids.teacherId,
			name: "最后一个名额班级",
			status: "recruiting",
			capacity: 1,
			scheduleText: "周日 10:00",
			startDate: "2026-08-01",
		},
	]);
	await db.insert(student).values([
		{
			id: ids.studentId,
			organizationId: ids.organizationId,
			campusId: ids.campusId,
			name: "已有学员",
			guardianName: "已有联系人",
			guardianPhone: "13800138000",
			status: "active",
		},
		{
			id: ids.pausedStudentId,
			organizationId: ids.organizationId,
			campusId: ids.campusId,
			name: "暂停学员",
			guardianName: "暂停联系人",
			guardianPhone: "13900139000",
			status: "paused",
		},
		{
			id: ids.ownerAdjustmentStudentId,
			organizationId: ids.organizationId,
			campusId: ids.campusId,
			name: "负责人调整学员",
			guardianName: "负责人调整联系人",
			guardianPhone: "13700137000",
			status: "active",
		},
	]);
}

async function cleanup(ids: Ids) {
	await db
		.delete(invoiceArrearsEvent)
		.where(eq(invoiceArrearsEvent.organizationId, ids.organizationId));
	await db
		.delete(invoiceArrearsCycle)
		.where(eq(invoiceArrearsCycle.organizationId, ids.organizationId));
	await db
		.delete(organizationAuditEvent)
		.where(eq(organizationAuditEvent.organizationId, ids.organizationId));
	await db
		.delete(enrollmentRegistration)
		.where(eq(enrollmentRegistration.organizationId, ids.organizationId));
	await db
		.delete(invoice)
		.where(eq(invoice.organizationId, ids.organizationId));
	await db
		.delete(enrollment)
		.where(eq(enrollment.organizationId, ids.organizationId));
	const students = await db
		.select({ id: student.id })
		.from(student)
		.where(eq(student.organizationId, ids.organizationId));
	if (students.length > 0) {
		await db.delete(studentContact).where(
			inArray(
				studentContact.studentId,
				students.map((item) => item.id),
			),
		);
	}
	await db
		.delete(classGroup)
		.where(eq(classGroup.organizationId, ids.organizationId));
	await db
		.delete(student)
		.where(eq(student.organizationId, ids.organizationId));
	await db
		.delete(teacher)
		.where(eq(teacher.organizationId, ids.organizationId));
	await db.delete(course).where(eq(course.organizationId, ids.organizationId));
	await db
		.delete(organizationMember)
		.where(eq(organizationMember.organizationId, ids.organizationId));
	await db.delete(campus).where(eq(campus.organizationId, ids.organizationId));
	await db.delete(organization).where(eq(organization.id, ids.organizationId));
	await db.delete(user).where(eq(user.id, ids.userId));
}

function baseInput(ids: Ids, requestId = randomUUID()) {
	return {
		organizationId: ids.organizationId,
		operatorUserId: ids.userId,
		requestId,
		student: {
			mode: "existing" as const,
			studentId: ids.studentId,
			expectedVersion: 1,
		},
		conversionOwnerUserId: ids.userId,
		adjustStudentOwner: false,
		courseId: ids.courseId,
		classGroupId: null,
		purchasedLessons: 12,
		amountInCents: 9_900,
		invoiceDueDate: "2026-08-31",
	};
}

async function expectRegistrationError(
	promise: Promise<unknown>,
	code: EnrollmentRegistrationError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof EnrollmentRegistrationError);
		assert.equal(error.code, code);
		return true;
	});
}

test("独立报名原子创建、重放、续费拦截与并发名额保护", async () => {
	const ids = createIds();
	try {
		await seed(ids);
		const options = await getIndependentEnrollmentOptionsRecord({
			organizationId: ids.organizationId,
			campusAccess: { kind: "all" },
		});
		assert.equal(options.campuses.length, 1);
		assert.equal(options.courses[0]?.id, ids.courseId);
		assert.ok(options.classes.some((item) => item.id === ids.classId));

		const requestId = randomUUID();
		const result = await createIndependentEnrollmentRecord(
			baseInput(ids, requestId),
		);
		assert.equal(result.replayed, false);
		const replay = await createIndependentEnrollmentRecord(
			baseInput(ids, requestId),
		);
		assert.deepEqual(replay, { ...result, replayed: true });
		const [createdEnrollment] = await db
			.select({
				leadId: enrollment.leadId,
				status: enrollment.status,
				conversionOwnerUserId: enrollment.conversionOwnerUserId,
			})
			.from(enrollment)
			.where(eq(enrollment.id, result.enrollmentId));
		assert.equal(createdEnrollment?.leadId, null);
		assert.equal(createdEnrollment?.status, "active");
		assert.equal(createdEnrollment?.conversionOwnerUserId, ids.userId);
		const [unchangedExistingStudent] = await db
			.select({ ownerUserId: student.ownerUserId })
			.from(student)
			.where(eq(student.id, ids.studentId));
		assert.equal(unchangedExistingStudent?.ownerUserId, null);
		const audits = await db
			.select({ id: organizationAuditEvent.id })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.action, "enrollment_created"),
				),
			);
		assert.equal(audits.length, 1);

		await expectRegistrationError(
			createIndependentEnrollmentRecord({
				...baseInput(ids, requestId),
				amountInCents: 0,
			}),
			"IDEMPOTENCY_CONFLICT",
		);
		await expectRegistrationError(
			createIndependentEnrollmentRecord(baseInput(ids)),
			"ACTIVE_COURSE_ENROLLMENT",
		);
		await expectRegistrationError(
			createIndependentEnrollmentRecord({
				...baseInput(ids),
				student: {
					mode: "existing",
					studentId: ids.pausedStudentId,
					expectedVersion: 1,
				},
			}),
			"STUDENT_NOT_ENROLLABLE",
		);

		const newStudentResult = await createIndependentEnrollmentRecord({
			...baseInput(ids),
			student: {
				mode: "new",
				name: "新建报名学员",
				campusId: ids.campusId,
				primaryContact: {
					name: "新建主要联系人",
					phone: "13600136000",
					relationship: "母亲",
				},
			},
			classGroupId: ids.classId,
		});
		const [newContact] = await db
			.select({
				name: studentContact.name,
				relationship: studentContact.relationship,
				isPrimary: studentContact.isPrimary,
			})
			.from(studentContact)
			.where(eq(studentContact.studentId, newStudentResult.studentId));
		assert.deepEqual(newContact, {
			name: "新建主要联系人",
			relationship: "母亲",
			isPrimary: true,
		});
		const [newStudentOwner] = await db
			.select({ ownerUserId: student.ownerUserId })
			.from(student)
			.where(eq(student.id, newStudentResult.studentId));
		assert.equal(newStudentOwner?.ownerUserId, ids.userId);

		const concurrent = await Promise.allSettled([
			createIndependentEnrollmentRecord({
				...baseInput(ids),
				student: {
					mode: "new",
					name: "并发学员一",
					campusId: ids.campusId,
					primaryContact: {
						name: "联系人一",
						phone: "13500135001",
						relationship: null,
					},
				},
				classGroupId: ids.concurrentClassId,
			}),
			createIndependentEnrollmentRecord({
				...baseInput(ids),
				student: {
					mode: "new",
					name: "并发学员二",
					campusId: ids.campusId,
					primaryContact: {
						name: "联系人二",
						phone: "13500135002",
						relationship: null,
					},
				},
				classGroupId: ids.concurrentClassId,
			}),
		]);
		assert.equal(
			concurrent.filter((item) => item.status === "fulfilled").length,
			1,
		);
		const concurrentEnrollments = await db
			.select({ id: enrollment.id })
			.from(enrollment)
			.where(eq(enrollment.classGroupId, ids.concurrentClassId));
		assert.equal(concurrentEnrollments.length, 1);
	} finally {
		await cleanup(ids);
	}
});

test("已有学员负责人调整会校验版本与管理角色并整体回滚报名", async () => {
	const ids = createIds();
	const adjustmentInput = (expectedVersion: number) => ({
		...baseInput(ids),
		student: {
			mode: "existing" as const,
			studentId: ids.ownerAdjustmentStudentId,
			expectedVersion,
		},
		adjustStudentOwner: true,
	});

	try {
		await seed(ids);
		await expectRegistrationError(
			createIndependentEnrollmentRecord(adjustmentInput(2)),
			"STUDENT_VERSION_CONFLICT",
		);

		await db
			.update(organizationMember)
			.set({ role: "consultant", campusAccessMode: "all" })
			.where(
				and(
					eq(organizationMember.organizationId, ids.organizationId),
					eq(organizationMember.userId, ids.userId),
				),
			);
		await expectRegistrationError(
			createIndependentEnrollmentRecord(adjustmentInput(1)),
			"STUDENT_OWNER_ADJUST_FORBIDDEN",
		);

		const [persistedStudent, createdEnrollments, createdInvoices] =
			await Promise.all([
				db
					.select({
						ownerUserId: student.ownerUserId,
						version: student.version,
					})
					.from(student)
					.where(eq(student.id, ids.ownerAdjustmentStudentId)),
				db
					.select({ id: enrollment.id })
					.from(enrollment)
					.where(eq(enrollment.studentId, ids.ownerAdjustmentStudentId)),
				db
					.select({ id: invoice.id })
					.from(invoice)
					.where(eq(invoice.studentId, ids.ownerAdjustmentStudentId)),
			]);
		assert.deepEqual(persistedStudent, [{ ownerUserId: null, version: 1 }]);
		assert.deepEqual(createdEnrollments, []);
		assert.deepEqual(createdInvoices, []);
	} finally {
		await cleanup(ids);
	}
});
