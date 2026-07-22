import { createHash, randomUUID } from "node:crypto";

import { and, countDistinct, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	classGroup,
	classroom,
	enrollment,
	enrollmentLifecycleEvent,
	lesson,
	makeupLesson,
	type organizationMember,
	student,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { planEnrollmentBulkOperation } from "./student-enrollment-bulk";
import {
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	type Transaction,
} from "./teaching";

type EnrollmentStatus = (typeof enrollment.$inferSelect)["status"];
type LifecycleKind = (typeof enrollmentLifecycleEvent.$inferSelect)["kind"];
type MemberRole = (typeof organizationMember.$inferSelect)["role"];

const academicWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);
export type EnrollmentLifecycleErrorCode =
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "ENROLLMENT_NOT_FOUND"
	| "ENROLLMENT_NOT_ACTIVE"
	| "ENROLLMENT_NOT_FROZEN"
	| "ENROLLMENT_VERSION_CONFLICT"
	| "CLASS_NOT_FOUND"
	| "CLASS_COURSE_MISMATCH"
	| "CLASS_CAMPUS_MISMATCH"
	| "CLASS_NOT_AVAILABLE"
	| "CLASS_FULL"
	| "CLASS_STUDENT_DUPLICATE"
	| "IDEMPOTENCY_CONFLICT"
	| "INVALID_INPUT";

export class EnrollmentLifecycleError extends Error {
	constructor(
		public readonly code: EnrollmentLifecycleErrorCode,
		public readonly details?: {
			affectedLessons?: Array<{
				id: string;
				startsAt: Date;
				roomName: string;
				occupancy: number;
				capacity: number;
			}>;
		},
	) {
		super(code);
		this.name = "EnrollmentLifecycleError";
	}
}

export type EnrollmentLifecycleAction =
	| { kind: "freeze"; reason: string }
	| { kind: "resume"; reason: string }
	| { kind: "withdrawClass"; reason: string }
	| { kind: "assignClass"; classGroupId: string };

export type UpdateEnrollmentLifecycleRecordInput = {
	organizationId: string;
	userId: string;
	enrollmentId: string;
	expectedVersion: number;
	requestId: string;
	action: EnrollmentLifecycleAction;
};

export type UpdateEnrollmentLifecycleRecordResult = {
	enrollmentId: string;
	status: EnrollmentStatus;
	classGroupId: string | null;
	version: number;
	replayed: boolean;
};

function inputHash(input: UpdateEnrollmentLifecycleRecordInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				enrollmentId: input.enrollmentId,
				expectedVersion: input.expectedVersion,
				action: input.action,
			}),
		)
		.digest("hex");
}

function lifecycleKindFor(action: EnrollmentLifecycleAction): LifecycleKind {
	switch (action.kind) {
		case "freeze":
			return "frozen";
		case "resume":
			return "resumed";
		case "withdrawClass":
			return "class_withdrawn";
		case "assignClass":
			return "class_assigned";
	}
}

function auditActionFor(
	kind: LifecycleKind,
):
	| "enrollment_frozen"
	| "enrollment_resumed"
	| "enrollment_class_transferred"
	| "enrollment_class_withdrawn" {
	switch (kind) {
		case "frozen":
			return "enrollment_frozen";
		case "resumed":
			return "enrollment_resumed";
		case "class_withdrawn":
			return "enrollment_class_withdrawn";
		case "class_assigned":
		case "class_transferred":
			return "enrollment_class_transferred";
	}
}

async function assertTargetClass(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: Parameters<typeof assertWritableCampus>[1]["campusAccess"];
		studentCampusId: string;
		courseId: string;
		studentId: string;
		sourceEnrollmentId: string;
		classGroupId: string;
		now: Date;
	},
): Promise<void> {
	const [target] = await tx
		.select({
			id: classGroup.id,
			campusId: classGroup.campusId,
			courseId: classGroup.courseId,
			status: classGroup.status,
			capacity: classGroup.capacity,
		})
		.from(classGroup)
		.where(
			and(
				eq(classGroup.id, input.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!target) throw new EnrollmentLifecycleError("CLASS_NOT_FOUND");
	await assertWritableCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: input.campusAccess,
		campusId: target.campusId,
	});
	if (target.courseId !== input.courseId) {
		throw new EnrollmentLifecycleError("CLASS_COURSE_MISMATCH");
	}
	if (target.campusId !== input.studentCampusId) {
		throw new EnrollmentLifecycleError("CLASS_CAMPUS_MISMATCH");
	}
	if (target.status !== "recruiting" && target.status !== "running") {
		throw new EnrollmentLifecycleError("CLASS_NOT_AVAILABLE");
	}

	const [duplicate] = await tx
		.select({ id: enrollment.id })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.classGroupId, target.id),
				eq(enrollment.studentId, input.studentId),
				eq(enrollment.status, "active"),
			),
		)
		.limit(1)
		.for("update");
	if (duplicate && duplicate.id !== input.sourceEnrollmentId) {
		throw new EnrollmentLifecycleError("CLASS_STUDENT_DUPLICATE");
	}

	const [occupancy] = await tx
		.select({ value: countDistinct(enrollment.studentId) })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.classGroupId, target.id),
				eq(enrollment.status, "active"),
			),
		);
	const alreadyOccupies = duplicate?.id === input.sourceEnrollmentId;
	if (!alreadyOccupies && (occupancy?.value ?? 0) >= target.capacity) {
		throw new EnrollmentLifecycleError("CLASS_FULL");
	}

	const futureLessons = await tx
		.select({
			id: lesson.id,
			startsAt: lesson.startsAt,
			roomName: lesson.room,
			capacity: classroom.capacity,
		})
		.from(lesson)
		.innerJoin(
			classroom,
			and(
				eq(classroom.id, lesson.roomId),
				eq(classroom.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(lesson.organizationId, input.organizationId),
				eq(lesson.classGroupId, target.id),
				eq(lesson.status, "scheduled"),
				gt(lesson.startsAt, input.now),
			),
		)
		.for("update");
	if (futureLessons.length === 0) return;
	const makeupCounts = await tx
		.select({
			lessonId: makeupLesson.targetLessonId,
			value: sql<number>`count(*)::int`,
		})
		.from(makeupLesson)
		.where(
			and(
				eq(makeupLesson.organizationId, input.organizationId),
				eq(makeupLesson.status, "scheduled"),
				inArray(
					makeupLesson.targetLessonId,
					futureLessons.map((item) => item.id),
				),
			),
		)
		.groupBy(makeupLesson.targetLessonId);
	const makeupByLesson = new Map(
		makeupCounts.map((item) => [item.lessonId, item.value]),
	);
	const affectedLessons = futureLessons
		.map((item) => ({
			id: item.id,
			startsAt: item.startsAt,
			roomName: item.roomName,
			occupancy:
				(occupancy?.value ?? 0) +
				(makeupByLesson.get(item.id) ?? 0) +
				(alreadyOccupies ? 0 : 1),
			capacity: item.capacity,
		}))
		.filter((item) => item.occupancy > item.capacity);
	if (affectedLessons.length > 0) {
		throw new EnrollmentLifecycleError("CLASS_FULL", { affectedLessons });
	}
}

export async function updateEnrollmentLifecycleRecord(
	input: UpdateEnrollmentLifecycleRecordInput,
): Promise<UpdateEnrollmentLifecycleRecordResult> {
	if (
		!Number.isSafeInteger(input.expectedVersion) ||
		input.expectedVersion < 1
	) {
		throw new EnrollmentLifecycleError("INVALID_INPUT");
	}
	const requestHash = inputHash(input);
	return db.transaction(async (tx) => {
		const access = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: academicWriteRoles,
		});
		const [replay] = await tx
			.select({
				inputHash: enrollmentLifecycleEvent.inputHash,
				enrollmentId: enrollmentLifecycleEvent.enrollmentId,
				afterStatus: enrollmentLifecycleEvent.afterStatus,
				toClassGroupId: enrollmentLifecycleEvent.toClassGroupId,
			})
			.from(enrollmentLifecycleEvent)
			.where(
				and(
					eq(enrollmentLifecycleEvent.organizationId, input.organizationId),
					eq(enrollmentLifecycleEvent.requestId, input.requestId),
				),
			)
			.limit(1)
			.for("update");
		if (replay) {
			if (replay.inputHash !== requestHash) {
				throw new EnrollmentLifecycleError("IDEMPOTENCY_CONFLICT");
			}
			const [current] = await tx
				.select({ version: enrollment.version })
				.from(enrollment)
				.where(eq(enrollment.id, replay.enrollmentId))
				.limit(1);
			return {
				enrollmentId: replay.enrollmentId,
				status: replay.afterStatus,
				classGroupId: replay.toClassGroupId,
				version: current?.version ?? input.expectedVersion,
				replayed: true,
			};
		}

		const [record] = await tx
			.select({
				id: enrollment.id,
				studentId: enrollment.studentId,
				courseId: enrollment.courseId,
				classGroupId: enrollment.classGroupId,
				status: enrollment.status,
				version: enrollment.version,
				studentCampusId: student.campusId,
			})
			.from(enrollment)
			.innerJoin(
				student,
				and(
					eq(student.id, enrollment.studentId),
					eq(student.organizationId, input.organizationId),
				),
			)
			.where(
				and(
					eq(enrollment.id, input.enrollmentId),
					eq(enrollment.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!record) throw new EnrollmentLifecycleError("ENROLLMENT_NOT_FOUND");
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: access,
			campusId: record.studentCampusId,
		});
		if (record.version !== input.expectedVersion) {
			throw new EnrollmentLifecycleError("ENROLLMENT_VERSION_CONFLICT");
		}

		const now = new Date();
		let afterStatus = record.status;
		let toClassGroupId = record.classGroupId;
		switch (input.action.kind) {
			case "freeze":
				if (record.status !== "active") {
					throw new EnrollmentLifecycleError("ENROLLMENT_NOT_ACTIVE");
				}
				afterStatus = "frozen";
				break;
			case "resume":
				if (record.status !== "frozen") {
					throw new EnrollmentLifecycleError("ENROLLMENT_NOT_FROZEN");
				}
				afterStatus = "active";
				if (record.classGroupId) {
					await assertTargetClass(tx, {
						organizationId: input.organizationId,
						campusAccess: access,
						studentCampusId: record.studentCampusId,
						courseId: record.courseId,
						studentId: record.studentId,
						sourceEnrollmentId: record.id,
						classGroupId: record.classGroupId,
						now,
					});
				}
				break;
			case "withdrawClass":
				if (record.status === "transferred") {
					throw new EnrollmentLifecycleError("ENROLLMENT_NOT_ACTIVE");
				}
				if (!record.classGroupId) {
					throw new EnrollmentLifecycleError("INVALID_INPUT");
				}
				toClassGroupId = null;
				break;
			case "assignClass": {
				if (record.status !== "active") {
					throw new EnrollmentLifecycleError("ENROLLMENT_NOT_ACTIVE");
				}
				if (record.classGroupId === input.action.classGroupId) {
					throw new EnrollmentLifecycleError("INVALID_INPUT");
				}
				const classPlan = await planEnrollmentBulkOperation(tx, {
					organizationId: input.organizationId,
					campusAccess: access,
					kind: "assignEnrollmentClass",
					classGroupId: input.action.classGroupId,
					targets: [
						{
							enrollmentId: record.id,
							expectedVersion: record.version,
						},
					],
				});
				const blockerCode = classPlan.items[0]?.blockerCode;
				if (blockerCode) {
					throw new EnrollmentLifecycleError(blockerCode);
				}
				toClassGroupId = input.action.classGroupId;
				break;
			}
		}

		const kind: LifecycleKind =
			input.action.kind === "assignClass" && record.classGroupId
				? "class_transferred"
				: lifecycleKindFor(input.action);
		const [event] = await tx
			.insert(enrollmentLifecycleEvent)
			.values({
				organizationId: input.organizationId,
				enrollmentId: record.id,
				kind,
				beforeStatus: record.status,
				afterStatus,
				fromClassGroupId: record.classGroupId,
				toClassGroupId,
				effectiveAt: now,
				reason: "reason" in input.action ? input.action.reason.trim() : null,
				operatorUserId: input.userId,
				requestId: input.requestId,
				inputHash: requestHash,
			})
			.returning({ id: enrollmentLifecycleEvent.id });
		if (!event) throw new EnrollmentLifecycleError("INVALID_INPUT");
		const [updated] = await tx
			.update(enrollment)
			.set({
				status: afterStatus,
				classGroupId: toClassGroupId,
				version: sql`${enrollment.version} + 1`,
			})
			.where(eq(enrollment.id, record.id))
			.returning({ version: enrollment.version });
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: auditActionFor(kind),
			entityType: "enrollment_lifecycle_event",
			entityId: event.id,
			actorUserId: input.userId,
			campusId: record.studentCampusId,
			before: {
				status: record.status,
				classGroupId: record.classGroupId,
			},
			after: {
				status: afterStatus,
				classGroupId: toClassGroupId,
				requestId: input.requestId,
			},
		});
		return {
			enrollmentId: record.id,
			status: afterStatus,
			classGroupId: toClassGroupId,
			version: updated?.version ?? record.version + 1,
			replayed: false,
		};
	});
}

/**
 * 旧的班级成员接口没有版本与请求 ID。保留它仅作为兼容适配层，实际写入仍统一进入生命周期事件。
 */
export async function assignEnrollmentClassLegacyRecord(input: {
	organizationId: string;
	userId: string;
	enrollmentId: string;
	classGroupId: string | null;
}): Promise<void> {
	const [current] = await db
		.select({
			version: enrollment.version,
			classGroupId: enrollment.classGroupId,
		})
		.from(enrollment)
		.where(
			and(
				eq(enrollment.id, input.enrollmentId),
				eq(enrollment.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!current) throw new EnrollmentLifecycleError("ENROLLMENT_NOT_FOUND");
	await updateEnrollmentLifecycleRecord({
		...input,
		expectedVersion: current.version,
		requestId: randomUUID(),
		action: input.classGroupId
			? { kind: "assignClass", classGroupId: input.classGroupId }
			: { kind: "withdrawClass", reason: "兼容班级成员操作" },
	});
}
