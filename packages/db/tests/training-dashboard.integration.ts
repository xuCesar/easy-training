import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import { dashboardSnapshotSchema } from "../../api/src/contracts/training";
import { getTrainingDashboardSnapshot } from "../../api/src/repositories/training-dashboard";
import { db } from "../src";
import { getDashboardLearningSummary } from "../src/repositories/training-dashboard";
import {
	campus,
	classGroup,
	course,
	enrollment,
	invoice,
	lead,
	lesson,
	operationTask,
	organization,
	organizationMember,
	student,
	teacher,
	user,
} from "../src/schema";

const now = new Date("2026-07-17T04:00:00.000Z");
const nextDayStart = new Date("2026-07-17T16:00:00.000Z");
const lessonWindowEnd = new Date("2026-07-23T16:00:00.000Z");

function createFixtureIds() {
	const prefix = `dashboard-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;

	return {
		prefix,
		organizationIds: [randomUUID(), randomUUID(), randomUUID()] as const,
		campusA: randomUUID(),
		campusB: randomUUID(),
		courseA: randomUUID(),
		courseB: randomUUID(),
		teacherA: randomUUID(),
		teacherOtherA: randomUUID(),
		teacherB: randomUUID(),
		classRunningA: randomUUID(),
		classRecruitingA: randomUUID(),
		classPausedA: randomUUID(),
		classRunningB: randomUUID(),
		studentA1: randomUUID(),
		studentA2: randomUUID(),
		studentB: randomUUID(),
		enrollmentA1: randomUUID(),
		enrollmentA2: randomUUID(),
		enrollmentB: randomUUID(),
		ownerA: `${prefix}-owner-a`,
		teacherUserA: `${prefix}-teacher-a`,
		financeA: `${prefix}-finance-a`,
		otherA: `${prefix}-other-a`,
		ownerB: `${prefix}-owner-b`,
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

function getUserIds(ids: FixtureIds) {
	return [ids.ownerA, ids.teacherUserA, ids.financeA, ids.otherA, ids.ownerB];
}

async function cleanupFixture(ids: FixtureIds) {
	const organizationIds = [...ids.organizationIds];

	await db
		.delete(invoice)
		.where(inArray(invoice.organizationId, organizationIds));
	await db
		.delete(lesson)
		.where(inArray(lesson.organizationId, organizationIds));
	await db
		.delete(enrollment)
		.where(inArray(enrollment.organizationId, organizationIds));
	await db
		.delete(classGroup)
		.where(inArray(classGroup.organizationId, organizationIds));
	await db.delete(lead).where(inArray(lead.organizationId, organizationIds));
	await db
		.delete(operationTask)
		.where(inArray(operationTask.organizationId, organizationIds));
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
		.delete(organizationMember)
		.where(inArray(organizationMember.organizationId, organizationIds));
	await db
		.delete(organization)
		.where(inArray(organization.id, organizationIds));
	await db.delete(user).where(inArray(user.id, getUserIds(ids)));
}

async function seedFixture(ids: FixtureIds) {
	const [organizationA, organizationB, emptyOrganization] = ids.organizationIds;
	const userIds = getUserIds(ids);

	await db.insert(user).values(
		userIds.map((id, index) => ({
			id,
			name: `测试用户 ${index}`,
			email: `${id}@example.invalid`,
		})),
	);
	await db.insert(organization).values([
		{ id: organizationA, name: `${ids.prefix} A` },
		{ id: organizationB, name: `${ids.prefix} B` },
		{ id: emptyOrganization, name: `${ids.prefix} Empty` },
	]);
	await db.insert(organizationMember).values([
		{ organizationId: organizationA, userId: ids.ownerA, role: "owner" },
		{
			organizationId: organizationA,
			userId: ids.teacherUserA,
			role: "teacher",
		},
		{ organizationId: organizationA, userId: ids.financeA, role: "finance" },
		{
			organizationId: organizationA,
			userId: ids.otherA,
			role: "consultant",
		},
		{ organizationId: organizationB, userId: ids.ownerB, role: "owner" },
	]);
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: organizationA,
			code: `${ids.prefix}-campus-a`,
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusB,
			organizationId: organizationB,
			code: `${ids.prefix}-campus-b`,
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	await db.insert(course).values([
		{
			id: ids.courseA,
			organizationId: organizationA,
			code: `${ids.prefix}-course-a`,
			name: "A 课程",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 10_000,
			lessonsPerPackage: 10,
			tags: [],
		},
		{
			id: ids.courseB,
			organizationId: organizationB,
			code: `${ids.prefix}-course-b`,
			name: "B 课程",
			category: "stem",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 10_000,
			lessonsPerPackage: 10,
			tags: [],
		},
	]);
	await db.insert(teacher).values([
		{
			id: ids.teacherA,
			organizationId: organizationA,
			userId: ids.teacherUserA,
			name: "A 当前教师",
			subjects: ["英语"],
		},
		{
			id: ids.teacherOtherA,
			organizationId: organizationA,
			userId: ids.otherA,
			name: "A 其他教师",
			subjects: ["数学"],
		},
		{
			id: ids.teacherB,
			organizationId: organizationB,
			userId: ids.ownerB,
			name: "B 教师",
			subjects: ["科学"],
		},
	]);
	await db.insert(classGroup).values([
		{
			id: ids.classRunningA,
			organizationId: organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA,
			teacherId: ids.teacherA,
			name: "A 进行中班级",
			status: "running",
			capacity: 20,
			scheduleText: "fixture",
			startDate: "2026-07-01",
		},
		{
			id: ids.classRecruitingA,
			organizationId: organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA,
			teacherId: ids.teacherOtherA,
			name: "A 招生中班级",
			status: "recruiting",
			capacity: 20,
			scheduleText: "fixture",
			startDate: "2026-07-01",
		},
		{
			id: ids.classPausedA,
			organizationId: organizationA,
			courseId: ids.courseA,
			campusId: ids.campusA,
			teacherId: ids.teacherA,
			name: "A 暂停班级",
			status: "paused",
			capacity: 20,
			scheduleText: "fixture",
			startDate: "2026-07-01",
		},
		{
			id: ids.classRunningB,
			organizationId: organizationB,
			courseId: ids.courseB,
			campusId: ids.campusB,
			teacherId: ids.teacherB,
			name: "B 进行中班级",
			status: "running",
			capacity: 20,
			scheduleText: "fixture",
			startDate: "2026-07-01",
		},
	]);
	await db.insert(student).values([
		{
			id: ids.studentA1,
			organizationId: organizationA,
			campusId: ids.campusA,
			name: "A 学员 1",
			guardianName: "A 家长 1",
			guardianPhone: `${ids.prefix}-student-a-1`,
		},
		{
			id: ids.studentA2,
			organizationId: organizationA,
			campusId: ids.campusA,
			name: "A 学员 2",
			guardianName: "A 家长 2",
			guardianPhone: `${ids.prefix}-student-a-2`,
		},
		{
			id: ids.studentB,
			organizationId: organizationB,
			campusId: ids.campusB,
			name: "B 学员",
			guardianName: "B 家长",
			guardianPhone: `${ids.prefix}-student-b`,
		},
	]);
	await db.insert(enrollment).values([
		{
			id: ids.enrollmentA1,
			organizationId: organizationA,
			studentId: ids.studentA1,
			courseId: ids.courseA,
			classGroupId: ids.classRunningA,
			purchasedLessons: 10,
			remainingLessons: 10,
		},
		{
			id: ids.enrollmentA2,
			organizationId: organizationA,
			studentId: ids.studentA2,
			courseId: ids.courseA,
			classGroupId: ids.classRecruitingA,
			purchasedLessons: 10,
			remainingLessons: 8,
		},
		{
			id: ids.enrollmentB,
			organizationId: organizationB,
			studentId: ids.studentB,
			courseId: ids.courseB,
			classGroupId: ids.classRunningB,
			purchasedLessons: 10,
			remainingLessons: 10,
		},
	]);

	const openLeadIds: string[] = Array.from({ length: 7 }, () => randomUUID());
	await db.insert(lead).values([
		...openLeadIds.map((id, index) => ({
			id,
			organizationId: organizationA,
			campusId: ids.campusA,
			interestedCourseId: ids.courseA,
			ownerUserId: ids.otherA,
			name: `A 开放线索 ${index}`,
			phone: `${ids.prefix}-lead-${index}`,
			source: "fixture",
			stage: (["new", "contacted", "trial_booked"] as const)[index % 3],
			nextFollowAt: new Date(now.getTime() + index * 60_000),
		})),
		{
			organizationId: organizationA,
			name: "A 已流失",
			phone: `${ids.prefix}-lost`,
			source: "fixture",
			stage: "lost",
		},
		{
			organizationId: organizationA,
			name: "A 已报名",
			phone: `${ids.prefix}-enrolled`,
			source: "fixture",
			stage: "enrolled",
		},
		{
			organizationId: organizationB,
			name: "B 开放线索",
			phone: `${ids.prefix}-lead-b`,
			source: "fixture",
			stage: "new",
		},
	]);

	await db.insert(operationTask).values([
		{
			organizationId: organizationA,
			ownerUserId: ids.otherA,
			title: "A 已逾期待办",
			module: "enrollment",
			priority: "high",
			dueAt: new Date(now.getTime() - 1),
		},
		{
			organizationId: organizationA,
			ownerUserId: ids.financeA,
			title: "A 当前时刻待办",
			module: "finance",
			priority: "medium",
			dueAt: now,
		},
		{
			organizationId: organizationA,
			ownerUserId: ids.teacherUserA,
			title: "A 今日末尾待办",
			module: "academic",
			priority: "low",
			dueAt: new Date(nextDayStart.getTime() - 1),
		},
		{
			organizationId: organizationA,
			ownerUserId: ids.teacherUserA,
			title: "A 次日边界排除",
			module: "academic",
			dueAt: nextDayStart,
		},
		{
			organizationId: organizationA,
			ownerUserId: ids.ownerA,
			title: "A 已完成排除",
			module: "student_service",
			dueAt: new Date(now.getTime() - 60_000),
			completedAt: now,
		},
		{
			organizationId: organizationB,
			ownerUserId: ids.ownerB,
			title: "B 待办",
			module: "enrollment",
			dueAt: now,
		},
	]);

	await db.insert(lesson).values([
		{
			organizationId: organizationA,
			classGroupId: ids.classRunningA,
			teacherId: ids.teacherA,
			campusId: ids.campusA,
			room: "A1",
			startsAt: now,
			endsAt: new Date(now.getTime() + 3_600_000),
			status: "scheduled",
		},
		{
			organizationId: organizationA,
			classGroupId: ids.classRunningA,
			teacherId: ids.teacherOtherA,
			campusId: ids.campusA,
			room: "A2",
			startsAt: new Date(lessonWindowEnd.getTime() - 1),
			endsAt: new Date(lessonWindowEnd.getTime() + 3_600_000),
			status: "scheduled",
		},
		{
			organizationId: organizationA,
			classGroupId: ids.classRunningA,
			teacherId: ids.teacherA,
			campusId: ids.campusA,
			room: "A3",
			startsAt: lessonWindowEnd,
			endsAt: new Date(lessonWindowEnd.getTime() + 3_600_000),
			status: "scheduled",
		},
		{
			organizationId: organizationA,
			classGroupId: ids.classRunningA,
			teacherId: ids.teacherA,
			campusId: ids.campusA,
			room: "A4",
			startsAt: new Date(now.getTime() + 60_000),
			endsAt: new Date(now.getTime() + 3_660_000),
			status: "completed",
		},
		{
			organizationId: organizationA,
			classGroupId: ids.classRunningA,
			teacherId: ids.teacherA,
			campusId: ids.campusA,
			room: "A5",
			startsAt: new Date(now.getTime() - 1),
			endsAt: new Date(now.getTime() + 3_600_000),
			status: "scheduled",
		},
		{
			organizationId: organizationB,
			classGroupId: ids.classRunningB,
			teacherId: ids.teacherB,
			campusId: ids.campusB,
			room: "B1",
			startsAt: now,
			endsAt: new Date(now.getTime() + 3_600_000),
			status: "scheduled",
		},
	]);

	const invoiceAmounts = [7_500, 4_000, 3_000, 2_000, 1_000];
	await db.insert(invoice).values([
		{
			organizationId: organizationA,
			studentId: ids.studentA1,
			enrollmentId: ids.enrollmentA1,
			amountInCents: 10_000,
			paidAmountInCents: 2_500,
			status: "partial",
			dueDate: "2026-07-17",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA1,
			enrollmentId: ids.enrollmentA1,
			amountInCents: 4_000,
			paidAmountInCents: 0,
			status: "pending",
			dueDate: "2026-07-16",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA1,
			enrollmentId: ids.enrollmentA1,
			amountInCents: 3_000,
			paidAmountInCents: 0,
			status: "overdue",
			dueDate: "2026-07-20",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA2,
			enrollmentId: ids.enrollmentA2,
			amountInCents: 2_000,
			paidAmountInCents: 0,
			status: "pending",
			dueDate: "2026-07-18",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA2,
			enrollmentId: ids.enrollmentA2,
			amountInCents: 1_000,
			paidAmountInCents: 0,
			status: "pending",
			dueDate: "2026-07-19",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA1,
			amountInCents: 8_000,
			paidAmountInCents: 8_000,
			status: "pending",
			dueDate: "2026-07-16",
		},
		{
			organizationId: organizationA,
			studentId: ids.studentA1,
			amountInCents: 9_000,
			paidAmountInCents: 9_000,
			status: "paid",
			dueDate: "2026-07-16",
		},
		{
			organizationId: organizationB,
			studentId: ids.studentB,
			enrollmentId: ids.enrollmentB,
			amountInCents: 999,
			paidAmountInCents: 0,
			status: "pending",
			dueDate: "2026-07-17",
		},
	]);

	return { invoiceAmounts, openLeadIds };
}

test("机构运营工作台按机构、时间窗口和角色返回一致数据", async () => {
	const ids = createFixtureIds();
	const [organizationA, organizationB, emptyOrganization] = ids.organizationIds;

	try {
		const { invoiceAmounts, openLeadIds } = await seedFixture(ids);
		const ownerA = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{ organizationId: organizationA, userId: ids.ownerA, role: "owner" },
				now,
			),
		);
		const ownerB = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{ organizationId: organizationB, userId: ids.ownerB, role: "owner" },
				now,
			),
		);
		const emptyOwner = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{
					organizationId: emptyOrganization,
					userId: ids.ownerA,
					role: "owner",
				},
				now,
			),
		);
		const teacherA = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{
					organizationId: organizationA,
					userId: ids.teacherUserA,
					role: "teacher",
				},
				now,
			),
		);
		const financeA = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{
					organizationId: organizationA,
					userId: ids.financeA,
					role: "finance",
				},
				now,
			),
		);
		const consultantA = dashboardSnapshotSchema.parse(
			await getTrainingDashboardSnapshot(
				{
					organizationId: organizationA,
					userId: ids.otherA,
					role: "consultant",
				},
				now,
			),
		);

		assert.deepEqual(ownerA.permissions, {
			canViewLeads: true,
			canViewFinance: true,
		});
		assert.equal(ownerA.metrics.followUpCount, 7);
		assert.equal(ownerA.followUps.length, 5);
		assert.ok(ownerA.followUps.every((item) => openLeadIds.includes(item.id)));
		const openStages: string[] = ["new", "contacted", "trialBooked"];
		assert.ok(
			ownerA.followUps.every((item) => openStages.includes(item.stage)),
		);

		assert.equal(ownerA.metrics.dueTaskCount, 3);
		assert.deepEqual(
			new Set(ownerA.tasks.map((item) => item.title)),
			new Set(["A 已逾期待办", "A 当前时刻待办", "A 今日末尾待办"]),
		);
		assert.equal(ownerA.metrics.upcomingLessonCount, 2);
		assert.deepEqual(
			ownerA.upcomingLessons.map((item) => item.room),
			["A1", "A2"],
		);

		assert.equal(ownerA.metrics.pendingInvoiceCount, 5);
		assert.equal(ownerA.receivables.length, 4);
		assert.equal(
			ownerA.metrics.outstandingAmountInCents,
			invoiceAmounts.reduce((total, amount) => total + amount, 0),
		);
		assert.ok(
			ownerA.receivables.reduce(
				(total, item) => total + item.outstandingAmountInCents,
				0,
			) < (ownerA.metrics.outstandingAmountInCents ?? 0),
		);
		assert.equal(
			ownerA.receivables.find((item) => item.dueDate === "2026-07-16")?.status,
			"overdue",
		);
		assert.equal(
			ownerA.receivables.find((item) => item.dueDate === "2026-07-17")?.status,
			"pending",
		);

		assert.deepEqual(
			await getDashboardLearningSummary({ organizationId: organizationA }),
			{ studentCount: 2, enrollmentCount: 2, activeClassCount: 2 },
		);
		assert.deepEqual(
			{
				studentCount: ownerA.metrics.studentCount,
				enrollmentCount: ownerA.metrics.enrollmentCount,
				activeClassCount: ownerA.metrics.activeClassCount,
			},
			{ studentCount: 2, enrollmentCount: 2, activeClassCount: 2 },
		);

		assert.deepEqual(consultantA.permissions, {
			canViewLeads: true,
			canViewFinance: false,
		});
		assert.equal(consultantA.metrics.followUpCount, 7);
		assert.equal(consultantA.followUps.length, 5);
		assert.equal(consultantA.metrics.pendingInvoiceCount, null);
		assert.equal(consultantA.metrics.outstandingAmountInCents, null);
		assert.deepEqual(consultantA.receivables, []);
		assert.equal(consultantA.metrics.dueTaskCount, 1);
		assert.deepEqual(
			consultantA.tasks.map((item) => item.title),
			["A 已逾期待办"],
		);
		assert.equal(consultantA.metrics.upcomingLessonCount, 2);

		assert.deepEqual(
			{
				leads: ownerB.metrics.followUpCount,
				tasks: ownerB.metrics.dueTaskCount,
				lessons: ownerB.metrics.upcomingLessonCount,
				invoices: ownerB.metrics.pendingInvoiceCount,
				amount: ownerB.metrics.outstandingAmountInCents,
				students: ownerB.metrics.studentCount,
				enrollments: ownerB.metrics.enrollmentCount,
				activeClasses: ownerB.metrics.activeClassCount,
			},
			{
				leads: 1,
				tasks: 1,
				lessons: 1,
				invoices: 1,
				amount: 999,
				students: 1,
				enrollments: 1,
				activeClasses: 1,
			},
		);
		assert.ok(ownerB.followUps.every((item) => item.name.startsWith("B ")));
		assert.ok(ownerB.tasks.every((item) => item.title.startsWith("B ")));
		assert.ok(
			ownerB.upcomingLessons.every((item) => item.room.startsWith("B")),
		);
		assert.ok(
			ownerB.receivables.every((item) => item.studentName.startsWith("B ")),
		);

		assert.deepEqual(emptyOwner.metrics, {
			followUpCount: 0,
			dueTaskCount: 0,
			upcomingLessonCount: 0,
			pendingInvoiceCount: 0,
			outstandingAmountInCents: 0,
			studentCount: 0,
			enrollmentCount: 0,
			activeClassCount: 0,
		});
		assert.deepEqual(emptyOwner.followUps, []);
		assert.deepEqual(emptyOwner.tasks, []);
		assert.deepEqual(emptyOwner.upcomingLessons, []);
		assert.deepEqual(emptyOwner.receivables, []);

		assert.deepEqual(teacherA.permissions, {
			canViewLeads: false,
			canViewFinance: false,
		});
		assert.equal(teacherA.metrics.followUpCount, null);
		assert.equal(teacherA.metrics.pendingInvoiceCount, null);
		assert.equal(teacherA.metrics.outstandingAmountInCents, null);
		assert.deepEqual(teacherA.followUps, []);
		assert.deepEqual(teacherA.receivables, []);
		assert.equal(teacherA.metrics.dueTaskCount, 1);
		assert.deepEqual(
			teacherA.tasks.map((item) => item.title),
			["A 今日末尾待办"],
		);
		assert.equal(teacherA.metrics.upcomingLessonCount, 1);
		assert.deepEqual(
			teacherA.upcomingLessons.map((item) => item.room),
			["A1"],
		);
		assert.deepEqual(
			{
				studentCount: teacherA.metrics.studentCount,
				enrollmentCount: teacherA.metrics.enrollmentCount,
				activeClassCount: teacherA.metrics.activeClassCount,
			},
			{ studentCount: 2, enrollmentCount: 2, activeClassCount: 2 },
		);

		assert.deepEqual(financeA.permissions, {
			canViewLeads: false,
			canViewFinance: true,
		});
		assert.equal(financeA.metrics.followUpCount, null);
		assert.deepEqual(financeA.followUps, []);
		assert.equal(financeA.metrics.pendingInvoiceCount, 5);
		assert.equal(financeA.metrics.outstandingAmountInCents, 17_500);
		assert.equal(financeA.receivables.length, 4);
		assert.equal(financeA.metrics.dueTaskCount, 1);
		assert.deepEqual(
			financeA.tasks.map((item) => item.title),
			["A 当前时刻待办"],
		);
		assert.deepEqual(
			{
				studentCount: financeA.metrics.studentCount,
				enrollmentCount: financeA.metrics.enrollmentCount,
				activeClassCount: financeA.metrics.activeClassCount,
			},
			{ studentCount: 2, enrollmentCount: 2, activeClassCount: 2 },
		);
	} finally {
		await cleanupFixture(ids);
	}
});
