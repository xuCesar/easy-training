import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	assignEnrollmentClassRecord,
	cancelLessonRecord,
	completeLessonRecord,
	createClassGroupRecord,
	createCourseRecord,
	createLessonRecord,
	createTeacherRecord,
	getLessonAttendanceRecord,
	listClassEnrollmentRecords,
	TeachingRepositoryError,
	updateClassGroupRecord,
	updateCourseRecord,
} from "../src/repositories/teaching";
import {
	attendance,
	campus,
	classGroup,
	course,
	enrollment,
	lesson,
	lessonConsumption,
	organization,
	organizationMember,
	organizationMemberCampus,
	student,
	teacher,
	teacherCampus,
	user,
} from "../src/schema";

function createFixtureIds() {
	const prefix = `teaching-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizationId: randomUUID(),
		campusA: randomUUID(),
		campusB: randomUUID(),
		adminId: `${prefix}-admin`,
		managerId: `${prefix}-manager`,
		managerMembershipId: randomUUID(),
	};
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

async function cleanup(ids: FixtureIds) {
	await db
		.delete(lessonConsumption)
		.where(eq(lessonConsumption.organizationId, ids.organizationId));
	const lessonIds = (
		await db
			.select({ id: lesson.id })
			.from(lesson)
			.where(eq(lesson.organizationId, ids.organizationId))
	).map((item) => item.id);
	if (lessonIds.length > 0) {
		await db.delete(attendance).where(inArray(attendance.lessonId, lessonIds));
	}
	await db
		.delete(enrollment)
		.where(eq(enrollment.organizationId, ids.organizationId));
	await db.delete(lesson).where(eq(lesson.organizationId, ids.organizationId));
	await db
		.delete(classGroup)
		.where(eq(classGroup.organizationId, ids.organizationId));
	await db
		.delete(student)
		.where(eq(student.organizationId, ids.organizationId));
	await db
		.delete(teacherCampus)
		.where(inArray(teacherCampus.campusId, [ids.campusA, ids.campusB]));
	await db
		.delete(teacher)
		.where(eq(teacher.organizationId, ids.organizationId));
	await db.delete(course).where(eq(course.organizationId, ids.organizationId));
	await db
		.delete(organizationMemberCampus)
		.where(
			eq(
				organizationMemberCampus.organizationMemberId,
				ids.managerMembershipId,
			),
		);
	await db
		.delete(organizationMember)
		.where(eq(organizationMember.organizationId, ids.organizationId));
	await db.delete(campus).where(eq(campus.organizationId, ids.organizationId));
	await db.delete(organization).where(eq(organization.id, ids.organizationId));
	await db.delete(user).where(inArray(user.id, [ids.adminId, ids.managerId]));
}

async function seed(ids: FixtureIds) {
	await db.insert(user).values([
		{
			id: ids.adminId,
			name: "教务管理员",
			email: `${ids.prefix}-admin@example.invalid`,
		},
		{
			id: ids.managerId,
			name: "校区负责人",
			email: `${ids.prefix}-manager@example.invalid`,
		},
	]);
	await db
		.insert(organization)
		.values({ id: ids.organizationId, name: "教学测试机构" });
	await db.insert(organizationMember).values([
		{ organizationId: ids.organizationId, userId: ids.adminId, role: "admin" },
		{
			id: ids.managerMembershipId,
			organizationId: ids.organizationId,
			userId: ids.managerId,
			role: "campus_manager",
			campusAccessMode: "selected",
		},
	]);
	await db.insert(campus).values([
		{
			id: ids.campusA,
			organizationId: ids.organizationId,
			code: `${ids.prefix}-a`,
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: ids.campusB,
			organizationId: ids.organizationId,
			code: `${ids.prefix}-b`,
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	await db.insert(organizationMemberCampus).values({
		organizationMemberId: ids.managerMembershipId,
		campusId: ids.campusA,
	});
}

async function expectError(
	promise: Promise<unknown>,
	code: TeachingRepositoryError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof TeachingRepositoryError);
		assert.equal(error.code, code);
		return true;
	});
}

function courseUpdateData(
	record: {
		code: string;
		name: string;
		category: "language" | "stem" | "art" | "exam" | "sports";
		level: string;
		listPriceInCents: number;
		lessonsPerPackage: number;
		tags: string[];
	},
	durationMinutes: number,
) {
	return { ...record, durationMinutes };
}

async function createClassFixture(
	ids: FixtureIds,
	input?: { capacity?: number; campusId?: string; courseId?: string },
) {
	const trainingCourse = input?.courseId
		? null
		: await createCourseRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				code: `C-${randomUUID().slice(0, 8)}`,
				name: "考勤测试课程",
				category: "language",
				level: "L1",
				durationMinutes: 60,
				listPriceInCents: 12_800,
				lessonsPerPackage: 12,
				tags: [],
			});
	const campusId = input?.campusId ?? ids.campusA;
	const instructor = await createTeacherRecord({
		organizationId: ids.organizationId,
		userId: ids.adminId,
		name: `教师-${randomUUID().slice(0, 6)}`,
		phone: null,
		subjects: ["英语"],
		weeklyCapacityHours: 20,
		campusIds: [campusId],
	});
	const group = await createClassGroupRecord({
		organizationId: ids.organizationId,
		userId: ids.adminId,
		name: `测试班-${randomUUID().slice(0, 6)}`,
		campusId,
		courseId: input?.courseId ?? trainingCourse?.id ?? "",
		teacherId: instructor.id,
		capacity: input?.capacity ?? 10,
		startDate: "2026-08-01",
	});
	return { course: trainingCourse, group };
}

async function createEnrollmentFixture(input: {
	ids: FixtureIds;
	courseId: string;
	classGroupId: string | null;
	studentId?: string;
	studentName?: string;
	remainingLessons?: number;
}) {
	const studentId = input.studentId ?? randomUUID();
	if (!input.studentId) {
		await db.insert(student).values({
			id: studentId,
			organizationId: input.ids.organizationId,
			campusId: input.ids.campusA,
			name: input.studentName ?? "测试学员",
			guardianName: "测试家长",
			guardianPhone: `139${randomUUID().replace(/-/gu, "").slice(0, 8)}`,
		});
	}
	const remainingLessons = input.remainingLessons ?? 3;
	const enrollmentId = randomUUID();
	await db.insert(enrollment).values({
		id: enrollmentId,
		organizationId: input.ids.organizationId,
		studentId,
		courseId: input.courseId,
		classGroupId: input.classGroupId,
		purchasedLessons: Math.max(remainingLessons, 1),
		remainingLessons,
	});
	return { enrollmentId, studentId };
}

function classUpdateData(
	record: Awaited<ReturnType<typeof createClassGroupRecord>>,
	status: Awaited<ReturnType<typeof createClassGroupRecord>>["status"],
) {
	return {
		name: record.name,
		campusId: record.campusId,
		courseId: record.courseId,
		teacherId: record.teacherId,
		capacity: record.capacity,
		status,
		startDate: record.startDate,
	};
}

test("校区负责人只能在授权校区开班，课次冲突和取消状态保持一致", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const trainingCourse = await createCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			code: "ENG-01",
			name: "英语启蒙",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 12_800,
			lessonsPerPackage: 16,
			tags: ["启蒙"],
		});
		const instructor = await createTeacherRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			name: "王老师",
			phone: null,
			subjects: ["英语"],
			weeklyCapacityHours: 20,
			campusIds: [ids.campusA],
		});
		const classA = await createClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			name: "周六上午班",
			campusId: ids.campusA,
			courseId: trainingCourse.id,
			teacherId: instructor.id,
			capacity: 12,
			startDate: "2026-08-01",
		});

		await expectError(
			createClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				name: "越权班",
				campusId: ids.campusB,
				courseId: trainingCourse.id,
				teacherId: instructor.id,
				capacity: 12,
				startDate: "2026-08-01",
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);

		const first = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			classGroupId: classA.id,
			room: " A201 ",
			startsAt: new Date("2026-08-01T02:00:00.000Z"),
			endsAt: new Date("2026-08-01T03:00:00.000Z"),
		});
		assert.equal(first.room, "a201");
		await expectError(
			createLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				classGroupId: classA.id,
				room: "A202",
				startsAt: new Date("2026-08-01T02:30:00.000Z"),
				endsAt: new Date("2026-08-01T03:30:00.000Z"),
			}),
			"LESSON_CONFLICT",
		);
		const adjacent = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			classGroupId: classA.id,
			room: "A201",
			startsAt: new Date("2026-08-01T03:00:00.000Z"),
			endsAt: new Date("2026-08-01T04:00:00.000Z"),
		});
		assert.equal(adjacent.status, "scheduled");
		const concurrent = await Promise.allSettled([
			createLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				classGroupId: classA.id,
				room: "A203",
				startsAt: new Date("2026-08-01T04:00:00.000Z"),
				endsAt: new Date("2026-08-01T05:00:00.000Z"),
			}),
			createLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				classGroupId: classA.id,
				room: "A203",
				startsAt: new Date("2026-08-01T04:00:00.000Z"),
				endsAt: new Date("2026-08-01T05:00:00.000Z"),
			}),
		]);
		assert.equal(
			concurrent.filter((result) => result.status === "fulfilled").length,
			1,
		);
		const rejected = concurrent.find((result) => result.status === "rejected");
		assert.ok(rejected?.status === "rejected");
		assert.ok(rejected.reason instanceof TeachingRepositoryError);
		assert.equal(rejected.reason.code, "LESSON_CONFLICT");
		const cancelled = await cancelLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: first.id,
			reason: "校区活动",
		});
		assert.equal(cancelled.status, "cancelled");
		assert.equal(cancelled.cancellationReason, "校区活动");
		await expectError(
			cancelLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				id: first.id,
				reason: null,
			}),
			"LESSON_NOT_CANCELLABLE",
		);
	} finally {
		await cleanup(ids);
	}
});

test("停用课程不能用于新班级", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const inactiveCourse = await createCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			code: "ART-01",
			name: "创意美术",
			category: "art",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_800,
			lessonsPerPackage: 12,
			tags: [],
		});
		await db
			.update(course)
			.set({ isActive: false })
			.where(
				and(
					eq(course.id, inactiveCourse.id),
					eq(course.organizationId, ids.organizationId),
				),
			);
		const instructor = await createTeacherRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			name: "李老师",
			phone: null,
			subjects: ["美术"],
			weeklyCapacityHours: 20,
			campusIds: [ids.campusA],
		});
		await expectError(
			createClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				name: "停用课程班",
				campusId: ids.campusA,
				courseId: inactiveCourse.id,
				teacherId: instructor.id,
				capacity: 10,
				startDate: "2026-08-01",
			}),
			"COURSE_INACTIVE",
		);
	} finally {
		await cleanup(ids);
	}
});

test("课程单次时长仅可在未产生报名和课次时调整", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const editableCourse = await createCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			code: "EDIT-01",
			name: "可调整课程",
			category: "language",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_800,
			lessonsPerPackage: 12,
			tags: [],
		});
		const instructor = await createTeacherRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			name: "陈老师",
			phone: null,
			subjects: ["英语"],
			weeklyCapacityHours: 20,
			campusIds: [ids.campusA],
		});
		await createClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			name: "待开班",
			campusId: ids.campusA,
			courseId: editableCourse.id,
			teacherId: instructor.id,
			capacity: 12,
			startDate: "2026-08-01",
		});
		const updated = await updateCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: editableCourse.id,
			data: courseUpdateData(editableCourse, 45),
		});
		assert.equal(updated.durationMinutes, 45);

		const lessonLockedCourse = await createCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			code: "LESSON-01",
			name: "已有课次课程",
			category: "stem",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_800,
			lessonsPerPackage: 12,
			tags: [],
		});
		const scheduledClass = await createClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			name: "已排课班",
			campusId: ids.campusA,
			courseId: lessonLockedCourse.id,
			teacherId: instructor.id,
			capacity: 12,
			startDate: "2026-08-01",
		});
		await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: scheduledClass.id,
			room: "A301",
			startsAt: new Date("2026-08-02T02:00:00.000Z"),
			endsAt: new Date("2026-08-02T03:00:00.000Z"),
		});
		await expectError(
			updateCourseRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: lessonLockedCourse.id,
				data: courseUpdateData(lessonLockedCourse, 45),
			}),
			"COURSE_DURATION_LOCKED",
		);

		const enrollmentLockedCourse = await createCourseRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			code: "ENROLL-01",
			name: "已有报名课程",
			category: "art",
			level: "L1",
			durationMinutes: 60,
			listPriceInCents: 9_800,
			lessonsPerPackage: 12,
			tags: [],
		});
		const studentId = randomUUID();
		await db.insert(student).values({
			id: studentId,
			organizationId: ids.organizationId,
			campusId: ids.campusA,
			name: "测试学员",
			guardianName: "测试家长",
			guardianPhone: "13900000000",
		});
		await db.insert(enrollment).values({
			organizationId: ids.organizationId,
			studentId,
			courseId: enrollmentLockedCourse.id,
			classGroupId: null,
			purchasedLessons: 12,
			remainingLessons: 12,
		});
		await expectError(
			updateCourseRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: enrollmentLockedCourse.id,
				data: courseUpdateData(enrollmentLockedCourse, 45),
			}),
			"COURSE_DURATION_LOCKED",
		);
	} finally {
		await cleanup(ids);
	}
});

test("报名仅能进入同课程、同校区且未满的班级", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course: trainingCourse, group: classA } = await createClassFixture(
			ids,
			{
				capacity: 1,
			},
		);
		assert.ok(trainingCourse);
		const { course: otherCourse } = await createClassFixture(ids);
		assert.ok(otherCourse);
		const { group: otherCourseClass } = await createClassFixture(ids, {
			courseId: otherCourse.id,
		});
		const { group: otherCampusClass } = await createClassFixture(ids, {
			campusId: ids.campusB,
			courseId: trainingCourse.id,
		});
		const first = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: null,
			studentName: "小林",
		});
		await assignEnrollmentClassRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			enrollmentId: first.enrollmentId,
			classGroupId: classA.id,
		});
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				enrollmentId: first.enrollmentId,
				classGroupId: otherCourseClass.id,
			}),
			"CLASS_COURSE_MISMATCH",
		);
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: first.enrollmentId,
				classGroupId: otherCampusClass.id,
			}),
			"CLASS_CAMPUS_MISMATCH",
		);
		const second = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: null,
			studentName: "小周",
		});
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: second.enrollmentId,
				classGroupId: classA.id,
			}),
			"CLASS_FULL",
		);
		const duplicate = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: null,
			studentId: first.studentId,
		});
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: duplicate.enrollmentId,
				classGroupId: classA.id,
			}),
			"CLASS_STUDENT_DUPLICATE",
		);
		await assignEnrollmentClassRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			enrollmentId: first.enrollmentId,
			classGroupId: null,
		});
		const [unassigned] = await db
			.select({ classGroupId: enrollment.classGroupId })
			.from(enrollment)
			.where(eq(enrollment.id, first.enrollmentId));
		assert.equal(unassigned?.classGroupId, null);
	} finally {
		await cleanup(ids);
	}
});

test("班级状态遵循受控迁移，结课前必须处理已排课次", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course, group } = await createClassFixture(ids);
		assert.ok(course);
		assert.equal(group.status, "recruiting");
		await expectError(
			updateClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: group.id,
				...classUpdateData(group, "paused"),
			}),
			"CLASS_STATUS_TRANSITION_INVALID",
		);
		const running = await updateClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: group.id,
			...classUpdateData(group, "running"),
		});
		const scheduled = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: running.id,
			room: "A204",
			startsAt: new Date("2026-08-06T02:00:00.000Z"),
			endsAt: new Date("2026-08-06T03:00:00.000Z"),
		});
		await expectError(
			updateClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: running.id,
				...classUpdateData(running, "completed"),
			}),
			"CLASS_HAS_SCHEDULED_LESSONS",
		);
		await cancelLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: scheduled.id,
			reason: null,
		});
		const completed = await updateClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: running.id,
			...classUpdateData(running, "completed"),
		});
		assert.equal(completed.status, "completed");
		await expectError(
			updateClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: completed.id,
				...classUpdateData(completed, "running"),
			}),
			"CLASS_STATUS_TRANSITION_INVALID",
		);
	} finally {
		await cleanup(ids);
	}
});

test("非 active 报名不能入班，且不出现在成员、点名或消课路径", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course, group } = await createClassFixture(ids);
		assert.ok(course);
		const activeEnrollment = await createEnrollmentFixture({
			ids,
			courseId: course.id,
			classGroupId: group.id,
			studentName: "有效报名",
		});
		const legacyTransferredEnrollment = await createEnrollmentFixture({
			ids,
			courseId: course.id,
			classGroupId: group.id,
			studentName: "遗留转课报名",
		});
		const transferredCandidate = await createEnrollmentFixture({
			ids,
			courseId: course.id,
			classGroupId: null,
			studentName: "已转课候选人",
		});
		await db
			.update(enrollment)
			.set({ status: "transferred" })
			.where(
				inArray(enrollment.id, [
					legacyTransferredEnrollment.enrollmentId,
					transferredCandidate.enrollmentId,
				]),
			);
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: transferredCandidate.enrollmentId,
				classGroupId: group.id,
			}),
			"ENROLLMENT_NOT_ACTIVE",
		);
		const members = await listClassEnrollmentRecords({
			organizationId: ids.organizationId,
			campusAccess: { kind: "all" },
			classGroupId: group.id,
		});
		assert.deepEqual(
			members.map((item) => item.enrollmentId),
			[activeEnrollment.enrollmentId],
		);
		const scheduled = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A205",
			startsAt: new Date("2026-08-07T02:00:00.000Z"),
			endsAt: new Date("2026-08-07T03:00:00.000Z"),
		});
		const attendanceBeforeCompletion = await getLessonAttendanceRecord({
			organizationId: ids.organizationId,
			campusAccess: { kind: "all" },
			id: scheduled.id,
		});
		assert.deepEqual(
			attendanceBeforeCompletion.members.map((item) => item.enrollmentId),
			[activeEnrollment.enrollmentId],
		);
		await completeLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: scheduled.id,
			attendance: [
				{
					enrollmentId: activeEnrollment.enrollmentId,
					status: "present",
					note: null,
				},
			],
		});
		const consumptions = await db
			.select({ enrollmentId: lessonConsumption.enrollmentId })
			.from(lessonConsumption)
			.where(eq(lessonConsumption.lessonId, scheduled.id));
		assert.deepEqual(consumptions, [
			{ enrollmentId: activeEnrollment.enrollmentId },
		]);
	} finally {
		await cleanup(ids);
	}
});

test("结课原子写入考勤和消课，重复或并发结课不会重复扣课", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course, group } = await createClassFixture(ids);
		assert.ok(course);
		const attendees = await Promise.all([
			createEnrollmentFixture({
				ids,
				courseId: course.id,
				classGroupId: group.id,
				studentName: "到课学员",
			}),
			createEnrollmentFixture({
				ids,
				courseId: course.id,
				classGroupId: group.id,
				studentName: "迟到学员",
			}),
			createEnrollmentFixture({
				ids,
				courseId: course.id,
				classGroupId: group.id,
				studentName: "缺勤学员",
			}),
			createEnrollmentFixture({
				ids,
				courseId: course.id,
				classGroupId: group.id,
				studentName: "请假学员",
			}),
		]);
		const lessonOne = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A201",
			startsAt: new Date("2026-08-03T02:00:00.000Z"),
			endsAt: new Date("2026-08-03T03:00:00.000Z"),
		});
		const roster = ["present", "late", "absent", "leave"] as const;
		await completeLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: lessonOne.id,
			attendance: attendees.map((item, index) => ({
				enrollmentId: item.enrollmentId,
				status: roster[index] ?? "present",
				note: null,
			})),
		});
		const attendanceRows = await db
			.select()
			.from(attendance)
			.where(eq(attendance.lessonId, lessonOne.id));
		const consumptionRows = await db
			.select()
			.from(lessonConsumption)
			.where(eq(lessonConsumption.lessonId, lessonOne.id));
		assert.equal(attendanceRows.length, 4);
		assert.equal(consumptionRows.length, 2);
		const balances = await db
			.select({
				id: enrollment.id,
				remainingLessons: enrollment.remainingLessons,
			})
			.from(enrollment)
			.where(
				inArray(
					enrollment.id,
					attendees.map((item) => item.enrollmentId),
				),
			);
		assert.deepEqual(
			balances
				.map((item) => item.remainingLessons)
				.sort((left, right) => left - right),
			[2, 2, 3, 3],
		);
		await expectError(
			completeLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				id: lessonOne.id,
				attendance: attendees.map((item) => ({
					enrollmentId: item.enrollmentId,
					status: "present",
					note: null,
				})),
			}),
			"LESSON_COMPLETION_INVALID",
		);
		const lessonTwo = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A202",
			startsAt: new Date("2026-08-04T02:00:00.000Z"),
			endsAt: new Date("2026-08-04T03:00:00.000Z"),
		});
		const concurrent = await Promise.allSettled(
			Array.from({ length: 2 }, () =>
				completeLessonRecord({
					organizationId: ids.organizationId,
					userId: ids.adminId,
					id: lessonTwo.id,
					attendance: attendees.map((item) => ({
						enrollmentId: item.enrollmentId,
						status: "absent",
						note: null,
					})),
				}),
			),
		);
		assert.equal(
			concurrent.filter((result) => result.status === "fulfilled").length,
			1,
		);
		const secondLessonAttendance = await db
			.select()
			.from(attendance)
			.where(eq(attendance.lessonId, lessonTwo.id));
		assert.equal(secondLessonAttendance.length, 4);
	} finally {
		await cleanup(ids);
	}
});

test("课时不足时结课整体回滚，不保留考勤或消课流水", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course, group } = await createClassFixture(ids);
		assert.ok(course);
		const member = await createEnrollmentFixture({
			ids,
			courseId: course.id,
			classGroupId: group.id,
			remainingLessons: 0,
		});
		const scheduled = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A203",
			startsAt: new Date("2026-08-05T02:00:00.000Z"),
			endsAt: new Date("2026-08-05T03:00:00.000Z"),
		});
		await expectError(
			completeLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: scheduled.id,
				attendance: [
					{ enrollmentId: member.enrollmentId, status: "present", note: null },
				],
			}),
			"LESSON_CONSUMPTION_INSUFFICIENT",
		);
		const [lessonAfter] = await db
			.select({ status: lesson.status })
			.from(lesson)
			.where(eq(lesson.id, scheduled.id));
		assert.equal(lessonAfter?.status, "scheduled");
		const [balance] = await db
			.select({ remainingLessons: enrollment.remainingLessons })
			.from(enrollment)
			.where(eq(enrollment.id, member.enrollmentId));
		assert.equal(balance?.remainingLessons, 0);
		const rows = await db
			.select({ id: attendance.id })
			.from(attendance)
			.where(eq(attendance.lessonId, scheduled.id));
		assert.equal(rows.length, 0);
	} finally {
		await cleanup(ids);
	}
});
