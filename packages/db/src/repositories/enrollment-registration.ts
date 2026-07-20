import { createHash } from "node:crypto";

import { and, asc, countDistinct, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	classGroup,
	classroom,
	course,
	enrollment,
	enrollmentRegistration,
	invoice,
	lesson,
	makeupLesson,
	organizationMember,
	student,
	studentContact,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import type { CampusAccess } from "./organization";
import {
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	TeachingRepositoryError,
	type Transaction,
} from "./teaching";

type MemberRole = (typeof organizationMember.$inferSelect)["role"];

const studentWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
] as const);
const availableClassStatuses = ["recruiting", "running"] as const;
const enrollableStudentStatuses = ["active", "trial", "at_risk"] as const;

function canOverridePackageTerms(role: MemberRole): boolean {
	return role === "owner" || role === "admin" || role === "campus_manager";
}

export type EnrollmentRegistrationErrorCode =
	| "MEMBER_FORBIDDEN"
	| "STUDENT_NOT_FOUND"
	| "STUDENT_NOT_ENROLLABLE"
	| "CAMPUS_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "COURSE_NOT_FOUND"
	| "COURSE_INACTIVE"
	| "CLASS_NOT_FOUND"
	| "CLASS_COURSE_MISMATCH"
	| "CLASS_CAMPUS_MISMATCH"
	| "CLASS_NOT_AVAILABLE"
	| "CLASS_FULL"
	| "CLASS_STUDENT_DUPLICATE"
	| "ACTIVE_COURSE_ENROLLMENT"
	| "PACKAGE_TERMS_OVERRIDE_FORBIDDEN"
	| "IDEMPOTENCY_CONFLICT"
	| "RESOURCE_UNAVAILABLE";

export class EnrollmentRegistrationError extends Error {
	constructor(
		public readonly code: EnrollmentRegistrationErrorCode,
		public readonly details?: {
			affectedLessons?: Array<{
				id: string;
				className: string;
				startsAt: Date;
				roomName: string;
				occupancy: number;
				capacity: number;
			}>;
		},
	) {
		super(code);
		this.name = "EnrollmentRegistrationError";
	}
}

type RegistrationStudentChoice =
	| { mode: "existing"; studentId: string }
	| {
			mode: "new";
			name: string;
			campusId: string;
			primaryContact: {
				name: string;
				phone: string;
				relationship: string | null;
			};
	  };

export type IndependentEnrollmentOptionsRecord = {
	campuses: Array<{ id: string; name: string }>;
	courses: Array<{
		id: string;
		name: string;
		listPriceInCents: number;
		lessonsPerPackage: number;
	}>;
	classes: Array<{
		id: string;
		name: string;
		courseId: string;
		campusId: string;
		campusName: string;
		status: "recruiting" | "running";
		capacity: number;
		enrollmentCount: number;
		seatsRemaining: number;
		scheduleText: string;
	}>;
};

export type CreateIndependentEnrollmentRecordInput = {
	organizationId: string;
	operatorUserId: string;
	student: RegistrationStudentChoice;
	courseId: string;
	classGroupId: string | null;
	purchasedLessons: number;
	amountInCents: number;
	invoiceDueDate: string;
	requestId: string;
};

export type CreateIndependentEnrollmentRecordResult = {
	studentId: string;
	enrollmentId: string;
	invoiceId: string;
	classGroupId: string | null;
	replayed: boolean;
};

function campusAccessCondition(access: CampusAccess) {
	if (access.kind === "none") return sql`false`;
	return access.kind === "selected"
		? inArray(campus.id, access.campusIds)
		: sql`true`;
}

function isCampusAccessible(access: CampusAccess, campusId: string): boolean {
	return (
		access.kind === "all" ||
		(access.kind === "selected" && access.campusIds.includes(campusId))
	);
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error;
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

function toRegistrationError(error: unknown): EnrollmentRegistrationError {
	if (error instanceof EnrollmentRegistrationError) return error;
	if (error instanceof TeachingRepositoryError) {
		if (error.code === "MEMBER_FORBIDDEN")
			return new EnrollmentRegistrationError("MEMBER_FORBIDDEN");
		if (error.code === "CAMPUS_OUT_OF_SCOPE")
			return new EnrollmentRegistrationError("CAMPUS_OUT_OF_SCOPE");
		if (error.code === "CAMPUS_NOT_FOUND")
			return new EnrollmentRegistrationError("CAMPUS_NOT_FOUND");
		if (error.code === "CAMPUS_INACTIVE")
			return new EnrollmentRegistrationError("CAMPUS_INACTIVE");
	}
	return new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");
}

function inputHash(input: CreateIndependentEnrollmentRecordInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				student: input.student,
				courseId: input.courseId,
				classGroupId: input.classGroupId,
				purchasedLessons: input.purchasedLessons,
				amountInCents: input.amountInCents,
				invoiceDueDate: input.invoiceDueDate,
			}),
		)
		.digest("hex");
}

async function getCurrentAccess(
	tx: Transaction,
	input: Pick<
		CreateIndependentEnrollmentRecordInput,
		"organizationId" | "operatorUserId"
	>,
): Promise<{ campusAccess: CampusAccess; role: MemberRole }> {
	try {
		const campusAccess = await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.operatorUserId,
			allowedRoles: studentWriteRoles,
		});
		const [member] = await tx
			.select({ role: organizationMember.role })
			.from(organizationMember)
			.where(
				and(
					eq(organizationMember.organizationId, input.organizationId),
					eq(organizationMember.userId, input.operatorUserId),
				),
			)
			.limit(1);
		if (!member || !studentWriteRoles.has(member.role)) {
			throw new EnrollmentRegistrationError("MEMBER_FORBIDDEN");
		}
		return { campusAccess, role: member.role };
	} catch (error) {
		throw toRegistrationError(error);
	}
}

async function assertActiveCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		campusId: string;
	},
): Promise<void> {
	try {
		await assertWritableCampus(tx, input);
	} catch (error) {
		throw toRegistrationError(error);
	}
}

async function getReplay(
	tx: Transaction,
	input: {
		organizationId: string;
		requestId: string;
		inputHash: string;
		campusAccess: CampusAccess;
	},
): Promise<CreateIndependentEnrollmentRecordResult | null> {
	const [existing] = await tx
		.select({
			inputHash: enrollmentRegistration.inputHash,
			studentId: enrollmentRegistration.studentId,
			enrollmentId: enrollmentRegistration.enrollmentId,
			invoiceId: enrollmentRegistration.invoiceId,
			classGroupId: enrollmentRegistration.classGroupId,
			campusId: enrollmentRegistration.campusId,
		})
		.from(enrollmentRegistration)
		.where(
			and(
				eq(enrollmentRegistration.organizationId, input.organizationId),
				eq(enrollmentRegistration.requestId, input.requestId),
			),
		)
		.limit(1)
		.for("update");
	if (!existing) return null;
	if (existing.inputHash !== input.inputHash) {
		throw new EnrollmentRegistrationError("IDEMPOTENCY_CONFLICT");
	}
	if (!isCampusAccessible(input.campusAccess, existing.campusId)) {
		throw new EnrollmentRegistrationError("CAMPUS_OUT_OF_SCOPE");
	}
	await assertActiveCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: input.campusAccess,
		campusId: existing.campusId,
	});
	return {
		studentId: existing.studentId,
		enrollmentId: existing.enrollmentId,
		invoiceId: existing.invoiceId,
		classGroupId: existing.classGroupId,
		replayed: true,
	};
}

export async function getIndependentEnrollmentOptionsRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
}): Promise<IndependentEnrollmentOptionsRecord> {
	const [campuses, courses, classRows] = await Promise.all([
		db
			.select({ id: campus.id, name: campus.name })
			.from(campus)
			.where(
				and(
					eq(campus.organizationId, input.organizationId),
					eq(campus.isActive, true),
					campusAccessCondition(input.campusAccess),
				),
			)
			.orderBy(asc(campus.name), asc(campus.id)),
		db
			.select({
				id: course.id,
				name: course.name,
				listPriceInCents: course.listPriceInCents,
				lessonsPerPackage: course.lessonsPerPackage,
			})
			.from(course)
			.where(
				and(
					eq(course.organizationId, input.organizationId),
					eq(course.isActive, true),
				),
			)
			.orderBy(asc(course.name), asc(course.id)),
		db
			.select({
				id: classGroup.id,
				name: classGroup.name,
				courseId: classGroup.courseId,
				campusId: classGroup.campusId,
				campusName: campus.name,
				status: classGroup.status,
				capacity: classGroup.capacity,
				enrollmentCount: countDistinct(enrollment.studentId),
				scheduleText: classGroup.scheduleText,
			})
			.from(classGroup)
			.innerJoin(
				campus,
				and(
					eq(campus.id, classGroup.campusId),
					eq(campus.organizationId, input.organizationId),
				),
			)
			.leftJoin(
				enrollment,
				and(
					eq(enrollment.classGroupId, classGroup.id),
					eq(enrollment.organizationId, input.organizationId),
					eq(enrollment.status, "active"),
				),
			)
			.where(
				and(
					eq(classGroup.organizationId, input.organizationId),
					inArray(classGroup.status, availableClassStatuses),
					campusAccessCondition(input.campusAccess),
					eq(campus.isActive, true),
				),
			)
			.groupBy(classGroup.id, campus.name)
			.orderBy(asc(classGroup.name), asc(classGroup.id)),
	]);

	return {
		campuses,
		courses,
		classes: classRows
			.filter((row) => row.capacity > row.enrollmentCount)
			.map((row) => ({
				...row,
				status: row.status as "recruiting" | "running",
				seatsRemaining: row.capacity - row.enrollmentCount,
			})),
	};
}

async function assertFutureRoomCapacity(
	tx: Transaction,
	input: {
		organizationId: string;
		classGroupId: string;
		additionalStudentCount: number;
	},
): Promise<void> {
	const transactionNow = new Date();
	const futureRooms = await tx
		.select({
			lessonId: lesson.id,
			className: classGroup.name,
			startsAt: lesson.startsAt,
			roomName: lesson.room,
			capacity: classroom.capacity,
		})
		.from(lesson)
		.innerJoin(
			classGroup,
			and(
				eq(classGroup.id, lesson.classGroupId),
				eq(classGroup.organizationId, input.organizationId),
			),
		)
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
				eq(lesson.classGroupId, input.classGroupId),
				eq(lesson.status, "scheduled"),
				gt(lesson.startsAt, transactionNow),
			),
		)
		.for("update");
	if (futureRooms.length === 0) return;

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
					futureRooms.map((item) => item.lessonId),
				),
			),
		)
		.groupBy(makeupLesson.targetLessonId);
	const makeupCountByLessonId = new Map(
		makeupCounts.map((item) => [item.lessonId, item.value]),
	);
	const [occupancy] = await tx
		.select({ value: countDistinct(enrollment.studentId) })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.classGroupId, input.classGroupId),
				eq(enrollment.status, "active"),
			),
		);
	const affectedLessons = futureRooms
		.map((item) => ({
			id: item.lessonId,
			className: item.className,
			startsAt: item.startsAt,
			roomName: item.roomName,
			occupancy:
				(occupancy?.value ?? 0) +
				(makeupCountByLessonId.get(item.lessonId) ?? 0) +
				input.additionalStudentCount,
			capacity: item.capacity,
		}))
		.filter((item) => item.occupancy > item.capacity);
	if (affectedLessons.length > 0) {
		throw new EnrollmentRegistrationError("CLASS_FULL", { affectedLessons });
	}
}

async function assertExistingStudent(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		studentId: string;
	},
): Promise<{ id: string; campusId: string }> {
	const [record] = await tx
		.select({
			id: student.id,
			campusId: student.campusId,
			status: student.status,
		})
		.from(student)
		.where(
			and(
				eq(student.id, input.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");
	if (!record) throw new EnrollmentRegistrationError("STUDENT_NOT_FOUND");
	if (!enrollableStudentStatuses.some((status) => status === record.status)) {
		throw new EnrollmentRegistrationError("STUDENT_NOT_ENROLLABLE");
	}
	await assertActiveCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: input.campusAccess,
		campusId: record.campusId,
	});
	return { id: record.id, campusId: record.campusId };
}

async function assertNoActiveCourseEnrollment(
	tx: Transaction,
	input: { organizationId: string; studentId: string; courseId: string },
): Promise<void> {
	const [existing] = await tx
		.select({ id: enrollment.id })
		.from(enrollment)
		.where(
			and(
				eq(enrollment.organizationId, input.organizationId),
				eq(enrollment.studentId, input.studentId),
				eq(enrollment.courseId, input.courseId),
				eq(enrollment.status, "active"),
			),
		)
		.limit(1)
		.for("update");
	if (existing) {
		throw new EnrollmentRegistrationError("ACTIVE_COURSE_ENROLLMENT");
	}
}

export async function createIndependentEnrollmentRecord(
	input: CreateIndependentEnrollmentRecordInput,
): Promise<CreateIndependentEnrollmentRecordResult> {
	const hash = inputHash(input);
	try {
		return await db.transaction(async (tx) => {
			const access = await getCurrentAccess(tx, input);
			const replay = await getReplay(tx, {
				organizationId: input.organizationId,
				requestId: input.requestId,
				inputHash: hash,
				campusAccess: access.campusAccess,
			});
			if (replay) return replay;

			const [courseRecord] = await tx
				.select({
					id: course.id,
					isActive: course.isActive,
					listPriceInCents: course.listPriceInCents,
					lessonsPerPackage: course.lessonsPerPackage,
				})
				.from(course)
				.where(
					and(
						eq(course.id, input.courseId),
						eq(course.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!courseRecord) {
				throw new EnrollmentRegistrationError("COURSE_NOT_FOUND");
			}
			if (!courseRecord.isActive) {
				throw new EnrollmentRegistrationError("COURSE_INACTIVE");
			}
			if (
				!canOverridePackageTerms(access.role) &&
				(input.amountInCents !== courseRecord.listPriceInCents ||
					input.purchasedLessons !== courseRecord.lessonsPerPackage)
			) {
				throw new EnrollmentRegistrationError(
					"PACKAGE_TERMS_OVERRIDE_FORBIDDEN",
				);
			}

			let studentId: string;
			let studentCampusId: string;
			if (input.student.mode === "existing") {
				const record = await assertExistingStudent(tx, {
					organizationId: input.organizationId,
					campusAccess: access.campusAccess,
					studentId: input.student.studentId,
				});
				studentId = record.id;
				studentCampusId = record.campusId;
			} else {
				await assertActiveCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access.campusAccess,
					campusId: input.student.campusId,
				});
				const [createdStudent] = await tx
					.insert(student)
					.values({
						organizationId: input.organizationId,
						campusId: input.student.campusId,
						name: input.student.name,
						guardianName: input.student.primaryContact.name,
						guardianPhone: input.student.primaryContact.phone,
						status: "active",
					})
					.returning({ id: student.id, campusId: student.campusId });
				if (!createdStudent)
					throw new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");
				await tx.insert(studentContact).values({
					studentId: createdStudent.id,
					name: input.student.primaryContact.name,
					phone: input.student.primaryContact.phone,
					relationship: input.student.primaryContact.relationship,
					isPrimary: true,
				});
				studentId = createdStudent.id;
				studentCampusId = createdStudent.campusId;
			}

			await assertNoActiveCourseEnrollment(tx, {
				organizationId: input.organizationId,
				studentId,
				courseId: input.courseId,
			});

			if (input.classGroupId) {
				const [classRecord] = await tx
					.select({
						id: classGroup.id,
						courseId: classGroup.courseId,
						campusId: classGroup.campusId,
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
				if (!classRecord)
					throw new EnrollmentRegistrationError("CLASS_NOT_FOUND");
				await assertActiveCampus(tx, {
					organizationId: input.organizationId,
					campusAccess: access.campusAccess,
					campusId: classRecord.campusId,
				});
				if (classRecord.courseId !== input.courseId)
					throw new EnrollmentRegistrationError("CLASS_COURSE_MISMATCH");
				if (classRecord.campusId !== studentCampusId)
					throw new EnrollmentRegistrationError("CLASS_CAMPUS_MISMATCH");
				if (
					!availableClassStatuses.some(
						(status) => status === classRecord.status,
					)
				)
					throw new EnrollmentRegistrationError("CLASS_NOT_AVAILABLE");
				const [duplicate] = await tx
					.select({ id: enrollment.id })
					.from(enrollment)
					.where(
						and(
							eq(enrollment.organizationId, input.organizationId),
							eq(enrollment.classGroupId, classRecord.id),
							eq(enrollment.studentId, studentId),
							eq(enrollment.status, "active"),
						),
					)
					.limit(1)
					.for("update");
				if (duplicate)
					throw new EnrollmentRegistrationError("CLASS_STUDENT_DUPLICATE");
				const [occupancy] = await tx
					.select({ value: countDistinct(enrollment.studentId) })
					.from(enrollment)
					.where(
						and(
							eq(enrollment.organizationId, input.organizationId),
							eq(enrollment.classGroupId, classRecord.id),
							eq(enrollment.status, "active"),
						),
					);
				if ((occupancy?.value ?? 0) >= classRecord.capacity)
					throw new EnrollmentRegistrationError("CLASS_FULL");
				await assertFutureRoomCapacity(tx, {
					organizationId: input.organizationId,
					classGroupId: classRecord.id,
					additionalStudentCount: 1,
				});
			}

			const [createdEnrollment] = await tx
				.insert(enrollment)
				.values({
					organizationId: input.organizationId,
					leadId: null,
					studentId,
					courseId: input.courseId,
					classGroupId: input.classGroupId,
					purchasedLessons: input.purchasedLessons,
					remainingLessons: input.purchasedLessons,
					amountInCents: input.amountInCents,
				})
				.returning({ id: enrollment.id });
			if (!createdEnrollment)
				throw new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");

			const isComplimentary = input.amountInCents === 0;
			const [createdInvoice] = await tx
				.insert(invoice)
				.values({
					organizationId: input.organizationId,
					studentId,
					enrollmentId: createdEnrollment.id,
					amountInCents: input.amountInCents,
					dueDate: input.invoiceDueDate,
					status: isComplimentary ? "paid" : "pending",
					paidAt: isComplimentary ? new Date() : null,
				})
				.returning({ id: invoice.id });
			if (!createdInvoice)
				throw new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");

			const [registration] = await tx
				.insert(enrollmentRegistration)
				.values({
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash: hash,
					studentId,
					enrollmentId: createdEnrollment.id,
					invoiceId: createdInvoice.id,
					classGroupId: input.classGroupId,
					campusId: studentCampusId,
					operatorUserId: input.operatorUserId,
				})
				.returning({ id: enrollmentRegistration.id });
			if (!registration)
				throw new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");

			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "enrollment_created",
				entityType: "enrollment_registration",
				entityId: registration.id,
				actorUserId: input.operatorUserId,
				campusId: studentCampusId,
				after: {
					studentId,
					enrollmentId: createdEnrollment.id,
					invoiceId: createdInvoice.id,
					courseId: input.courseId,
					classGroupId: input.classGroupId,
					purchasedLessons: input.purchasedLessons,
					amountInCents: input.amountInCents,
					invoiceDueDate: input.invoiceDueDate,
					source: "independent",
					requestId: input.requestId,
				},
			});

			return {
				studentId,
				enrollmentId: createdEnrollment.id,
				invoiceId: createdInvoice.id,
				classGroupId: input.classGroupId,
				replayed: false,
			};
		});
	} catch (error) {
		if (error instanceof EnrollmentRegistrationError) throw error;
		const databaseError = getDatabaseError(error);
		if (
			databaseError?.code === "23505" &&
			databaseError.constraint === "enrollment_registration_org_request_uidx"
		) {
			return await db.transaction(async (tx) => {
				const access = await getCurrentAccess(tx, input);
				const replay = await getReplay(tx, {
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash: hash,
					campusAccess: access.campusAccess,
				});
				if (replay) return replay;
				throw new EnrollmentRegistrationError("IDEMPOTENCY_CONFLICT");
			});
		}
		if (databaseError?.code === "40P01" || databaseError?.code === "55P03") {
			throw new EnrollmentRegistrationError("RESOURCE_UNAVAILABLE");
		}
		throw error;
	}
}
