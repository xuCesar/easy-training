import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
	type ConvertLeadInput,
	convertLeadInputSchema,
	leadConversionOptionsSchema,
} from "../../api/src/contracts/training";
import {
	convertLead,
	getLeadConversionOptions,
} from "../../api/src/repositories/enrollment-conversion";
import { db } from "../src";
import {
	campus,
	classGroup,
	course,
	enrollment,
	invoice,
	invoiceArrearsCycle,
	invoiceArrearsEvent,
	lead,
	organization,
	organizationAuditEvent,
	student,
	teacher,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `conversion-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;

	return {
		prefix,
		organizationA: randomUUID(),
		organizationB: randomUUID(),
		campusA1: randomUUID(),
		campusA2: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseAOther: randomUUID(),
		courseB: randomUUID(),
		teacherA: randomUUID(),
		teacherB: randomUUID(),
		classAvailable: randomUUID(),
		classRunning: randomUUID(),
		classFull: randomUUID(),
		classPaused: randomUUID(),
		classOtherCourse: randomUUID(),
		classOtherCampus: randomUUID(),
		classConcurrent: randomUUID(),
		classB: randomUUID(),
		studentMatchingA1: randomUUID(),
		studentMatchingA2: randomUUID(),
		studentOtherA: randomUUID(),
		studentB: randomUUID(),
		leadOptions: randomUUID(),
		leadExisting: randomUUID(),
		leadNew: randomUUID(),
		leadLost: randomUUID(),
		leadCrossTenant: randomUUID(),
		leadCourseMismatch: randomUUID(),
		leadCampusMismatch: randomUUID(),
		leadPausedClass: randomUUID(),
		leadCrossClass: randomUUID(),
		leadRollback: randomUUID(),
		leadConcurrent1: randomUUID(),
		leadConcurrent2: randomUUID(),
		leadConsultantOverride: randomUUID(),
		leadComplimentary: randomUUID(),
		leadB: randomUUID(),
		operatorUserId: `${prefix}-operator`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [ids.organizationA, ids.organizationB];

	await db
		.delete(invoiceArrearsEvent)
		.where(inArray(invoiceArrearsEvent.organizationId, organizationIds));
	await db
		.delete(invoiceArrearsCycle)
		.where(inArray(invoiceArrearsCycle.organizationId, organizationIds));
	await db
		.delete(organizationAuditEvent)
		.where(inArray(organizationAuditEvent.organizationId, organizationIds));
	await db
		.delete(invoice)
		.where(inArray(invoice.organizationId, organizationIds));
	await db
		.delete(enrollment)
		.where(inArray(enrollment.organizationId, organizationIds));
	await db
		.delete(classGroup)
		.where(inArray(classGroup.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db
		.delete(student)
		.where(inArray(student.organizationId, organizationIds));
	await db
		.delete(teacher)
		.where(inArray(teacher.organizationId, organizationIds));
	await db
		.delete(course)
		.where(inArray(course.organizationId, organizationIds));
	await db
		.delete(campus)
		.where(inArray(campus.organizationId, organizationIds));
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
		name: "报名操作人",
		email: `${ids.operatorUserId}@example.invalid`,
	});
	await db.insert(campus).values([
		{
			id: ids.campusA1,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a1`,
			name: "A 一校区",
			city: "上海",
			address: "A1",
		},
		{
			id: ids.campusA2,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-a2`,
			name: "A 二校区",
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
	await db.insert(course).values([
		{
			id: ids.courseA,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-course-a`,
			name: "A 课程",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 12_800,
			lessonsPerPackage: 24,
			tags: [],
		},
		{
			id: ids.courseAOther,
			organizationId: ids.organizationA,
			code: `${ids.prefix}-course-a-other`,
			name: "A 其他课程",
			category: "stem",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_800,
			lessonsPerPackage: 12,
			tags: [],
		},
		{
			id: ids.courseB,
			organizationId: ids.organizationB,
			code: `${ids.prefix}-course-b`,
			name: "B 课程",
			category: "art",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 8_800,
			lessonsPerPackage: 10,
			tags: [],
		},
	]);
	await db.insert(teacher).values([
		{
			id: ids.teacherA,
			organizationId: ids.organizationA,
			name: "A 教师",
			subjects: ["英语"],
		},
		{
			id: ids.teacherB,
			organizationId: ids.organizationB,
			name: "B 教师",
			subjects: ["美术"],
		},
	]);
	await db.insert(classGroup).values([
		{
			id: ids.classAvailable,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 可报名班",
			status: "recruiting",
			capacity: 3,
			scheduleText: "周六 10:00",
			startDate: "2026-08-01",
		},
		{
			id: ids.classRunning,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 进行中班",
			status: "running",
			capacity: 2,
			scheduleText: "周日 10:00",
			startDate: "2026-07-01",
		},
		{
			id: ids.classFull,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 满班",
			status: "running",
			capacity: 1,
			scheduleText: "周日 14:00",
			startDate: "2026-07-01",
		},
		{
			id: ids.classPaused,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 暂停班",
			status: "paused",
			capacity: 10,
			scheduleText: "暂停",
			startDate: "2026-07-01",
		},
		{
			id: ids.classOtherCourse,
			organizationId: ids.organizationA,
			courseId: ids.courseAOther,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 其他课程班",
			status: "recruiting",
			capacity: 10,
			scheduleText: "周一 18:00",
			startDate: "2026-08-01",
		},
		{
			id: ids.classOtherCampus,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA2,
			teacherId: ids.teacherA,
			name: "A 其他校区班",
			status: "recruiting",
			capacity: 10,
			scheduleText: "周二 18:00",
			startDate: "2026-08-01",
		},
		{
			id: ids.classConcurrent,
			organizationId: ids.organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA1,
			teacherId: ids.teacherA,
			name: "A 最后名额班",
			status: "recruiting",
			capacity: 1,
			scheduleText: "周三 18:00",
			startDate: "2026-08-01",
		},
		{
			id: ids.classB,
			organizationId: ids.organizationB,
			courseId: ids.courseB,
			campusId: ids.campusB,
			teacherId: ids.teacherB,
			name: "B 班",
			status: "recruiting",
			capacity: 10,
			scheduleText: "周四 18:00",
			startDate: "2026-08-01",
		},
	]);
	await db.insert(student).values([
		{
			id: ids.studentMatchingA1,
			organizationId: ids.organizationA,
			campusId: ids.campusA1,
			name: "A 匹配学员一",
			guardianName: "A 家长一",
			guardianPhone: "138-0013 (8000)",
			status: "at_risk",
		},
		{
			id: ids.studentMatchingA2,
			organizationId: ids.organizationA,
			campusId: ids.campusA2,
			name: "A 匹配学员二",
			guardianName: "A 家长二",
			guardianPhone: "138 0013 8000",
		},
		{
			id: ids.studentOtherA,
			organizationId: ids.organizationA,
			campusId: ids.campusA1,
			name: "A 其他学员",
			guardianName: "A 其他家长",
			guardianPhone: "13700000000",
		},
		{
			id: ids.studentB,
			organizationId: ids.organizationB,
			campusId: ids.campusB,
			name: "B 同手机号学员",
			guardianName: "B 家长",
			guardianPhone: "13800138000",
		},
	]);
	await db.insert(enrollment).values([
		{
			organizationId: ids.organizationA,
			studentId: ids.studentOtherA,
			courseId: ids.courseA,
			classGroupId: ids.classAvailable,
			purchasedLessons: 10,
			remainingLessons: 8,
		},
		{
			organizationId: ids.organizationA,
			studentId: ids.studentOtherA,
			courseId: ids.courseA,
			classGroupId: ids.classAvailable,
			purchasedLessons: 6,
			remainingLessons: 0,
		},
		{
			organizationId: ids.organizationA,
			studentId: ids.studentOtherA,
			courseId: ids.courseA,
			classGroupId: ids.classFull,
			purchasedLessons: 10,
			remainingLessons: 8,
		},
	]);

	const leadRows = [
		{
			id: ids.leadOptions,
			name: "选项线索",
			phone: "13800138000",
			stage: "trial_booked",
		},
		{
			id: ids.leadExisting,
			name: "已有学员线索",
			phone: "138 0013 8000",
			stage: "contacted",
		},
		{
			id: ids.leadNew,
			name: "新学员线索",
			phone: "139-0000-0000",
			stage: "new",
		},
		{ id: ids.leadLost, name: "流失线索", phone: "13600000000", stage: "lost" },
		{
			id: ids.leadCrossTenant,
			name: "跨机构资源线索",
			phone: "13500000000",
			stage: "new",
		},
		{
			id: ids.leadCourseMismatch,
			name: "课程不匹配线索",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadCampusMismatch,
			name: "校区不匹配线索",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadPausedClass,
			name: "暂停班线索",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadCrossClass,
			name: "跨机构班级线索",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadRollback,
			name: "回滚线索",
			phone: "130-0000-0000",
			stage: "new",
		},
		{
			id: ids.leadConcurrent1,
			name: "并发线索一",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadConcurrent2,
			name: "并发线索二",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadConsultantOverride,
			name: "顾问改价线索",
			phone: "13800138000",
			stage: "new",
		},
		{
			id: ids.leadComplimentary,
			name: "零价报名线索",
			phone: "13800138000",
			stage: "new",
		},
	] as const;

	await db.insert(lead).values([
		...leadRows.map((item) => ({
			...item,
			organizationId: ids.organizationA,
			campusId: ids.campusA1,
			interestedCourseId: ids.courseA,
			source: "integration",
		})),
		{
			id: ids.leadB,
			organizationId: ids.organizationB,
			campusId: ids.campusB,
			interestedCourseId: ids.courseB,
			name: "B 线索",
			phone: "13800138000",
			source: "integration",
			stage: "new",
		},
	]);
}

function baseConversionInput(
	ids: FixtureIds,
	leadId: string,
): ConvertLeadInput {
	return {
		leadId,
		student: { mode: "existing", studentId: ids.studentMatchingA1 },
		courseId: ids.courseA,
		classGroupId: null,
		purchasedLessons: 24,
		amountInCents: 12_800,
		invoiceDueDate: "2026-08-31",
	};
}

async function expectOrpcError(
	promise: Promise<unknown>,
	code: string,
): Promise<void> {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(
			typeof error === "object" &&
				error !== null &&
				"code" in error &&
				typeof error.code === "string",
		);
		assert.equal(error.code, code);
		return true;
	});
}

test("线索转化保持机构隔离、事务原子性并防止并发超额", async () => {
	const ids = createFixtureIds();
	const scopeA = {
		organizationId: ids.organizationA,
		role: "owner" as const,
		userId: ids.operatorUserId,
	};

	try {
		await seedFixture(ids);
		await db.insert(enrollment).values({
			organizationId: ids.organizationA,
			studentId: ids.studentMatchingA1,
			courseId: ids.courseA,
			classGroupId: ids.classAvailable,
			purchasedLessons: 24,
			remainingLessons: 0,
			status: "transferred",
		});

		const options = leadConversionOptionsSchema.parse(
			await getLeadConversionOptions(scopeA, { leadId: ids.leadOptions }),
		);
		assert.equal(options.lead.stage, "trialBooked");
		assert.deepEqual(
			new Set(options.matchingStudents.map((item) => item.id)),
			new Set([ids.studentMatchingA1, ids.studentMatchingA2]),
		);
		assert.equal(
			options.matchingStudents.find((item) => item.id === ids.studentMatchingA1)
				?.status,
			"atRisk",
		);
		assert.ok(
			options.matchingStudents.every((item) => item.id !== ids.studentB),
		);
		assert.deepEqual(
			new Set(options.campuses.map((item) => item.id)),
			new Set([ids.campusA1, ids.campusA2]),
		);
		assert.deepEqual(
			new Set(options.courses.map((item) => item.id)),
			new Set([ids.courseA, ids.courseAOther]),
		);
		const availableClass = options.classes.find(
			(item) => item.id === ids.classAvailable,
		);
		assert.deepEqual(
			availableClass && {
				status: availableClass.status,
				enrollmentCount: availableClass.enrollmentCount,
				seatsRemaining: availableClass.seatsRemaining,
			},
			{ status: "recruiting", enrollmentCount: 1, seatsRemaining: 2 },
		);
		assert.ok(options.classes.some((item) => item.id === ids.classRunning));
		assert.ok(options.classes.every((item) => item.id !== ids.classFull));
		assert.ok(options.classes.every((item) => item.id !== ids.classPaused));
		assert.ok(options.classes.every((item) => item.id !== ids.classB));

		await expectOrpcError(
			getLeadConversionOptions(scopeA, { leadId: ids.leadB }),
			"NOT_FOUND",
		);
		await expectOrpcError(
			convertLead(scopeA, baseConversionInput(ids, ids.leadLost)),
			"CONFLICT",
		);
		await expectOrpcError(
			convertLead(
				{
					organizationId: ids.organizationA,
					role: "consultant",
					userId: ids.operatorUserId,
				},
				{
					...baseConversionInput(ids, ids.leadConsultantOverride),
					purchasedLessons: 1000,
					amountInCents: 0,
				},
			),
			"FORBIDDEN",
		);
		const consultantOverrideEnrollments = await db
			.select({ id: enrollment.id })
			.from(enrollment)
			.where(eq(enrollment.leadId, ids.leadConsultantOverride));
		assert.equal(consultantOverrideEnrollments.length, 0);

		const existingResult = await convertLead(scopeA, {
			...baseConversionInput(ids, ids.leadExisting),
			classGroupId: ids.classAvailable,
			purchasedLessons: 30,
			amountInCents: 18_600,
		});
		assert.equal(existingResult.studentId, ids.studentMatchingA1);
		const [existingEnrollment] = await db
			.select()
			.from(enrollment)
			.where(eq(enrollment.id, existingResult.enrollmentId));
		assert.deepEqual(
			existingEnrollment && {
				leadId: existingEnrollment.leadId,
				studentId: existingEnrollment.studentId,
				courseId: existingEnrollment.courseId,
				classGroupId: existingEnrollment.classGroupId,
				purchasedLessons: existingEnrollment.purchasedLessons,
				remainingLessons: existingEnrollment.remainingLessons,
				amountInCents: existingEnrollment.amountInCents,
			},
			{
				leadId: ids.leadExisting,
				studentId: ids.studentMatchingA1,
				courseId: ids.courseA,
				classGroupId: ids.classAvailable,
				purchasedLessons: 30,
				remainingLessons: 30,
				amountInCents: 18_600,
			},
		);
		const [existingInvoice] = await db
			.select()
			.from(invoice)
			.where(eq(invoice.id, existingResult.invoiceId));
		assert.deepEqual(
			existingInvoice && {
				organizationId: existingInvoice.organizationId,
				studentId: existingInvoice.studentId,
				enrollmentId: existingInvoice.enrollmentId,
				amountInCents: existingInvoice.amountInCents,
				paidAmountInCents: existingInvoice.paidAmountInCents,
				status: existingInvoice.status,
				dueDate: existingInvoice.dueDate,
			},
			{
				organizationId: ids.organizationA,
				studentId: ids.studentMatchingA1,
				enrollmentId: existingResult.enrollmentId,
				amountInCents: 18_600,
				paidAmountInCents: 0,
				status: "pending",
				dueDate: "2026-08-31",
			},
		);
		const complimentaryResult = await convertLead(
			scopeA,
			convertLeadInputSchema.parse({
				...baseConversionInput(ids, ids.leadComplimentary),
				student: { mode: "existing", studentId: ids.studentMatchingA2 },
				amountInCents: 0,
			}),
		);
		const [complimentaryInvoice] = await db
			.select()
			.from(invoice)
			.where(eq(invoice.id, complimentaryResult.invoiceId));
		assert.equal(complimentaryInvoice?.amountInCents, 0);
		assert.equal(complimentaryInvoice?.paidAmountInCents, 0);
		assert.equal(complimentaryInvoice?.status, "paid");
		assert.ok(complimentaryInvoice?.paidAt instanceof Date);

		const newResult = await convertLead(scopeA, {
			...baseConversionInput(ids, ids.leadNew),
			student: {
				mode: "new",
				name: "新学员",
				guardianName: "新家长",
				campusId: ids.campusA1,
			},
		});
		const [createdStudent] = await db
			.select()
			.from(student)
			.where(eq(student.id, newResult.studentId));
		assert.deepEqual(
			createdStudent && {
				organizationId: createdStudent.organizationId,
				campusId: createdStudent.campusId,
				guardianPhone: createdStudent.guardianPhone,
				status: createdStudent.status,
			},
			{
				organizationId: ids.organizationA,
				campusId: ids.campusA1,
				guardianPhone: "139-0000-0000",
				status: "active",
			},
		);
		await expectOrpcError(
			convertLead(scopeA, baseConversionInput(ids, ids.leadExisting)),
			"CONFLICT",
		);
		const duplicateRows = await db
			.select({ id: enrollment.id })
			.from(enrollment)
			.where(
				and(
					eq(enrollment.organizationId, ids.organizationA),
					eq(enrollment.leadId, ids.leadExisting),
				),
			);
		assert.equal(duplicateRows.length, 1);

		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadCrossTenant),
				student: { mode: "existing", studentId: ids.studentB },
			}),
			"NOT_FOUND",
		);
		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadCrossTenant),
				student: { mode: "existing", studentId: ids.studentOtherA },
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadCourseMismatch),
				student: {
					mode: "new",
					name: "课程不匹配学员",
					guardianName: "课程不匹配家长",
					campusId: ids.campusA1,
				},
				classGroupId: ids.classOtherCourse,
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadCampusMismatch),
				student: {
					mode: "new",
					name: "校区不匹配学员",
					guardianName: "校区不匹配家长",
					campusId: ids.campusA1,
				},
				classGroupId: ids.classOtherCampus,
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadPausedClass),
				student: {
					mode: "new",
					name: "暂停班学员",
					guardianName: "暂停班家长",
					campusId: ids.campusA1,
				},
				classGroupId: ids.classPaused,
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadCrossClass),
				student: {
					mode: "new",
					name: "跨机构班级学员",
					guardianName: "跨机构班级家长",
					campusId: ids.campusA1,
				},
				classGroupId: ids.classB,
			}),
			"NOT_FOUND",
		);

		await expectOrpcError(
			convertLead(scopeA, {
				...baseConversionInput(ids, ids.leadRollback),
				student: {
					mode: "new",
					name: "应回滚学员",
					guardianName: "应回滚家长",
					campusId: ids.campusA1,
				},
				classGroupId: ids.classFull,
			}),
			"CONFLICT",
		);
		const [rolledBackLead] = await db
			.select({ stage: lead.stage })
			.from(lead)
			.where(eq(lead.id, ids.leadRollback));
		const rolledBackStudents = await db
			.select({ id: student.id })
			.from(student)
			.where(
				and(
					eq(student.organizationId, ids.organizationA),
					eq(student.guardianPhone, "130-0000-0000"),
				),
			);
		const rolledBackEnrollments = await db
			.select({ id: enrollment.id })
			.from(enrollment)
			.where(eq(enrollment.leadId, ids.leadRollback));
		const rolledBackInvoices = await db
			.select({ id: invoice.id })
			.from(invoice)
			.innerJoin(enrollment, eq(enrollment.id, invoice.enrollmentId))
			.where(eq(enrollment.leadId, ids.leadRollback));
		assert.equal(rolledBackLead?.stage, "new");
		assert.equal(rolledBackStudents.length, 0);
		assert.equal(rolledBackEnrollments.length, 0);
		assert.equal(rolledBackInvoices.length, 0);

		const concurrentInputs = [ids.leadConcurrent1, ids.leadConcurrent2].map(
			(leadId, index) => ({
				...baseConversionInput(ids, leadId),
				student: {
					mode: "new" as const,
					name: `并发学员 ${index}`,
					guardianName: `并发家长 ${index}`,
					campusId: ids.campusA1,
				},
				classGroupId: ids.classConcurrent,
			}),
		);
		const concurrentResults = await Promise.allSettled(
			concurrentInputs.map((input) => convertLead(scopeA, input)),
		);
		assert.equal(
			concurrentResults.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		const [concurrentFailure] = concurrentResults.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		assert.ok(
			typeof concurrentFailure?.reason === "object" &&
				concurrentFailure.reason !== null &&
				"code" in concurrentFailure.reason,
		);
		assert.equal(concurrentFailure.reason.code, "CONFLICT");
		const concurrentEnrollments = await db
			.select({ leadId: enrollment.leadId })
			.from(enrollment)
			.where(eq(enrollment.classGroupId, ids.classConcurrent));
		const concurrentLeads = await db
			.select({ id: lead.id, stage: lead.stage })
			.from(lead)
			.where(inArray(lead.id, [ids.leadConcurrent1, ids.leadConcurrent2]));
		assert.equal(concurrentEnrollments.length, 1);
		assert.deepEqual(
			new Set(concurrentLeads.map((item) => item.stage)),
			new Set(["new", "enrolled"]),
		);
	} finally {
		await cleanupFixture(ids);
	}
});
