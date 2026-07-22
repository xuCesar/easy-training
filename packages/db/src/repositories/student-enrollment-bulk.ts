import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	classGroup,
	classroom,
	course,
	enrollment,
	enrollmentLifecycleEvent,
	lesson,
	makeupLesson,
	type organizationMember,
	student,
	studentBulkOperationBatch,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";
import {
	getCurrentStudentWriteCampusAccess,
	StudentRepositoryError,
} from "./students";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EnrollmentBulkTarget = { enrollmentId: string; expectedVersion: number };

export type EnrollmentBulkOperationInput =
	| {
			kind: "assignEnrollmentClass";
			targets: EnrollmentBulkTarget[];
			classGroupId: string;
	  }
	| { kind: "withdrawEnrollmentClass"; targets: EnrollmentBulkTarget[] };

export type EnrollmentBulkBlockerCode =
	| "ENROLLMENT_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "ENROLLMENT_VERSION_CONFLICT"
	| "ENROLLMENT_NOT_ACTIVE"
	| "CLASS_NOT_FOUND"
	| "CLASS_COURSE_MISMATCH"
	| "CLASS_CAMPUS_MISMATCH"
	| "CLASS_NOT_AVAILABLE"
	| "CLASS_FULL"
	| "CLASS_STUDENT_DUPLICATE";

export type EnrollmentBulkPreviewItem = {
	enrollmentId: string;
	studentId: string | null;
	studentName: string | null;
	courseName: string | null;
	status: "change" | "no_change" | "blocked";
	blockerCode: EnrollmentBulkBlockerCode | null;
	beforeClassGroupId: string | null;
	beforeClassName: string | null;
	afterClassGroupId: string | null;
	afterClassName: string | null;
};

export class EnrollmentBulkOperationError extends Error {
	constructor(
		public readonly code:
			| "MEMBER_FORBIDDEN"
			| "BULK_BLOCKED"
			| "IDEMPOTENCY_CONFLICT",
		public readonly items: EnrollmentBulkPreviewItem[] = [],
	) {
		super(code);
		this.name = "EnrollmentBulkOperationError";
	}
}

const managementRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager"]);

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function summarize(items: EnrollmentBulkPreviewItem[]) {
	return {
		items,
		changeCount: items.filter((item) => item.status === "change").length,
		noChangeCount: items.filter((item) => item.status === "no_change").length,
		blockedCount: items.filter((item) => item.status === "blocked").length,
	};
}

function blockItem(
	item: EnrollmentBulkPreviewItem,
	code: EnrollmentBulkBlockerCode,
): void {
	if (item.status !== "change") return;
	item.status = "blocked";
	item.blockerCode = code;
}

export async function planEnrollmentBulkOperation(
	tx: Transaction,
	input: EnrollmentBulkOperationInput & {
		organizationId: string;
		campusAccess: CampusAccess;
	},
) {
	const targets = [...input.targets].sort((left, right) =>
		left.enrollmentId.localeCompare(right.enrollmentId),
	);
	const sourceClass = alias(classGroup, "enrollment_bulk_source_class");
	const records = await tx
		.select({
			id: enrollment.id,
			studentId: enrollment.studentId,
			studentName: student.name,
			studentCampusId: student.campusId,
			courseId: enrollment.courseId,
			courseName: course.name,
			classGroupId: enrollment.classGroupId,
			className: sourceClass.name,
			status: enrollment.status,
			version: enrollment.version,
		})
		.from(enrollment)
		.innerJoin(
			student,
			and(
				eq(student.id, enrollment.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			sourceClass,
			and(
				eq(sourceClass.id, enrollment.classGroupId),
				eq(sourceClass.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				inArray(
					enrollment.id,
					targets.map((target) => target.enrollmentId),
				),
			),
		)
		.orderBy(asc(enrollment.id))
		.for("update", { of: enrollment });
	const recordById = new Map(records.map((record) => [record.id, record]));

	let targetClass: {
		id: string;
		name: string;
		campusId: string;
		courseId: string;
		status: (typeof classGroup.$inferSelect)["status"];
		capacity: number;
	} | null = null;
	if (input.kind === "assignEnrollmentClass") {
		[targetClass = null] = await tx
			.select({
				id: classGroup.id,
				name: classGroup.name,
				campusId: classGroup.campusId,
				courseId: classGroup.courseId,
				status: classGroup.status,
				capacity: classGroup.capacity,
			})
			.from(classGroup)
			.where(
				and(
					eq(classGroup.organizationId, input.organizationId),
					eq(classGroup.id, input.classGroupId),
				),
			)
			.limit(1)
			.for("update");
	}

	const items: EnrollmentBulkPreviewItem[] = [];
	for (const target of targets) {
		const record = recordById.get(target.enrollmentId);
		if (!record) {
			items.push({
				enrollmentId: target.enrollmentId,
				studentId: null,
				studentName: null,
				courseName: null,
				status: "blocked",
				blockerCode: "ENROLLMENT_NOT_FOUND",
				beforeClassGroupId: null,
				beforeClassName: null,
				afterClassGroupId: null,
				afterClassName: null,
			});
			continue;
		}
		const base = {
			enrollmentId: record.id,
			studentId: record.studentId,
			studentName: record.studentName,
			courseName: record.courseName,
			beforeClassGroupId: record.classGroupId,
			beforeClassName: record.className,
			afterClassGroupId:
				input.kind === "assignEnrollmentClass" ? input.classGroupId : null,
			afterClassName:
				input.kind === "assignEnrollmentClass"
					? (targetClass?.name ?? null)
					: null,
		};
		if (!isCampusAccessible(input.campusAccess, record.studentCampusId)) {
			items.push({
				...base,
				status: "blocked",
				blockerCode: "CAMPUS_OUT_OF_SCOPE",
			});
			continue;
		}
		if (record.version !== target.expectedVersion) {
			items.push({
				...base,
				status: "blocked",
				blockerCode: "ENROLLMENT_VERSION_CONFLICT",
			});
			continue;
		}
		if (record.status !== "active") {
			items.push({
				...base,
				status: "blocked",
				blockerCode: "ENROLLMENT_NOT_ACTIVE",
			});
			continue;
		}
		if (input.kind === "withdrawEnrollmentClass") {
			items.push({
				...base,
				status: record.classGroupId ? "change" : "no_change",
				blockerCode: null,
			});
			continue;
		}
		if (!targetClass) {
			items.push({
				...base,
				status: "blocked",
				blockerCode: "CLASS_NOT_FOUND",
			});
			continue;
		}
		let blockerCode: EnrollmentBulkBlockerCode | null = null;
		if (!isCampusAccessible(input.campusAccess, targetClass.campusId)) {
			blockerCode = "CAMPUS_OUT_OF_SCOPE";
		} else if (targetClass.courseId !== record.courseId) {
			blockerCode = "CLASS_COURSE_MISMATCH";
		} else if (targetClass.campusId !== record.studentCampusId) {
			blockerCode = "CLASS_CAMPUS_MISMATCH";
		} else if (
			targetClass.status !== "recruiting" &&
			targetClass.status !== "running"
		) {
			blockerCode = "CLASS_NOT_AVAILABLE";
		}
		items.push({
			...base,
			status:
				blockerCode !== null
					? "blocked"
					: record.classGroupId === targetClass.id
						? "no_change"
						: "change",
			blockerCode,
		});
	}

	const changedItems = items.filter((item) => item.status === "change");
	if (changedItems.length === 0) return summarize(items);
	const touchedClassIds = Array.from(
		new Set(
			changedItems.flatMap((item) =>
				[item.beforeClassGroupId, item.afterClassGroupId].filter(
					(value): value is string => value !== null,
				),
			),
		),
	).sort();
	if (touchedClassIds.length === 0) return summarize(items);

	const lockedClasses = await tx
		.select({
			id: classGroup.id,
			capacity: classGroup.capacity,
		})
		.from(classGroup)
		.where(
			and(
				eq(classGroup.organizationId, input.organizationId),
				inArray(classGroup.id, touchedClassIds),
			),
		)
		.orderBy(asc(classGroup.id))
		.for("update");
	const classCapacityById = new Map(
		lockedClasses.map((item) => [item.id, item.capacity]),
	);
	const activeEnrollments = await tx
		.select({
			id: enrollment.id,
			studentId: enrollment.studentId,
			classGroupId: enrollment.classGroupId,
		})
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.status, "active"),
				inArray(enrollment.classGroupId, touchedClassIds),
			),
		)
		.orderBy(asc(enrollment.id))
		.for("update");
	const finalClassByEnrollmentId = new Map(
		activeEnrollments.map((record) => [record.id, record.classGroupId]),
	);
	for (const item of changedItems) {
		finalClassByEnrollmentId.set(item.enrollmentId, item.afterClassGroupId);
	}
	const studentByEnrollmentId = new Map(
		activeEnrollments.map((record) => [record.id, record.studentId]),
	);
	for (const record of records) {
		studentByEnrollmentId.set(record.id, record.studentId);
	}
	const studentsByClass = new Map<string, Map<string, number>>();
	for (const [enrollmentId, finalClassId] of finalClassByEnrollmentId) {
		if (!finalClassId) continue;
		const studentId = studentByEnrollmentId.get(enrollmentId);
		if (!studentId) continue;
		const counts =
			studentsByClass.get(finalClassId) ?? new Map<string, number>();
		counts.set(studentId, (counts.get(studentId) ?? 0) + 1);
		studentsByClass.set(finalClassId, counts);
	}
	for (const item of changedItems) {
		const afterClassId = item.afterClassGroupId;
		if (!afterClassId || !item.studentId) continue;
		if ((studentsByClass.get(afterClassId)?.get(item.studentId) ?? 0) > 1) {
			blockItem(item, "CLASS_STUDENT_DUPLICATE");
		}
	}

	const occupancyByClass = new Map<string, number>();
	for (const [classId, studentCounts] of studentsByClass) {
		occupancyByClass.set(classId, studentCounts.size);
		if (
			studentCounts.size > (classCapacityById.get(classId) ?? Number.MAX_VALUE)
		) {
			for (const item of changedItems) {
				if (item.afterClassGroupId === classId) blockItem(item, "CLASS_FULL");
			}
		}
	}

	const futureLessons = await tx
		.select({
			id: lesson.id,
			classGroupId: lesson.classGroupId,
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
				inArray(lesson.classGroupId, touchedClassIds),
				eq(lesson.status, "scheduled"),
				gt(lesson.startsAt, new Date()),
			),
		)
		.orderBy(asc(lesson.id))
		.for("update");
	if (futureLessons.length > 0) {
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
		const fullClassIds = new Set(
			futureLessons
				.filter(
					(item) =>
						(occupancyByClass.get(item.classGroupId) ?? 0) +
							(makeupByLesson.get(item.id) ?? 0) >
						item.capacity,
				)
				.map((item) => item.classGroupId),
		);
		for (const item of changedItems) {
			if (item.afterClassGroupId && fullClassIds.has(item.afterClassGroupId)) {
				blockItem(item, "CLASS_FULL");
			}
		}
	}
	return summarize(items);
}

function createInputHash(
	input: EnrollmentBulkOperationInput & { userId: string },
): string {
	return createHash("sha256")
		.update(JSON.stringify(input), "utf8")
		.digest("hex");
}

export async function listStudentActiveEnrollmentOptionsRecord(input: {
	organizationId: string;
	userId: string;
	studentIds: string[];
}) {
	try {
		return await db.transaction(async (tx) => {
			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: managementRoles,
			});
			const currentClass = alias(classGroup, "active_enrollment_current_class");
			const rows = await tx
				.select({
					enrollmentId: enrollment.id,
					studentId: student.id,
					studentName: student.name,
					studentCampusId: student.campusId,
					courseId: course.id,
					courseName: course.name,
					classGroupId: enrollment.classGroupId,
					className: currentClass.name,
					version: enrollment.version,
				})
				.from(enrollment)
				.innerJoin(
					student,
					and(
						eq(student.id, enrollment.studentId),
						eq(student.organizationId, input.organizationId),
					),
				)
				.innerJoin(
					course,
					and(
						eq(course.id, enrollment.courseId),
						eq(course.organizationId, input.organizationId),
					),
				)
				.leftJoin(
					currentClass,
					and(
						eq(currentClass.id, enrollment.classGroupId),
						eq(currentClass.organizationId, input.organizationId),
					),
				)
				.where(
					and(
						eq(enrollment.organizationId, input.organizationId),
						eq(enrollment.status, "active"),
						inArray(student.id, input.studentIds),
					),
				)
				.orderBy(asc(student.name), asc(course.name), asc(enrollment.id));
			return rows.filter((row) =>
				isCampusAccessible(campusAccess, row.studentCampusId),
			);
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new EnrollmentBulkOperationError("MEMBER_FORBIDDEN");
		}
		throw error;
	}
}

export async function previewEnrollmentBulkOperationRecord(
	input: EnrollmentBulkOperationInput & {
		organizationId: string;
		userId: string;
	},
) {
	try {
		return await db.transaction(async (tx) => {
			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: managementRoles,
			});
			return planEnrollmentBulkOperation(tx, { ...input, campusAccess });
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new EnrollmentBulkOperationError("MEMBER_FORBIDDEN");
		}
		throw error;
	}
}

export async function commitEnrollmentBulkOperationRecord(
	input: EnrollmentBulkOperationInput & {
		organizationId: string;
		userId: string;
		requestId: string;
	},
) {
	const inputHash = createInputHash(input);
	try {
		return await db.transaction(async (tx) => {
			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: managementRoles,
			});
			const [existing] = await tx
				.select()
				.from(studentBulkOperationBatch)
				.where(
					and(
						eq(studentBulkOperationBatch.organizationId, input.organizationId),
						eq(studentBulkOperationBatch.requestId, input.requestId),
					),
				)
				.limit(1)
				.for("update");
			if (existing) {
				if (existing.inputHash !== inputHash) {
					throw new EnrollmentBulkOperationError("IDEMPOTENCY_CONFLICT");
				}
				return {
					batchId: existing.id,
					changedCount: existing.changedCount,
					unchangedCount: existing.unchangedCount,
					replayed: true,
				};
			}
			const plan = await planEnrollmentBulkOperation(tx, {
				...input,
				campusAccess,
			});
			if (plan.blockedCount > 0) {
				throw new EnrollmentBulkOperationError("BULK_BLOCKED", plan.items);
			}
			const [batch] = await tx
				.insert(studentBulkOperationBatch)
				.values({
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash,
					kind:
						input.kind === "assignEnrollmentClass"
							? "assign_class"
							: "withdraw_class",
					targetCount: input.targets.length,
					changedCount: plan.changeCount,
					unchangedCount: plan.noChangeCount,
					targetIds: input.targets.map((target) => target.enrollmentId).sort(),
					createdByUserId: input.userId,
				})
				.returning({ id: studentBulkOperationBatch.id });
			if (!batch)
				throw new Error("Enrollment bulk batch insert returned no row.");

			const expectedVersionById = new Map(
				input.targets.map((target) => [
					target.enrollmentId,
					target.expectedVersion,
				]),
			);
			const effectiveAt = new Date();
			for (const item of plan.items.filter(
				(candidate) => candidate.status === "change",
			)) {
				const expectedVersion = expectedVersionById.get(item.enrollmentId);
				if (!expectedVersion) throw new Error("Enrollment version was lost.");
				const eventRequestId = randomUUID();
				const eventKind = item.beforeClassGroupId
					? item.afterClassGroupId
						? "class_transferred"
						: "class_withdrawn"
					: "class_assigned";
				await tx.insert(enrollmentLifecycleEvent).values({
					organizationId: input.organizationId,
					enrollmentId: item.enrollmentId,
					kind: eventKind,
					beforeStatus: "active",
					afterStatus: "active",
					fromClassGroupId: item.beforeClassGroupId,
					toClassGroupId: item.afterClassGroupId,
					effectiveAt,
					reason:
						input.kind === "withdrawEnrollmentClass" ? "批量移出班级" : null,
					operatorUserId: input.userId,
					requestId: eventRequestId,
					inputHash: createHash("sha256")
						.update(
							JSON.stringify({
								batchId: batch.id,
								enrollmentId: item.enrollmentId,
								fromClassGroupId: item.beforeClassGroupId,
								toClassGroupId: item.afterClassGroupId,
							}),
						)
						.digest("hex"),
					bulkOperationBatchId: batch.id,
				});
				const [updated] = await tx
					.update(enrollment)
					.set({
						classGroupId: item.afterClassGroupId,
						version: sql`${enrollment.version} + 1`,
					})
					.where(
						and(
							eq(enrollment.id, item.enrollmentId),
							eq(enrollment.organizationId, input.organizationId),
							eq(enrollment.status, "active"),
							eq(enrollment.version, expectedVersion),
						),
					)
					.returning({ id: enrollment.id });
				if (!updated) {
					throw new EnrollmentBulkOperationError("BULK_BLOCKED", plan.items);
				}
			}
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "students_bulk_updated",
				entityType: "student_bulk_operation_batch",
				entityId: batch.id,
				actorUserId: input.userId,
				after: {
					requestId: input.requestId,
					kind: input.kind,
					targetCount: input.targets.length,
					changedCount: plan.changeCount,
					unchangedCount: plan.noChangeCount,
					targetIds: input.targets.map((target) => target.enrollmentId).sort(),
				},
			});
			return {
				batchId: batch.id,
				changedCount: plan.changeCount,
				unchangedCount: plan.noChangeCount,
				replayed: false,
			};
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new EnrollmentBulkOperationError("MEMBER_FORBIDDEN");
		}
		throw error;
	}
}
