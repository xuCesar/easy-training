import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src";
import {
	ClassroomRepositoryError,
	createClassroomRecord,
	listClassroomRecords,
	setClassroomActiveRecord,
	updateClassroomRecord,
} from "../src/repositories/classrooms";
import {
	EnrollmentLifecycleError,
	updateEnrollmentLifecycleRecord,
} from "../src/repositories/enrollment-lifecycle";
import {
	createScheduleRuleRecord as createScheduleRuleRepositoryRecord,
	deactivateScheduleRuleRecord,
	deleteScheduleRuleRecord,
	generateScheduleLessonsRecord,
	previewBulkLessonUpdateRecord,
	previewScheduleGenerationRecord,
	previewScheduleRuleDeactivationRecord,
	previewScheduleRuleUpdateRecord,
	updateScheduleRuleRecord,
} from "../src/repositories/scheduling";
import {
	assignEnrollmentClassRecord,
	cancelLessonRecord,
	cancelMakeupLessonRecord,
	completeLessonRecord,
	createClassGroupRecord,
	createCourseRecord,
	createLessonRecord as createLessonRepositoryRecord,
	createMakeupLessonRecord,
	createTeacherRecord,
	getLessonAttendanceRecord,
	listClassEnrollmentRecords,
	listMakeupLessonRecords,
	normalizeRoom,
	pauseClassGroupRecord,
	resumeClassGroupRecord,
	saveLessonAttendanceDraftRecord,
	TeachingRepositoryError,
	updateClassGroupRecord,
	updateCourseRecord,
} from "../src/repositories/teaching";
import {
	attendance,
	campus,
	classGroup,
	classroom,
	classStatusEvent,
	course,
	enrollment,
	enrollmentLifecycleEvent,
	lesson,
	lessonConsumption,
	lessonScheduleBatch,
	lessonScheduleRule,
	makeupLesson,
	organization,
	organizationAuditEvent,
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
		.delete(organizationAuditEvent)
		.where(eq(organizationAuditEvent.organizationId, ids.organizationId));
	await db
		.delete(lessonConsumption)
		.where(eq(lessonConsumption.organizationId, ids.organizationId));
	await db
		.delete(makeupLesson)
		.where(eq(makeupLesson.organizationId, ids.organizationId));
	await db
		.delete(lessonScheduleBatch)
		.where(eq(lessonScheduleBatch.organizationId, ids.organizationId));
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
		.delete(enrollmentLifecycleEvent)
		.where(eq(enrollmentLifecycleEvent.organizationId, ids.organizationId));
	await db
		.delete(enrollment)
		.where(eq(enrollment.organizationId, ids.organizationId));
	await db.delete(lesson).where(eq(lesson.organizationId, ids.organizationId));
	await db
		.delete(lessonScheduleRule)
		.where(eq(lessonScheduleRule.organizationId, ids.organizationId));
	await db
		.delete(classStatusEvent)
		.where(eq(classStatusEvent.organizationId, ids.organizationId));
	await db
		.delete(classGroup)
		.where(eq(classGroup.organizationId, ids.organizationId));
	await db
		.delete(classroom)
		.where(eq(classroom.organizationId, ids.organizationId));
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

async function expectClassroomError(
	promise: Promise<unknown>,
	code: ClassroomRepositoryError["code"],
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof ClassroomRepositoryError);
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
	const room = await createClassroomRecord({
		organizationId: ids.organizationId,
		userId: ids.adminId,
		campusId,
		name: `教室-${randomUUID().slice(0, 6)}`,
		capacity: input?.capacity ?? 10,
	});
	return { course: trainingCourse, group, room };
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

async function resolveResourceClassroom(input: {
	organizationId: string;
	userId: string;
	campusId: string;
	name: string;
}) {
	const nameNormalized = normalizeRoom(input.name);
	const findExisting = async () => {
		const [existing] = await db
			.select()
			.from(classroom)
			.where(
				and(
					eq(classroom.organizationId, input.organizationId),
					eq(classroom.campusId, input.campusId),
					eq(classroom.nameNormalized, nameNormalized),
				),
			)
			.limit(1);
		return existing;
	};
	const existing = await findExisting();
	if (existing) return existing;
	try {
		return await createClassroomRecord({
			organizationId: input.organizationId,
			userId: input.userId,
			campusId: input.campusId,
			name: input.name.trim(),
			capacity: 10_000,
		});
	} catch (error) {
		if (
			!(error instanceof ClassroomRepositoryError) ||
			error.code !== "CLASSROOM_DUPLICATE"
		) {
			throw error;
		}
		const concurrent = await findExisting();
		if (concurrent) return concurrent;
		throw error;
	}
}

async function createResourceLessonRecord(
	input: Omit<Parameters<typeof createLessonRepositoryRecord>[0], "roomId"> & {
		roomId?: string;
	},
) {
	if (input.roomId)
		return createLessonRepositoryRecord({ ...input, roomId: input.roomId });
	const [group] = await db
		.select({ campusId: classGroup.campusId })
		.from(classGroup)
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!group) throw new Error("Expected class group for lesson fixture.");
	const room = await resolveResourceClassroom({
		organizationId: input.organizationId,
		userId: input.userId,
		campusId: group.campusId,
		name: input.room,
	});
	return createLessonRepositoryRecord({ ...input, roomId: room.id });
}

async function createResourceScheduleRuleRecord(
	input: Omit<
		Parameters<typeof createScheduleRuleRepositoryRecord>[0],
		"data"
	> & {
		data: Omit<
			Parameters<typeof createScheduleRuleRepositoryRecord>[0]["data"],
			"roomId"
		> & {
			roomId?: string;
		};
	},
) {
	if (input.data.roomId) {
		return createScheduleRuleRepositoryRecord({
			...input,
			data: { ...input.data, roomId: input.data.roomId },
		});
	}
	const [group] = await db
		.select({ campusId: classGroup.campusId })
		.from(classGroup)
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!group)
		throw new Error("Expected class group for schedule rule fixture.");
	const room = await resolveResourceClassroom({
		organizationId: input.organizationId,
		userId: input.userId,
		campusId: group.campusId,
		name: input.data.room,
	});
	return createScheduleRuleRepositoryRecord({
		...input,
		data: { ...input.data, roomId: room.id },
	});
}

const createScheduleRuleRecord = createResourceScheduleRuleRecord;
const createLessonRecord = createResourceLessonRecord;

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
		assert.equal(first.room, "A201");
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

test("报名冻结、复课和转班只按生效时点影响未来课次名单", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course, group, room } = await createClassFixture(ids);
		assert.ok(course);
		const { group: targetGroup } = await createClassFixture(ids, {
			courseId: course.id,
		});
		const enrollmentFixture = await createEnrollmentFixture({
			ids,
			courseId: course.id,
			classGroupId: group.id,
			studentName: "报名生命周期学员",
		});
		const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const sourceLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: room.name,
			startsAt,
			endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
		});
		assert.deepEqual(
			(
				await getLessonAttendanceRecord({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					id: sourceLesson.id,
				})
			).members.map((item) => item.enrollmentId),
			[enrollmentFixture.enrollmentId],
		);
		const frozen = await updateEnrollmentLifecycleRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			enrollmentId: enrollmentFixture.enrollmentId,
			expectedVersion: 1,
			requestId: randomUUID(),
			action: { kind: "freeze", reason: "暑期暂停" },
		});
		assert.equal(frozen.status, "frozen");
		assert.deepEqual(
			(
				await getLessonAttendanceRecord({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					id: sourceLesson.id,
				})
			).members,
			[],
		);
		const resumed = await updateEnrollmentLifecycleRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			enrollmentId: enrollmentFixture.enrollmentId,
			expectedVersion: frozen.version,
			requestId: randomUUID(),
			action: { kind: "resume", reason: "恢复上课" },
		});
		assert.equal(resumed.status, "active");
		const transferred = await updateEnrollmentLifecycleRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			enrollmentId: enrollmentFixture.enrollmentId,
			expectedVersion: resumed.version,
			requestId: randomUUID(),
			action: { kind: "assignClass", classGroupId: targetGroup.id },
		});
		assert.equal(transferred.classGroupId, targetGroup.id);
		assert.deepEqual(
			(
				await getLessonAttendanceRecord({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					id: sourceLesson.id,
				})
			).members,
			[],
		);
		const targetStartsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
		const targetLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: "生命周期目标教室",
			startsAt: targetStartsAt,
			endsAt: new Date(targetStartsAt.getTime() + 60 * 60 * 1000),
		});
		assert.deepEqual(
			(
				await getLessonAttendanceRecord({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					id: targetLesson.id,
				})
			).members.map((item) => item.enrollmentId),
			[enrollmentFixture.enrollmentId],
		);
		await assert.rejects(
			updateEnrollmentLifecycleRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				enrollmentId: enrollmentFixture.enrollmentId,
				expectedVersion: 1,
				requestId: randomUUID(),
				action: { kind: "freeze", reason: "陈旧版本" },
			}),
			(error: unknown) => {
				assert.ok(error instanceof EnrollmentLifecycleError);
				assert.equal(error.code, "ENROLLMENT_VERSION_CONFLICT");
				return true;
			},
		);
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
			startsAt: new Date("2020-08-07T02:00:00.000Z"),
			endsAt: new Date("2020-08-07T03:00:00.000Z"),
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

test("批量调整中候选课次互相重叠时标记为时间冲突", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { group } = await createClassFixture(ids);
		const first = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A101",
			startsAt: new Date("2026-08-19T01:30:00.000Z"),
			endsAt: new Date("2026-08-19T02:30:00.000Z"),
		});
		const second = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "A102",
			startsAt: new Date("2026-08-20T01:30:00.000Z"),
			endsAt: new Date("2026-08-20T02:30:00.000Z"),
		});

		const preview = await previewBulkLessonUpdateRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			items: [first, second].map((item) => ({
				id: item.id,
				expectedVersion: item.version,
				startsAt: new Date("2026-08-21T01:30:00.000Z"),
				teacherId: group.teacherId,
				room: "A102",
				roomId: second.roomId ?? "",
			})),
		});

		assert.ok(preview.items.every((item) => item.conflicts[0] === "time"));
		assert.ok(preview.items.every((item) => item.conflicts.length === 1));
	} finally {
		await cleanup(ids);
	}
});

test("教室资源遵守校区权限、名称唯一、未来课次停用保护和容量边界", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const room = await createClassroomRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			campusId: ids.campusA,
			name: " A 101 ",
			capacity: 3,
		});
		assert.equal(room.name, "A 101");
		assert.equal(room.nameNormalized, "a 101");
		await expectClassroomError(
			createClassroomRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				campusId: ids.campusB,
				name: "B101",
				capacity: 8,
			}),
			"CAMPUS_OUT_OF_SCOPE",
		);
		await expectClassroomError(
			createClassroomRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				campusId: ids.campusA,
				name: "Ａ 101",
				capacity: 8,
			}),
			"CLASSROOM_DUPLICATE",
		);
		const updatedRoom = await updateClassroomRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: room.id,
			name: "A101 主教室",
			capacity: 3,
		});
		assert.equal(updatedRoom.name, "A101 主教室");
		const roomB = await createClassroomRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			campusId: ids.campusB,
			name: "B101",
			capacity: 8,
		});
		const managerRooms = await listClassroomRecords({
			organizationId: ids.organizationId,
			campusAccess: { kind: "selected", campusIds: [ids.campusA] },
			includeInactive: true,
		});
		assert.deepEqual(
			managerRooms.map((item) => item.id),
			[room.id],
		);
		assert.ok(!managerRooms.some((item) => item.id === roomB.id));

		const { course: trainingCourse, group } = await createClassFixture(ids);
		if (!trainingCourse)
			throw new Error("Expected a generated course fixture.");
		const missingRoomInput = {
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "仅有旧文本",
			startsAt: new Date("2031-07-31T02:00:00.000Z"),
			endsAt: new Date("2031-07-31T03:00:00.000Z"),
		};
		await expectError(
			createLessonRepositoryRecord({
				...missingRoomInput,
				roomId: "",
			}),
			"INVALID_INPUT",
		);
		const firstEnrollment = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: group.id,
		});
		await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: group.id,
		});
		await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: group.id,
		});
		const scheduled = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "客户端旧快照不应被采用",
			roomId: room.id,
			startsAt: new Date("2031-08-01T02:00:00.000Z"),
			endsAt: new Date("2031-08-01T03:00:00.000Z"),
		});
		assert.equal(scheduled.roomId, room.id);
		assert.equal(scheduled.room, updatedRoom.name);
		await expectClassroomError(
			updateClassroomRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: room.id,
				name: updatedRoom.name,
				capacity: 2,
			}),
			"INVALID_INPUT",
		);
		await expectClassroomError(
			setClassroomActiveRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: room.id,
				isActive: false,
			}),
			"CLASSROOM_HAS_FUTURE_LESSONS",
		);

		const waitingEnrollment = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: null,
		});
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: waitingEnrollment.enrollmentId,
				classGroupId: group.id,
			}),
			"CLASS_FULL",
		);
		const [unchangedEnrollment] = await db
			.select({ classGroupId: enrollment.classGroupId })
			.from(enrollment)
			.where(eq(enrollment.id, waitingEnrollment.enrollmentId));
		assert.equal(unchangedEnrollment?.classGroupId, null);
		assert.notEqual(
			firstEnrollment.enrollmentId,
			waitingEnrollment.enrollmentId,
		);

		await cancelLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: scheduled.id,
			reason: "释放教室",
		});
		const inactiveRoom = await setClassroomActiveRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: room.id,
			isActive: false,
		});
		assert.equal(inactiveRoom.isActive, false);
		await expectError(
			createLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				classGroupId: group.id,
				room: "A101 主教室",
				roomId: room.id,
				startsAt: new Date("2031-08-02T02:00:00.000Z"),
				endsAt: new Date("2031-08-02T03:00:00.000Z"),
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		const historicalTextLessonId = randomUUID();
		await db.insert(lesson).values({
			id: historicalTextLessonId,
			organizationId: ids.organizationId,
			classGroupId: group.id,
			teacherId: group.teacherId,
			campusId: group.campusId,
			room: "旧址 201",
			roomId: null,
			startsAt: new Date("2020-08-02T02:00:00.000Z"),
			endsAt: new Date("2020-08-02T03:00:00.000Z"),
		});
		const [historicalTextLesson] = await db
			.select({ room: lesson.room, roomId: lesson.roomId })
			.from(lesson)
			.where(eq(lesson.id, historicalTextLessonId));
		assert.ok(historicalTextLesson);
		assert.equal(historicalTextLesson.roomId, null);
		assert.equal(historicalTextLesson.room, "旧址 201");

		const roomAudits = await db
			.select({ action: organizationAuditEvent.action })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.entityId, room.id),
				),
			);
		assert.deepEqual(
			roomAudits.map((item) => item.action).sort(),
			[
				"classroom_created",
				"classroom_deactivated",
				"classroom_updated",
			].sort(),
		);
	} finally {
		await cleanup(ids);
	}
});

test("班级停复课按策略冻结历史、幂等写审计并阻止暂停态教学写入", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { group } = await createClassFixture(ids);
		const runningGroup = await updateClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: group.id,
			...classUpdateData(group, "running"),
		});
		const started = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "历史教室",
			startsAt: new Date("2020-08-01T02:00:00.000Z"),
			endsAt: new Date("2020-08-01T03:00:00.000Z"),
		});
		const keptFuture = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "未来教室",
			startsAt: new Date("2031-09-01T02:00:00.000Z"),
			endsAt: new Date("2031-09-01T03:00:00.000Z"),
		});
		const keepRequestId = randomUUID();
		const paused = await pauseClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: runningGroup.id,
			reason: "教师短期请假",
			futureLessonPolicy: "keep",
			requestId: keepRequestId,
		});
		assert.equal(paused.classGroup.status, "paused");
		assert.deepEqual(paused.affectedLessonIds, [keptFuture.id]);
		assert.equal(paused.replayed, false);
		const replayedPause = await pauseClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: runningGroup.id,
			reason: "教师短期请假",
			futureLessonPolicy: "keep",
			requestId: keepRequestId,
		});
		assert.equal(replayedPause.replayed, true);
		await expectError(
			pauseClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				id: runningGroup.id,
				reason: "不同载荷",
				futureLessonPolicy: "keep",
				requestId: keepRequestId,
			}),
			"IDEMPOTENCY_CONFLICT",
		);
		const preservedLessons = await db
			.select({ id: lesson.id, status: lesson.status })
			.from(lesson)
			.where(inArray(lesson.id, [started.id, keptFuture.id]));
		assert.ok(preservedLessons.every((item) => item.status === "scheduled"));

		await expectError(
			createLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				classGroupId: group.id,
				room: "暂停后新课次",
				startsAt: new Date("2031-09-02T02:00:00.000Z"),
				endsAt: new Date("2031-09-02T03:00:00.000Z"),
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		await expectError(
			createScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				classGroupId: group.id,
				data: {
					weekdays: [1],
					startMinuteOfDay: 9 * 60,
					room: "暂停规则教室",
					validFrom: "2031-09-01",
					validUntil: "2031-09-30",
				},
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		const pausedRule = await db
			.insert(lessonScheduleRule)
			.values({
				organizationId: ids.organizationId,
				classGroupId: group.id,
				weekdays: [1],
				startMinuteOfDay: 9 * 60,
				room: keptFuture.room,
				roomId: keptFuture.roomId,
				validFrom: "2031-09-01",
				validUntil: "2031-09-30",
				createdByUserId: ids.adminId,
				updatedByUserId: ids.adminId,
			})
			.returning();
		const pausedRuleRecord = pausedRule[0];
		if (!pausedRuleRecord) throw new Error("Expected paused rule fixture.");
		await expectError(
			previewScheduleRuleDeactivationRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: pausedRuleRecord.id,
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		await expectError(
			deactivateScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: pausedRuleRecord.id,
				expectedRevision: pausedRuleRecord.revision,
				cancelFuture: false,
				reason: null,
				requestId: randomUUID(),
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		await expectError(
			deleteScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: pausedRuleRecord.id,
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		await expectError(
			previewBulkLessonUpdateRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				items: [
					{
						id: keptFuture.id,
						expectedVersion: keptFuture.version,
						startsAt: new Date("2031-09-03T02:00:00.000Z"),
						teacherId: group.teacherId,
						room: keptFuture.room,
						roomId: keptFuture.roomId ?? "",
					},
				],
			}),
			"CLASS_NOT_SCHEDULABLE",
		);
		await expectError(
			saveLessonAttendanceDraftRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: started.id,
				attendance: [],
			}),
			"CLASS_ATTENDANCE_LOCKED",
		);
		await expectError(
			completeLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: started.id,
				attendance: [],
			}),
			"CLASS_ATTENDANCE_LOCKED",
		);

		const resumeRequestId = randomUUID();
		const resumed = await resumeClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.managerId,
			id: group.id,
			reason: "教师已返岗",
			requestId: resumeRequestId,
		});
		assert.equal(resumed.classGroup.status, "running");
		assert.equal(resumed.replayed, false);
		assert.equal(
			(
				await resumeClassGroupRecord({
					organizationId: ids.organizationId,
					userId: ids.managerId,
					id: group.id,
					reason: "教师已返岗",
					requestId: resumeRequestId,
				})
			).replayed,
			true,
		);
		await expectError(
			resumeClassGroupRecord({
				organizationId: ids.organizationId,
				userId: ids.managerId,
				id: group.id,
				reason: "不同复课原因",
				requestId: resumeRequestId,
			}),
			"IDEMPOTENCY_CONFLICT",
		);

		const cancelledFuture = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "取消策略教室",
			startsAt: new Date("2031-10-01T02:00:00.000Z"),
			endsAt: new Date("2031-10-01T03:00:00.000Z"),
		});
		const cancelledBeforePause = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			room: "既有取消课次",
			startsAt: new Date("2031-10-02T02:00:00.000Z"),
			endsAt: new Date("2031-10-02T03:00:00.000Z"),
		});
		await cancelLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: cancelledBeforePause.id,
			reason: "原取消原因",
		});
		const cancelPause = await pauseClassGroupRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: group.id,
			reason: "机构统一停课",
			futureLessonPolicy: "cancel",
			requestId: randomUUID(),
		});
		assert.ok(cancelPause.affectedLessonIds.includes(keptFuture.id));
		assert.ok(cancelPause.affectedLessonIds.includes(cancelledFuture.id));
		assert.ok(!cancelPause.affectedLessonIds.includes(started.id));
		assert.ok(!cancelPause.affectedLessonIds.includes(cancelledBeforePause.id));
		const finalLessons = await db
			.select({
				id: lesson.id,
				status: lesson.status,
				reason: lesson.cancellationReason,
			})
			.from(lesson)
			.where(
				inArray(lesson.id, [
					started.id,
					keptFuture.id,
					cancelledFuture.id,
					cancelledBeforePause.id,
				]),
			);
		assert.deepEqual(
			finalLessons.find((item) => item.id === started.id),
			{ id: started.id, status: "scheduled", reason: null },
		);
		assert.deepEqual(
			finalLessons.find((item) => item.id === cancelledBeforePause.id),
			{
				id: cancelledBeforePause.id,
				status: "cancelled",
				reason: "原取消原因",
			},
		);
		assert.ok(
			finalLessons
				.filter(
					(item) => item.id === keptFuture.id || item.id === cancelledFuture.id,
				)
				.every(
					(item) =>
						item.status === "cancelled" && item.reason === "机构统一停课",
				),
		);

		const statusAudits = await db
			.select({ action: organizationAuditEvent.action })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.entityId, group.id),
				),
			);
		assert.equal(
			statusAudits.filter((item) => item.action === "class_paused").length,
			2,
		);
		assert.equal(
			statusAudits.filter((item) => item.action === "class_resumed").length,
			1,
		);
		const events = await db
			.select({ kind: classStatusEvent.kind })
			.from(classStatusEvent)
			.where(eq(classStatusEvent.classGroupId, group.id));
		assert.equal(events.filter((item) => item.kind === "paused").length, 2);
		assert.equal(events.filter((item) => item.kind === "resumed").length, 1);
	} finally {
		await cleanup(ids);
	}
});

test("补课校验来源资格、合并点名名单并按考勤结果恰好一次课消或待重排", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { course: trainingCourse, group: sourceGroup } =
			await createClassFixture(ids, { capacity: 4 });
		if (!trainingCourse)
			throw new Error("Expected a generated course fixture.");
		const { group: targetGroup } = await createClassFixture(ids, {
			capacity: 4,
			courseId: trainingCourse.id,
		});
		const sourceEnrollment = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: sourceGroup.id,
			studentName: "补课学员",
			remainingLessons: 3,
		});
		const targetEnrollment = await createEnrollmentFixture({
			ids,
			courseId: trainingCourse.id,
			classGroupId: targetGroup.id,
			studentName: "目标班学员",
			remainingLessons: 3,
		});
		const room = await createClassroomRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			campusId: ids.campusA,
			name: "补课教室",
			capacity: 3,
		});
		const sourceLessonId = randomUUID();
		await db.insert(lesson).values({
			id: sourceLessonId,
			organizationId: ids.organizationId,
			classGroupId: sourceGroup.id,
			teacherId: sourceGroup.teacherId,
			campusId: ids.campusA,
			room: "历史来源教室",
			startsAt: new Date("2029-01-01T02:00:00.000Z"),
			endsAt: new Date("2029-01-01T03:00:00.000Z"),
			status: "completed",
			completedAt: new Date("2029-01-01T03:00:00.000Z"),
			completedByUserId: ids.adminId,
		});
		await db.insert(attendance).values({
			lessonId: sourceLessonId,
			studentId: sourceEnrollment.studentId,
			status: "absent",
			recordedByUserId: ids.adminId,
		});
		const invalidSourceLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: sourceGroup.id,
			room: "未完成来源",
			startsAt: new Date("2032-01-01T02:00:00.000Z"),
			endsAt: new Date("2032-01-01T03:00:00.000Z"),
		});
		const targetLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-01-02T02:00:00.000Z"),
			endsAt: new Date("2032-01-02T03:00:00.000Z"),
		});
		await expectError(
			createMakeupLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				sourceLessonId: invalidSourceLesson.id,
				sourceEnrollmentId: sourceEnrollment.enrollmentId,
				targetLessonId: targetLesson.id,
				requestId: randomUUID(),
			}),
			"MAKEUP_LESSON_INVALID",
		);

		const requestId = randomUUID();
		const created = await createMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			sourceLessonId,
			sourceEnrollmentId: sourceEnrollment.enrollmentId,
			targetLessonId: targetLesson.id,
			requestId,
		});
		assert.equal(created.replayed, false);
		assert.equal(created.makeupLesson.status, "scheduled");
		const waitingSameStudentEnrollmentId = randomUUID();
		await db.insert(enrollment).values({
			id: waitingSameStudentEnrollmentId,
			organizationId: ids.organizationId,
			studentId: sourceEnrollment.studentId,
			courseId: trainingCourse.id,
			classGroupId: null,
			purchasedLessons: 3,
			remainingLessons: 3,
		});
		await expectError(
			assignEnrollmentClassRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				enrollmentId: waitingSameStudentEnrollmentId,
				classGroupId: targetGroup.id,
			}),
			"CLASS_STUDENT_DUPLICATE",
		);
		assert.equal(
			(
				await createMakeupLessonRecord({
					organizationId: ids.organizationId,
					userId: ids.adminId,
					sourceLessonId,
					sourceEnrollmentId: sourceEnrollment.enrollmentId,
					targetLessonId: targetLesson.id,
					requestId,
				})
			).replayed,
			true,
		);
		await expectError(
			createMakeupLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				sourceLessonId,
				sourceEnrollmentId: sourceEnrollment.enrollmentId,
				targetLessonId: invalidSourceLesson.id,
				requestId,
			}),
			"IDEMPOTENCY_CONFLICT",
		);
		await expectError(
			createMakeupLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				sourceLessonId,
				sourceEnrollmentId: sourceEnrollment.enrollmentId,
				targetLessonId: targetLesson.id,
				requestId: randomUUID(),
			}),
			"MAKEUP_LESSON_DUPLICATE",
		);
		const attendanceRecord = await getLessonAttendanceRecord({
			organizationId: ids.organizationId,
			campusAccess: { kind: "all" },
			id: targetLesson.id,
		});
		assert.equal(attendanceRecord.members.length, 2);
		assert.deepEqual(
			attendanceRecord.members
				.map((item) => ({
					enrollmentId: item.enrollmentId,
					makeupLessonId: item.makeupLessonId,
				}))
				.sort((left, right) =>
					left.enrollmentId.localeCompare(right.enrollmentId),
				),
			[
				{
					enrollmentId: sourceEnrollment.enrollmentId,
					makeupLessonId: created.makeupLesson.id,
				},
				{
					enrollmentId: targetEnrollment.enrollmentId,
					makeupLessonId: null,
				},
			].sort((left, right) =>
				left.enrollmentId.localeCompare(right.enrollmentId),
			),
		);
		const [sourceBeforeCompletion] = await db
			.select({ status: lesson.status })
			.from(lesson)
			.where(eq(lesson.id, sourceLessonId));
		assert.equal(sourceBeforeCompletion?.status, "completed");

		await db
			.update(lesson)
			.set({
				startsAt: new Date("2020-02-01T02:00:00.000Z"),
				endsAt: new Date("2020-02-01T03:00:00.000Z"),
			})
			.where(eq(lesson.id, targetLesson.id));
		await completeLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: targetLesson.id,
			attendance: [
				{
					enrollmentId: targetEnrollment.enrollmentId,
					status: "present",
					note: null,
				},
				{
					enrollmentId: sourceEnrollment.enrollmentId,
					status: "late",
					note: null,
				},
			],
		});
		const [fulfilled, sourceAfterCompletion, sourceConsumptions] =
			await Promise.all([
				listMakeupLessonRecords({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					sourceEnrollmentId: sourceEnrollment.enrollmentId,
				}),
				db
					.select({ remainingLessons: enrollment.remainingLessons })
					.from(enrollment)
					.where(eq(enrollment.id, sourceEnrollment.enrollmentId)),
				db
					.select({ id: lessonConsumption.id })
					.from(lessonConsumption)
					.where(
						and(
							eq(lessonConsumption.lessonId, targetLesson.id),
							eq(lessonConsumption.enrollmentId, sourceEnrollment.enrollmentId),
						),
					),
			]);
		assert.equal(fulfilled[0]?.status, "fulfilled");
		assert.equal(sourceAfterCompletion[0]?.remainingLessons, 2);
		assert.equal(sourceConsumptions.length, 1);
		const duplicateFulfilledTarget = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-01-03T02:00:00.000Z"),
			endsAt: new Date("2032-01-03T03:00:00.000Z"),
		});
		await expectError(
			createMakeupLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				sourceLessonId,
				sourceEnrollmentId: sourceEnrollment.enrollmentId,
				targetLessonId: duplicateFulfilledTarget.id,
				requestId: randomUUID(),
			}),
			"MAKEUP_LESSON_DUPLICATE",
		);
		await expectError(
			completeLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: targetLesson.id,
				attendance: [],
			}),
			"LESSON_COMPLETION_INVALID",
		);
		assert.equal(
			(
				await db
					.select({ id: lessonConsumption.id })
					.from(lessonConsumption)
					.where(
						and(
							eq(lessonConsumption.lessonId, targetLesson.id),
							eq(lessonConsumption.enrollmentId, sourceEnrollment.enrollmentId),
						),
					)
			).length,
			1,
		);

		const leaveSourceLessonId = randomUUID();
		await db.insert(lesson).values({
			id: leaveSourceLessonId,
			organizationId: ids.organizationId,
			classGroupId: sourceGroup.id,
			teacherId: sourceGroup.teacherId,
			campusId: ids.campusA,
			room: "请假来源教室",
			startsAt: new Date("2029-03-01T02:00:00.000Z"),
			endsAt: new Date("2029-03-01T03:00:00.000Z"),
			status: "completed",
			completedAt: new Date("2029-03-01T03:00:00.000Z"),
			completedByUserId: ids.adminId,
		});
		await db.insert(attendance).values({
			lessonId: leaveSourceLessonId,
			studentId: sourceEnrollment.studentId,
			status: "leave",
			recordedByUserId: ids.adminId,
		});
		const leaveTargetLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-03-02T02:00:00.000Z"),
			endsAt: new Date("2032-03-02T03:00:00.000Z"),
		});
		const leaveMakeup = await createMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			sourceLessonId: leaveSourceLessonId,
			sourceEnrollmentId: sourceEnrollment.enrollmentId,
			targetLessonId: leaveTargetLesson.id,
			requestId: randomUUID(),
		});
		await db
			.update(lesson)
			.set({
				startsAt: new Date("2020-03-02T02:00:00.000Z"),
				endsAt: new Date("2020-03-02T03:00:00.000Z"),
			})
			.where(eq(lesson.id, leaveTargetLesson.id));
		await completeLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: leaveTargetLesson.id,
			attendance: [
				{
					enrollmentId: targetEnrollment.enrollmentId,
					status: "present",
					note: null,
				},
				{
					enrollmentId: sourceEnrollment.enrollmentId,
					status: "leave",
					note: null,
				},
			],
		});
		const [leaveMakeupAfterCompletion, balanceAfterLeave, leaveConsumption] =
			await Promise.all([
				listMakeupLessonRecords({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					sourceEnrollmentId: sourceEnrollment.enrollmentId,
				}),
				db
					.select({ remainingLessons: enrollment.remainingLessons })
					.from(enrollment)
					.where(eq(enrollment.id, sourceEnrollment.enrollmentId)),
				db
					.select({ id: lessonConsumption.id })
					.from(lessonConsumption)
					.where(
						and(
							eq(lessonConsumption.lessonId, leaveTargetLesson.id),
							eq(lessonConsumption.enrollmentId, sourceEnrollment.enrollmentId),
						),
					),
			]);
		assert.equal(
			leaveMakeupAfterCompletion.find(
				(item) => item.id === leaveMakeup.makeupLesson.id,
			)?.status,
			"needs_reschedule",
		);
		assert.equal(balanceAfterLeave[0]?.remainingLessons, 2);
		assert.equal(leaveConsumption.length, 0);
		const replacementLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-03-03T02:00:00.000Z"),
			endsAt: new Date("2032-03-03T03:00:00.000Z"),
		});
		const replacement = await createMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			sourceLessonId: leaveSourceLessonId,
			sourceEnrollmentId: sourceEnrollment.enrollmentId,
			targetLessonId: replacementLesson.id,
			requestId: randomUUID(),
		});
		const cancelledReplacement = await cancelMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: replacement.makeupLesson.id,
		});
		assert.equal(cancelledReplacement.makeupLesson.status, "cancelled");
		assert.equal(
			(
				await cancelMakeupLessonRecord({
					organizationId: ids.organizationId,
					userId: ids.adminId,
					id: replacement.makeupLesson.id,
				})
			).replayed,
			true,
		);
		const cancelledTargetLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-03-04T02:00:00.000Z"),
			endsAt: new Date("2032-03-04T03:00:00.000Z"),
		});
		const cancelledTargetMakeup = await createMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			sourceLessonId: leaveSourceLessonId,
			sourceEnrollmentId: sourceEnrollment.enrollmentId,
			targetLessonId: cancelledTargetLesson.id,
			requestId: randomUUID(),
		});
		await cancelLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			id: cancelledTargetLesson.id,
			reason: "目标课次取消",
		});
		assert.equal(
			(
				await listMakeupLessonRecords({
					organizationId: ids.organizationId,
					campusAccess: { kind: "all" },
					sourceEnrollmentId: sourceEnrollment.enrollmentId,
				})
			).find((item) => item.id === cancelledTargetMakeup.makeupLesson.id)
				?.status,
			"needs_reschedule",
		);
		const startedTargetLesson = await createLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: targetGroup.id,
			room: room.name,
			roomId: room.id,
			startsAt: new Date("2032-03-05T04:00:00.000Z"),
			endsAt: new Date("2032-03-05T05:00:00.000Z"),
		});
		const startedTargetMakeup = await createMakeupLessonRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			sourceLessonId: leaveSourceLessonId,
			sourceEnrollmentId: sourceEnrollment.enrollmentId,
			targetLessonId: startedTargetLesson.id,
			requestId: randomUUID(),
		});
		await db
			.update(lesson)
			.set({ startsAt: new Date("2020-03-05T04:00:00.000Z") })
			.where(eq(lesson.id, startedTargetLesson.id));
		await expectError(
			cancelMakeupLessonRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				id: startedTargetMakeup.makeupLesson.id,
			}),
			"MAKEUP_LESSON_INVALID",
		);
		const [sourceFact, sourceAttendance] = await Promise.all([
			db
				.select({ status: lesson.status })
				.from(lesson)
				.where(eq(lesson.id, sourceLessonId)),
			db
				.select({ status: attendance.status })
				.from(attendance)
				.where(
					and(
						eq(attendance.lessonId, sourceLessonId),
						eq(attendance.studentId, sourceEnrollment.studentId),
					),
				),
		]);
		assert.equal(sourceFact[0]?.status, "completed");
		assert.equal(sourceAttendance[0]?.status, "absent");
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
			startsAt: new Date("2020-08-03T02:00:00.000Z"),
			endsAt: new Date("2020-08-03T03:00:00.000Z"),
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
		const completionAuditsForFirstLesson = await db
			.select({
				organizationId: organizationAuditEvent.organizationId,
				actorUserId: organizationAuditEvent.actorUserId,
				entityType: organizationAuditEvent.entityType,
				entityId: organizationAuditEvent.entityId,
				campusId: organizationAuditEvent.campusId,
				after: organizationAuditEvent.after,
			})
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.action, "lesson_completed"),
					eq(organizationAuditEvent.entityId, lessonOne.id),
				),
			);
		assert.equal(completionAuditsForFirstLesson.length, 1);
		const [completionAudit] = completionAuditsForFirstLesson;
		assert.deepEqual(completionAudit, {
			organizationId: ids.organizationId,
			actorUserId: ids.managerId,
			entityType: "lesson",
			entityId: lessonOne.id,
			campusId: ids.campusA,
			after: {
				classGroupId: group.id,
				activeEnrollmentCount: 4,
			},
		});
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
			startsAt: new Date("2020-08-04T02:00:00.000Z"),
			endsAt: new Date("2020-08-04T03:00:00.000Z"),
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
		const completionAudits = await db
			.select({ entityId: organizationAuditEvent.entityId })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.action, "lesson_completed"),
				),
			);
		assert.deepEqual(
			completionAudits.map((item) => item.entityId).sort(),
			[lessonOne.id, lessonTwo.id].sort(),
		);
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
			startsAt: new Date("2020-08-05T02:00:00.000Z"),
			endsAt: new Date("2020-08-05T03:00:00.000Z"),
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
		const completionAudits = await db
			.select({ id: organizationAuditEvent.id })
			.from(organizationAuditEvent)
			.where(
				and(
					eq(organizationAuditEvent.organizationId, ids.organizationId),
					eq(organizationAuditEvent.action, "lesson_completed"),
					eq(organizationAuditEvent.entityId, scheduled.id),
				),
			);
		assert.equal(completionAudits.length, 0);
	} finally {
		await cleanup(ids);
	}
});

test("周期规则预览、原子生成与停用分支只影响未来待上课次", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { group } = await createClassFixture(ids);
		const rule = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [2],
				startMinuteOfDay: 9 * 60,
				room: "A301",
				validFrom: "2030-01-01",
				validUntil: "2030-01-15",
			},
		});
		await expectError(
			createScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				classGroupId: group.id,
				data: {
					weekdays: [2],
					startMinuteOfDay: 9 * 60,
					room: "A301",
					validFrom: "2030-01-01",
					validUntil: "2030-01-15",
				},
			}),
			"SCHEDULE_RULE_DUPLICATE",
		);
		const concurrentResults = await Promise.allSettled(
			[0, 1].map(() =>
				createScheduleRuleRecord({
					organizationId: ids.organizationId,
					userId: ids.adminId,
					classGroupId: group.id,
					data: {
						weekdays: [4],
						startMinuteOfDay: 8 * 60,
						room: "A303",
						validFrom: "2030-01-01",
						validUntil: "2030-01-15",
					},
				}),
			),
		);
		assert.equal(
			concurrentResults.filter((result) => result.status === "fulfilled")
				.length,
			1,
		);
		const rejected = concurrentResults.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		assert.ok(rejected?.reason instanceof TeachingRepositoryError);
		assert.equal(rejected.reason.code, "SCHEDULE_RULE_DUPLICATE");
		const preview = await previewScheduleGenerationRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: rule.id,
			from: "2030-01-01",
			to: "2030-01-15",
			overrides: [],
		});
		assert.ok(preview.candidates.length > 0);
		assert.ok(preview.candidates.every((item) => item.conflicts.length === 0));
		const generated = await generateScheduleLessonsRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: rule.id,
			expectedRevision: rule.revision,
			from: "2030-01-01",
			to: "2030-01-15",
			requestId: randomUUID(),
			candidates: preview.candidates.map((item) => ({
				occurrenceDate: item.occurrenceDate,
				startsAt: item.startsAt,
				room: item.room,
				roomId: item.roomId ?? "",
			})),
		});
		assert.equal(generated.replayed, false);
		assert.equal(generated.lessonIds.length, preview.candidates.length);
		const kept = await deactivateScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: rule.id,
			expectedRevision: rule.revision,
			cancelFuture: false,
			reason: null,
			requestId: randomUUID(),
		});
		assert.deepEqual(kept.cancelledLessonIds, []);
		const keptLessons = await db
			.select({ status: lesson.status })
			.from(lesson)
			.where(inArray(lesson.id, generated.lessonIds));
		assert.ok(keptLessons.every((item) => item.status === "scheduled"));
		await expectError(
			generateScheduleLessonsRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: rule.id,
				expectedRevision: rule.revision + 1,
				from: "2030-01-01",
				to: "2030-01-15",
				requestId: randomUUID(),
				candidates: [],
			}),
			"SCHEDULE_RULE_INACTIVE",
		);

		const cancellingRule = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [3],
				startMinuteOfDay: 11 * 60,
				room: "A302",
				validFrom: "2030-01-01",
				validUntil: "2030-01-15",
			},
		});
		const cancellationPreview = await previewScheduleGenerationRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: cancellingRule.id,
			from: "2030-01-01",
			to: "2030-01-15",
			overrides: [],
		});
		const cancellationGenerated = await generateScheduleLessonsRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: cancellingRule.id,
			expectedRevision: cancellingRule.revision,
			from: "2030-01-01",
			to: "2030-01-15",
			requestId: randomUUID(),
			candidates: cancellationPreview.candidates.map((item) => ({
				occurrenceDate: item.occurrenceDate,
				startsAt: item.startsAt,
				room: item.room,
				roomId: item.roomId ?? "",
			})),
		});
		const cancelled = await deactivateScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: cancellingRule.id,
			expectedRevision: cancellingRule.revision,
			cancelFuture: true,
			reason: "班级停课",
			requestId: randomUUID(),
		});
		assert.deepEqual(
			cancelled.cancelledLessonIds.sort(),
			cancellationGenerated.lessonIds.sort(),
		);
	} finally {
		await cleanup(ids);
	}
});

test("周期规则创建和修改会拒绝同班级未来时段重叠", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { group } = await createClassFixture(ids);
		const first = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [1, 2],
				startMinuteOfDay: 9 * 60 + 50,
				room: "A102",
				validFrom: "2030-08-01",
				validUntil: "2030-08-31",
			},
		});
		await expectError(
			createScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				classGroupId: group.id,
				data: {
					weekdays: [1, 3],
					startMinuteOfDay: 9 * 60 + 30,
					room: "A102",
					roomId: first.roomId ?? "",
					validFrom: "2030-08-01",
					validUntil: "2030-08-31",
				},
			}),
			"SCHEDULE_RULE_CONFLICT",
		);
		const second = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [3],
				startMinuteOfDay: 13 * 60,
				room: "A102",
				validFrom: "2030-08-01",
				validUntil: "2030-08-31",
			},
		});
		await expectError(
			previewScheduleRuleUpdateRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: second.id,
				expectedRevision: second.revision,
				data: {
					weekdays: [1, 3],
					startMinuteOfDay: 9 * 60 + 30,
					room: "A102",
					roomId: second.roomId ?? "",
					validFrom: "2030-08-01",
					validUntil: "2030-08-31",
				},
				effectiveFrom: "2030-08-01",
				reapplyOverrideLessonIds: [],
			}),
			"SCHEDULE_RULE_CONFLICT",
		);
		await expectError(
			updateScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: second.id,
				expectedRevision: second.revision,
				data: {
					weekdays: [1, 3],
					startMinuteOfDay: 9 * 60 + 30,
					room: "A102",
					roomId: second.roomId ?? "",
					validFrom: "2030-08-01",
					validUntil: "2030-08-31",
				},
				effectiveFrom: "2030-08-01",
				reapplyOverrideLessonIds: [],
				requestId: randomUUID(),
			}),
			"SCHEDULE_RULE_CONFLICT",
		);
		assert.equal(first.isActive, true);
	} finally {
		await cleanup(ids);
	}
});

test("未生成课次的周期规则可删除，已生成课次的规则保留追溯记录", async () => {
	const ids = createFixtureIds();
	try {
		await seed(ids);
		const { group } = await createClassFixture(ids);
		const emptyRule = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [1],
				startMinuteOfDay: 9 * 60,
				room: "A401",
				validFrom: "2030-09-01",
				validUntil: "2030-09-30",
			},
		});
		await deactivateScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: emptyRule.id,
			expectedRevision: emptyRule.revision,
			cancelFuture: false,
			reason: null,
			requestId: randomUUID(),
		});
		await deleteScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: emptyRule.id,
		});
		const [deletedRule, deletedBatch, deleteAudit] = await Promise.all([
			db
				.select({ id: lessonScheduleRule.id })
				.from(lessonScheduleRule)
				.where(eq(lessonScheduleRule.id, emptyRule.id)),
			db
				.select({ id: lessonScheduleBatch.id })
				.from(lessonScheduleBatch)
				.where(eq(lessonScheduleBatch.scheduleRuleId, emptyRule.id)),
			db
				.select({ id: organizationAuditEvent.id })
				.from(organizationAuditEvent)
				.where(
					and(
						eq(organizationAuditEvent.entityId, emptyRule.id),
						eq(organizationAuditEvent.action, "schedule_rule_deleted"),
					),
				),
		]);
		assert.equal(deletedRule.length, 0);
		assert.equal(deletedBatch.length, 0);
		assert.equal(deleteAudit.length, 1);

		const generatedRule = await createScheduleRuleRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			classGroupId: group.id,
			data: {
				weekdays: [2],
				startMinuteOfDay: 10 * 60,
				room: "A402",
				validFrom: "2030-09-01",
				validUntil: "2030-09-30",
			},
		});
		const preview = await previewScheduleGenerationRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: generatedRule.id,
			from: "2030-09-01",
			to: "2030-09-30",
			overrides: [],
		});
		await generateScheduleLessonsRecord({
			organizationId: ids.organizationId,
			userId: ids.adminId,
			ruleId: generatedRule.id,
			expectedRevision: generatedRule.revision,
			from: "2030-09-01",
			to: "2030-09-30",
			requestId: randomUUID(),
			candidates: preview.candidates.map((item) => ({
				occurrenceDate: item.occurrenceDate,
				startsAt: item.startsAt,
				room: item.room,
				roomId: item.roomId ?? "",
			})),
		});
		await expectError(
			deleteScheduleRuleRecord({
				organizationId: ids.organizationId,
				userId: ids.adminId,
				ruleId: generatedRule.id,
			}),
			"SCHEDULE_RULE_HAS_GENERATED_LESSONS",
		);
	} finally {
		await cleanup(ids);
	}
});
