import { and, asc, countDistinct, eq, gt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	classGroup,
	classroom,
	enrollment,
	lesson,
	makeupLesson,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	normalizeRoom,
	TeachingRepositoryError,
	type Transaction,
} from "./teaching";

export type ClassroomRepositoryErrorCode =
	| "CLASSROOM_NOT_FOUND"
	| "CLASSROOM_DUPLICATE"
	| "CLASSROOM_INACTIVE"
	| "CLASSROOM_HAS_FUTURE_LESSONS"
	| "INVALID_INPUT"
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_NOT_FOUND"
	| "CAMPUS_INACTIVE";

export class ClassroomRepositoryError extends Error {
	constructor(
		public readonly code: ClassroomRepositoryErrorCode,
		public readonly details?: {
			affectedLessons?: Array<{
				id: string;
				className: string;
				startsAt: Date;
				roomName: string;
				occupancy?: number;
				capacity?: number;
			}>;
		},
	) {
		super(code);
		this.name = "ClassroomRepositoryError";
	}
}

export type ClassroomRecord = typeof classroom.$inferSelect;

function ensureCapacity(value: number) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new ClassroomRepositoryError("INVALID_INPUT");
	}
}

function normalizeClassroomName(value: string) {
	try {
		return normalizeRoom(value);
	} catch {
		throw new ClassroomRepositoryError("INVALID_INPUT");
	}
}

async function getClassroomWriteCampusAccess(
	tx: Transaction,
	input: { organizationId: string; userId: string },
) {
	try {
		return await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: new Set(["owner", "admin", "campus_manager"]),
		});
	} catch (error) {
		if (
			error instanceof TeachingRepositoryError &&
			error.code === "MEMBER_FORBIDDEN"
		) {
			throw new ClassroomRepositoryError(error.code);
		}
		throw error;
	}
}

async function assertCampusForWrite(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: Awaited<ReturnType<typeof getCurrentWriteCampusAccess>>;
		campusId: string;
	},
) {
	try {
		await assertWritableCampus(tx, {
			organizationId: input.organizationId,
			campusAccess: input.campusAccess,
			campusId: input.campusId,
		});
	} catch (error) {
		if (
			error instanceof TeachingRepositoryError &&
			(error.code === "MEMBER_FORBIDDEN" ||
				error.code === "CAMPUS_OUT_OF_SCOPE" ||
				error.code === "CAMPUS_NOT_FOUND" ||
				error.code === "CAMPUS_INACTIVE")
		) {
			throw new ClassroomRepositoryError(error.code);
		}
		throw error;
	}
}

async function assertFutureLessonsFitCapacity(
	tx: Transaction,
	input: {
		organizationId: string;
		roomId: string;
		capacity: number;
		transactionNow: Date;
	},
) {
	const futureLessons = await tx
		.select({
			id: lesson.id,
			classGroupId: lesson.classGroupId,
			className: classGroup.name,
			startsAt: lesson.startsAt,
			roomName: lesson.room,
		})
		.from(lesson)
		.innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
		.where(
			and(
				eq(lesson.organizationId, input.organizationId),
				eq(lesson.roomId, input.roomId),
				eq(lesson.status, "scheduled"),
				gt(lesson.startsAt, input.transactionNow),
			),
		)
		.orderBy(asc(lesson.id));
	if (futureLessons.length === 0) return;

	const classGroupIds = [
		...new Set(futureLessons.map((item) => item.classGroupId)),
	];
	const activeEnrollmentCounts = await tx
		.select({
			classGroupId: enrollment.classGroupId,
			value: countDistinct(enrollment.studentId),
		})
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				inArray(enrollment.classGroupId, classGroupIds),
				eq(enrollment.status, "active"),
			),
		)
		.groupBy(enrollment.classGroupId);
	const activeEnrollmentCountByClassGroupId = new Map(
		activeEnrollmentCounts.map((item) => [item.classGroupId, item.value]),
	);

	const makeupEnrollment = alias(
		enrollment,
		"classroom_capacity_makeup_enrollment",
	);
	const makeupCounts = await tx
		.select({
			lessonId: makeupLesson.targetLessonId,
			value: countDistinct(makeupEnrollment.studentId),
		})
		.from(makeupLesson)
		.innerJoin(
			makeupEnrollment,
			and(
				eq(makeupEnrollment.id, makeupLesson.sourceEnrollmentId),
				eq(makeupEnrollment.organizationId, input.organizationId),
			),
		)
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
	const makeupCountByLessonId = new Map(
		makeupCounts.map((item) => [item.lessonId, item.value]),
	);

	const affectedLessons = futureLessons
		.map((item) => ({
			id: item.id,
			className: item.className,
			startsAt: item.startsAt,
			roomName: item.roomName,
			occupancy:
				(activeEnrollmentCountByClassGroupId.get(item.classGroupId) ?? 0) +
				(makeupCountByLessonId.get(item.id) ?? 0),
			capacity: input.capacity,
		}))
		.filter((item) => (item.occupancy ?? 0) > input.capacity);
	if (affectedLessons.length > 0) {
		throw new ClassroomRepositoryError("INVALID_INPUT", { affectedLessons });
	}
}

function toSnapshot(record: ClassroomRecord) {
	return {
		campusId: record.campusId,
		name: record.name,
		capacity: record.capacity,
		isActive: record.isActive,
	};
}

export async function listClassroomRecords(input: {
	organizationId: string;
	campusAccess:
		| { kind: "all" }
		| { kind: "selected"; campusIds: string[] }
		| { kind: "none" };
	campusId?: string;
	includeInactive?: boolean;
}): Promise<ClassroomRecord[]> {
	if (input.campusAccess.kind === "none") return [];
	const filters = [eq(classroom.organizationId, input.organizationId)];
	if (input.campusId) filters.push(eq(classroom.campusId, input.campusId));
	if (!input.includeInactive) filters.push(eq(classroom.isActive, true));
	if (input.campusAccess.kind === "selected") {
		filters.push(inArray(classroom.campusId, input.campusAccess.campusIds));
	}
	return db
		.select()
		.from(classroom)
		.where(and(...filters))
		.orderBy(asc(classroom.campusId), asc(classroom.name), asc(classroom.id));
}

export async function createClassroomRecord(input: {
	organizationId: string;
	userId: string;
	campusId: string;
	name: string;
	capacity: number;
}): Promise<ClassroomRecord> {
	ensureCapacity(input.capacity);
	const name = input.name.trim();
	const nameNormalized = normalizeClassroomName(name);
	const id = await db.transaction(async (tx) => {
		const campusAccess = await getClassroomWriteCampusAccess(tx, input);
		await assertCampusForWrite(tx, {
			organizationId: input.organizationId,
			campusAccess,
			campusId: input.campusId,
		});
		const [duplicate] = await tx
			.select({ id: classroom.id })
			.from(classroom)
			.where(
				and(
					eq(classroom.organizationId, input.organizationId),
					eq(classroom.campusId, input.campusId),
					eq(classroom.nameNormalized, nameNormalized),
				),
			)
			.limit(1)
			.for("update");
		if (duplicate) throw new ClassroomRepositoryError("CLASSROOM_DUPLICATE");
		const [created] = await tx
			.insert(classroom)
			.values({
				organizationId: input.organizationId,
				campusId: input.campusId,
				name,
				nameNormalized,
				capacity: input.capacity,
			})
			.returning();
		if (!created)
			throw new Error("Classroom creation did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "classroom_created",
			entityType: "classroom",
			entityId: created.id,
			actorUserId: input.userId,
			campusId: created.campusId,
			after: toSnapshot(created),
		});
		return created.id;
	});
	const [record] = await db
		.select()
		.from(classroom)
		.where(
			and(
				eq(classroom.id, id),
				eq(classroom.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!record) throw new Error("Created classroom was not readable.");
	return record;
}

export async function updateClassroomRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	name: string;
	capacity: number;
}): Promise<ClassroomRecord> {
	ensureCapacity(input.capacity);
	const name = input.name.trim();
	const nameNormalized = normalizeClassroomName(name);
	const updated = await db.transaction(async (tx) => {
		const campusAccess = await getClassroomWriteCampusAccess(tx, input);
		const [current] = await tx
			.select()
			.from(classroom)
			.where(
				and(
					eq(classroom.id, input.id),
					eq(classroom.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new ClassroomRepositoryError("CLASSROOM_NOT_FOUND");
		await assertCampusForWrite(tx, {
			organizationId: input.organizationId,
			campusAccess,
			campusId: current.campusId,
		});
		const [duplicate] = await tx
			.select({ id: classroom.id })
			.from(classroom)
			.where(
				and(
					eq(classroom.organizationId, input.organizationId),
					eq(classroom.campusId, current.campusId),
					eq(classroom.nameNormalized, nameNormalized),
				),
			)
			.limit(1);
		if (duplicate && duplicate.id !== current.id)
			throw new ClassroomRepositoryError("CLASSROOM_DUPLICATE");
		if (input.capacity < current.capacity) {
			await assertFutureLessonsFitCapacity(tx, {
				organizationId: input.organizationId,
				roomId: current.id,
				capacity: input.capacity,
				transactionNow: new Date(),
			});
		}
		const [record] = await tx
			.update(classroom)
			.set({
				name,
				nameNormalized,
				capacity: input.capacity,
				updatedAt: new Date(),
			})
			.where(eq(classroom.id, current.id))
			.returning();
		if (!record) throw new Error("Classroom update did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "classroom_updated",
			entityType: "classroom",
			entityId: record.id,
			actorUserId: input.userId,
			campusId: record.campusId,
			before: toSnapshot(current),
			after: toSnapshot(record),
		});
		return record;
	});
	return updated;
}

export async function setClassroomActiveRecord(input: {
	organizationId: string;
	userId: string;
	id: string;
	isActive: boolean;
}): Promise<ClassroomRecord> {
	return db.transaction(async (tx) => {
		const campusAccess = await getClassroomWriteCampusAccess(tx, input);
		const [current] = await tx
			.select()
			.from(classroom)
			.where(
				and(
					eq(classroom.id, input.id),
					eq(classroom.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new ClassroomRepositoryError("CLASSROOM_NOT_FOUND");
		await assertCampusForWrite(tx, {
			organizationId: input.organizationId,
			campusAccess,
			campusId: current.campusId,
		});
		if (!input.isActive && current.isActive) {
			const future = await tx
				.select({
					id: lesson.id,
					className: classGroup.name,
					startsAt: lesson.startsAt,
					roomName: lesson.room,
				})
				.from(lesson)
				.innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
				.where(
					and(
						eq(lesson.organizationId, input.organizationId),
						eq(lesson.roomId, current.id),
						eq(lesson.status, "scheduled"),
						gt(lesson.startsAt, new Date()),
					),
				);
			if (future.length > 0)
				throw new ClassroomRepositoryError("CLASSROOM_HAS_FUTURE_LESSONS", {
					affectedLessons: future,
				});
		}
		const [record] = await tx
			.update(classroom)
			.set({ isActive: input.isActive, updatedAt: new Date() })
			.where(eq(classroom.id, current.id))
			.returning();
		if (!record)
			throw new Error("Classroom active update did not return a record.");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: input.isActive ? "classroom_activated" : "classroom_deactivated",
			entityType: "classroom",
			entityId: record.id,
			actorUserId: input.userId,
			campusId: record.campusId,
			before: toSnapshot(current),
			after: toSnapshot(record),
		});
		return record;
	});
}
