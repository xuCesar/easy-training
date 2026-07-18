import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	cancelLessonRecord,
	createClassGroupRecord,
	createCourseRecord,
	createLessonRecord,
	createTeacherRecord,
	TeachingRepositoryError,
	updateCourseRecord,
} from "../src/repositories/teaching";
import {
	campus,
	classGroup,
	course,
	enrollment,
	lesson,
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
			status: "recruiting",
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
				status: "recruiting",
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
				status: "recruiting",
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
			status: "recruiting",
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
			status: "recruiting",
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
