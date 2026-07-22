import { and, asc, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	campus,
	classGroup,
	course,
	enrollment,
	invoice,
	lead,
	leadActivity,
	organizationMember,
	student,
	studentContact,
	user,
} from "../schema";
import { startArrearsCycleIfNeeded } from "./arrears-workflow";
import type { CampusAccess } from "./organization";
import {
	assertEligibleStudentOwner,
	recordStudentOwnerAssignment,
	StudentOwnershipError,
	setStudentOwnerInTransaction,
} from "./student-ownership";
import {
	lockStudentPhonesInTransaction,
	normalizeStudentPhone,
} from "./student-phone";
import {
	getCurrentWriteCampusAccess,
	TeachingRepositoryError,
} from "./teaching";

type MemberRole = (typeof organizationMember.$inferSelect)["role"];

const studentWriteRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);
const studentOwnerManagementRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
]);

const convertibleLeadStages = ["new", "contacted", "trial_booked"] as const;
const availableClassStatuses = ["recruiting", "running"] as const;

export type EnrollmentConversionErrorCode =
	| "LEAD_NOT_FOUND"
	| "LEAD_ALREADY_CONVERTED"
	| "LEAD_NOT_CONVERTIBLE"
	| "MEMBER_FORBIDDEN"
	| "STUDENT_NOT_FOUND"
	| "STUDENT_PHONE_MISMATCH"
	| "STUDENT_VERSION_CONFLICT"
	| "STUDENT_OWNER_NOT_ELIGIBLE"
	| "STUDENT_OWNER_ADJUST_FORBIDDEN"
	| "CAMPUS_NOT_FOUND"
	| "COURSE_NOT_FOUND"
	| "CLASS_NOT_FOUND"
	| "CLASS_COURSE_MISMATCH"
	| "CLASS_CAMPUS_MISMATCH"
	| "CLASS_NOT_AVAILABLE"
	| "CLASS_FULL"
	| "CLASS_STUDENT_DUPLICATE"
	| "ACTIVE_COURSE_ENROLLMENT"
	| "PACKAGE_TERMS_OVERRIDE_FORBIDDEN"
	| "RESOURCE_UNAVAILABLE"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE";

export class EnrollmentConversionError extends Error {
	constructor(public readonly code: EnrollmentConversionErrorCode) {
		super(code);
		this.name = "EnrollmentConversionError";
	}
}

export type LeadConversionOptionsRecord = {
	lead: {
		id: string;
		name: string;
		phone: string;
		stage: "new" | "contacted" | "trial_booked";
		campusId: string | null;
		interestedCourseId: string | null;
		ownerUserId: string | null;
		ownerName: string | null;
	};
	matchingStudents: Array<{
		id: string;
		name: string;
		guardianName: string;
		campusId: string;
		campusName: string;
		status: (typeof student.$inferSelect)["status"];
		ownerUserId: string | null;
		ownerName: string | null;
		version: number;
	}>;
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

export type ConvertLeadRecordInput = {
	organizationId: string;
	operatorUserId: string;
	campusAccess: CampusAccess;
	leadId: string;
	student:
		| { mode: "existing"; studentId: string; expectedVersion: number }
		| {
				mode: "new";
				name: string;
				guardianName: string;
				campusId: string;
		  };
	courseId: string;
	conversionOwnerUserId: string | null;
	adjustStudentOwner: boolean;
	classGroupId: string | null;
	purchasedLessons: number;
	amountInCents: number;
	invoiceDueDate: string;
	canOverridePackageTerms: boolean;
};

function campusAccessCondition(campusAccess: CampusAccess) {
	if (campusAccess.kind === "none") return sql`false`;
	if (campusAccess.kind === "selected") {
		return inArray(campus.id, campusAccess.campusIds);
	}
	return sql`true`;
}

function isCampusAccessible(
	campusAccess: CampusAccess,
	campusId: string | null,
): boolean {
	return (
		campusAccess.kind === "all" ||
		(campusId !== null &&
			campusAccess.kind === "selected" &&
			campusAccess.campusIds.includes(campusId))
	);
}

export type ConvertLeadRecordResult = {
	leadId: string;
	studentId: string;
	enrollmentId: string;
	invoiceId: string;
	classGroupId: string | null;
};

function assertConvertibleLeadStage(
	stage: (typeof lead.$inferSelect)["stage"],
): asserts stage is LeadConversionOptionsRecord["lead"]["stage"] {
	if (stage === "enrolled") {
		throw new EnrollmentConversionError("LEAD_ALREADY_CONVERTED");
	}
	if (stage === "lost") {
		throw new EnrollmentConversionError("LEAD_NOT_CONVERTIBLE");
	}
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}

	if ("code" in error) {
		return error;
	}

	return "cause" in error ? getDatabaseError(error.cause) : null;
}

/**
 * 仅消除手机号中的展示字符，不推断国家码，也不进行模糊匹配。
 */
function normalizedPhoneEquals(
	column: typeof student.guardianPhone,
	phone: string,
) {
	return sql<boolean>`
		regexp_replace(${column}, '[[:space:]()（）-]', '', 'g') =
		regexp_replace(${phone}, '[[:space:]()（）-]', '', 'g')
	`;
}

function normalizePhoneForComparison(phone: string): string {
	return phone.replace(/[\s()（）-]/gu, "");
}

export async function getLeadConversionOptionsRecord(input: {
	organizationId: string;
	leadId: string;
	campusAccess: CampusAccess;
}): Promise<LeadConversionOptionsRecord> {
	const leadOwner = alias(user, "lead_conversion_owner");
	const studentOwner = alias(user, "lead_conversion_student_owner");
	const [leadRecord] = await db
		.select({
			id: lead.id,
			name: lead.name,
			phone: lead.phone,
			stage: lead.stage,
			campusId: lead.campusId,
			interestedCourseId: lead.interestedCourseId,
			ownerUserId: lead.ownerUserId,
			ownerName: leadOwner.name,
		})
		.from(lead)
		.leftJoin(leadOwner, eq(leadOwner.id, lead.ownerUserId))
		.where(
			and(
				eq(lead.id, input.leadId),
				eq(lead.organizationId, input.organizationId),
				input.campusAccess.kind === "none"
					? sql`false`
					: input.campusAccess.kind === "selected"
						? inArray(lead.campusId, input.campusAccess.campusIds)
						: sql`true`,
			),
		)
		.limit(1);

	if (!leadRecord) {
		throw new EnrollmentConversionError("LEAD_NOT_FOUND");
	}
	const leadStage = leadRecord.stage;
	assertConvertibleLeadStage(leadStage);

	const [matchingStudents, campuses, courses, classRows] = await Promise.all([
		db
			.select({
				id: student.id,
				name: student.name,
				guardianName: student.guardianName,
				campusId: student.campusId,
				campusName: campus.name,
				status: student.status,
				ownerUserId: student.ownerUserId,
				ownerName: studentOwner.name,
				version: student.version,
			})
			.from(student)
			.innerJoin(
				campus,
				and(
					eq(campus.id, student.campusId),
					eq(campus.organizationId, input.organizationId),
				),
			)
			.leftJoin(studentOwner, eq(studentOwner.id, student.ownerUserId))
			.where(
				and(
					eq(student.organizationId, input.organizationId),
					campusAccessCondition(input.campusAccess),
					normalizedPhoneEquals(student.guardianPhone, leadRecord.phone),
				),
			)
			.orderBy(asc(student.createdAt), asc(student.id)),
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
		lead: { ...leadRecord, stage: leadStage },
		matchingStudents,
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

export async function convertLeadRecord(
	input: ConvertLeadRecordInput,
): Promise<ConvertLeadRecordResult> {
	try {
		return await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`,
			);
			const currentCampusAccess = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.operatorUserId,
				allowedRoles: studentWriteRoles,
			});
			const [currentMember] = await tx
				.select({ role: organizationMember.role })
				.from(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, input.organizationId),
						eq(organizationMember.userId, input.operatorUserId),
					),
				)
				.limit(1);
			if (!currentMember || !studentWriteRoles.has(currentMember.role)) {
				throw new EnrollmentConversionError("MEMBER_FORBIDDEN");
			}
			const [leadRecord] = await tx
				.select({
					id: lead.id,
					phone: lead.phone,
					stage: lead.stage,
					campusId: lead.campusId,
				})
				.from(lead)
				.where(
					and(
						eq(lead.id, input.leadId),
						eq(lead.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");

			if (!leadRecord) {
				throw new EnrollmentConversionError("LEAD_NOT_FOUND");
			}
			if (!isCampusAccessible(currentCampusAccess, leadRecord.campusId)) {
				throw new EnrollmentConversionError("CAMPUS_OUT_OF_SCOPE");
			}
			const [leadCampus] = leadRecord.campusId
				? await tx
						.select({ id: campus.id })
						.from(campus)
						.where(
							and(
								eq(campus.id, leadRecord.campusId),
								eq(campus.organizationId, input.organizationId),
								eq(campus.isActive, true),
							),
						)
						.limit(1)
						.for("update")
				: [];
			if (leadRecord.campusId && !leadCampus) {
				throw new EnrollmentConversionError("CAMPUS_INACTIVE");
			}

			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.operatorUserId))
				.limit(1);
			if (!operator) {
				throw new Error("Lead conversion operator was not found.");
			}

			const [existingEnrollment] = await tx
				.select({ id: enrollment.id })
				.from(enrollment)
				.where(
					and(
						eq(enrollment.organizationId, input.organizationId),
						eq(enrollment.leadId, input.leadId),
					),
				)
				.limit(1);

			if (existingEnrollment) {
				throw new EnrollmentConversionError("LEAD_ALREADY_CONVERTED");
			}
			assertConvertibleLeadStage(leadRecord.stage);

			const [courseRecord] = await tx
				.select({
					id: course.id,
					listPriceInCents: course.listPriceInCents,
					lessonsPerPackage: course.lessonsPerPackage,
				})
				.from(course)
				.where(
					and(
						eq(course.id, input.courseId),
						eq(course.organizationId, input.organizationId),
						eq(course.isActive, true),
					),
				)
				.limit(1)
				.for("key share");

			if (!courseRecord) {
				throw new EnrollmentConversionError("COURSE_NOT_FOUND");
			}
			if (
				!input.canOverridePackageTerms &&
				(input.amountInCents !== courseRecord.listPriceInCents ||
					input.purchasedLessons !== courseRecord.lessonsPerPackage)
			) {
				throw new EnrollmentConversionError("PACKAGE_TERMS_OVERRIDE_FORBIDDEN");
			}

			let studentId: string;
			let studentCampusId: string;
			let existingStudentRecord: {
				id: string;
				campusId: string;
				ownerUserId: string | null;
				version: number;
			} | null = null;
			let existingStudentExpectedVersion: number | null = null;

			if (input.student.mode === "existing") {
				const [studentRecord] = await tx
					.select({
						id: student.id,
						campusId: student.campusId,
						guardianPhone: student.guardianPhone,
						ownerUserId: student.ownerUserId,
						version: student.version,
						mergedIntoStudentId: student.mergedIntoStudentId,
					})
					.from(student)
					.where(
						and(
							eq(student.id, input.student.studentId),
							eq(student.organizationId, input.organizationId),
						),
					)
					.limit(1)
					.for("update");

				if (!studentRecord) {
					throw new EnrollmentConversionError("STUDENT_NOT_FOUND");
				}
				if (studentRecord.mergedIntoStudentId) {
					throw new EnrollmentConversionError("STUDENT_NOT_FOUND");
				}
				if (!isCampusAccessible(currentCampusAccess, studentRecord.campusId)) {
					throw new EnrollmentConversionError("CAMPUS_OUT_OF_SCOPE");
				}
				const [studentCampus] = await tx
					.select({ id: campus.id })
					.from(campus)
					.where(
						and(
							eq(campus.id, studentRecord.campusId),
							eq(campus.organizationId, input.organizationId),
							eq(campus.isActive, true),
						),
					)
					.limit(1)
					.for("update");
				if (!studentCampus)
					throw new EnrollmentConversionError("CAMPUS_INACTIVE");
				if (
					normalizePhoneForComparison(studentRecord.guardianPhone) !==
					normalizePhoneForComparison(leadRecord.phone)
				) {
					throw new EnrollmentConversionError("STUDENT_PHONE_MISMATCH");
				}

				studentId = studentRecord.id;
				studentCampusId = studentRecord.campusId;
				existingStudentRecord = studentRecord;
				existingStudentExpectedVersion = input.student.expectedVersion;
			} else {
				if (!isCampusAccessible(currentCampusAccess, input.student.campusId)) {
					throw new EnrollmentConversionError("CAMPUS_OUT_OF_SCOPE");
				}
				const [campusRecord] = await tx
					.select({ id: campus.id })
					.from(campus)
					.where(
						and(
							eq(campus.id, input.student.campusId),
							eq(campus.organizationId, input.organizationId),
							eq(campus.isActive, true),
						),
					)
					.limit(1)
					.for("key share");

				if (!campusRecord) {
					throw new EnrollmentConversionError("CAMPUS_NOT_FOUND");
				}
				await lockStudentPhonesInTransaction(tx, {
					organizationId: input.organizationId,
					normalizedPhones: [normalizeStudentPhone(leadRecord.phone)],
				});

				const [createdStudent] = await tx
					.insert(student)
					.values({
						organizationId: input.organizationId,
						campusId: campusRecord.id,
						name: input.student.name,
						guardianName: input.student.guardianName,
						guardianPhone: leadRecord.phone,
						guardianPhoneNormalized: normalizeStudentPhone(leadRecord.phone),
						status: "active",
						ownerUserId: input.conversionOwnerUserId,
					})
					.returning({ id: student.id, campusId: student.campusId });

				if (!createdStudent) {
					throw new Error("Student creation did not return a record.");
				}

				await tx.insert(studentContact).values({
					studentId: createdStudent.id,
					name: input.student.guardianName,
					phone: leadRecord.phone,
					phoneNormalized: normalizeStudentPhone(leadRecord.phone),
					isPrimary: true,
				});

				studentId = createdStudent.id;
				studentCampusId = createdStudent.campusId;
				await recordStudentOwnerAssignment(tx, {
					organizationId: input.organizationId,
					studentId,
					campusId: studentCampusId,
					beforeOwnerUserId: null,
					afterOwnerUserId: input.conversionOwnerUserId,
					operatorUserId: input.operatorUserId,
					source: "lead_conversion",
				});
			}

			if (input.conversionOwnerUserId) {
				await assertEligibleStudentOwner(tx, {
					organizationId: input.organizationId,
					ownerUserId: input.conversionOwnerUserId,
					campusId: studentCampusId,
				});
			}
			if (existingStudentRecord && input.adjustStudentOwner) {
				if (!studentOwnerManagementRoles.has(currentMember.role)) {
					throw new EnrollmentConversionError("STUDENT_OWNER_ADJUST_FORBIDDEN");
				}
				if (existingStudentRecord.version !== existingStudentExpectedVersion) {
					throw new EnrollmentConversionError("STUDENT_VERSION_CONFLICT");
				}
				await setStudentOwnerInTransaction(tx, {
					organizationId: input.organizationId,
					studentId: existingStudentRecord.id,
					campusId: existingStudentRecord.campusId,
					beforeOwnerUserId: existingStudentRecord.ownerUserId,
					afterOwnerUserId: input.conversionOwnerUserId,
					expectedVersion: existingStudentRecord.version,
					operatorUserId: input.operatorUserId,
					source: "lead_conversion",
				});
			}

			const [activeCourseEnrollment] = await tx
				.select({ id: enrollment.id })
				.from(enrollment)
				.where(
					and(
						eq(enrollment.organizationId, input.organizationId),
						eq(enrollment.studentId, studentId),
						eq(enrollment.courseId, input.courseId),
						eq(enrollment.status, "active"),
					),
				)
				.limit(1)
				.for("update");
			if (activeCourseEnrollment) {
				throw new EnrollmentConversionError("ACTIVE_COURSE_ENROLLMENT");
			}

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

				if (!classRecord) {
					throw new EnrollmentConversionError("CLASS_NOT_FOUND");
				}
				if (!isCampusAccessible(currentCampusAccess, classRecord.campusId)) {
					throw new EnrollmentConversionError("CAMPUS_OUT_OF_SCOPE");
				}
				const [classCampus] = await tx
					.select({ id: campus.id })
					.from(campus)
					.where(
						and(
							eq(campus.id, classRecord.campusId),
							eq(campus.organizationId, input.organizationId),
							eq(campus.isActive, true),
						),
					)
					.limit(1)
					.for("update");
				if (!classCampus)
					throw new EnrollmentConversionError("CAMPUS_INACTIVE");
				if (classRecord.courseId !== input.courseId) {
					throw new EnrollmentConversionError("CLASS_COURSE_MISMATCH");
				}
				if (classRecord.campusId !== studentCampusId) {
					throw new EnrollmentConversionError("CLASS_CAMPUS_MISMATCH");
				}
				if (
					classRecord.status !== "recruiting" &&
					classRecord.status !== "running"
				) {
					throw new EnrollmentConversionError("CLASS_NOT_AVAILABLE");
				}

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

				const [currentStudentEnrollment] = await tx
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
				if (currentStudentEnrollment) {
					throw new EnrollmentConversionError("CLASS_STUDENT_DUPLICATE");
				}
				if ((occupancy?.value ?? 0) >= classRecord.capacity) {
					throw new EnrollmentConversionError("CLASS_FULL");
				}
			}

			const [createdEnrollment] = await tx
				.insert(enrollment)
				.values({
					organizationId: input.organizationId,
					leadId: input.leadId,
					studentId,
					conversionOwnerUserId: input.conversionOwnerUserId,
					courseId: input.courseId,
					classGroupId: input.classGroupId,
					purchasedLessons: input.purchasedLessons,
					remainingLessons: input.purchasedLessons,
					amountInCents: input.amountInCents,
				})
				.returning({ id: enrollment.id });

			if (!createdEnrollment) {
				throw new Error("Enrollment creation did not return a record.");
			}

			const isComplimentaryEnrollment = input.amountInCents === 0;
			const [createdInvoice] = await tx
				.insert(invoice)
				.values({
					organizationId: input.organizationId,
					studentId,
					enrollmentId: createdEnrollment.id,
					source: "enrollment",
					businessActivityType: "course_enrollment",
					summary: "课程报名费用",
					amountInCents: input.amountInCents,
					dueDate: input.invoiceDueDate,
					status: isComplimentaryEnrollment ? "paid" : "pending",
					paidAt: isComplimentaryEnrollment ? new Date() : null,
					createdByUserId: input.operatorUserId,
					createdByName: operator.name,
				})
				.returning({ id: invoice.id });

			if (!createdInvoice) {
				throw new Error("Invoice creation did not return a record.");
			}
			await startArrearsCycleIfNeeded(tx, {
				organizationId: input.organizationId,
				invoiceId: createdInvoice.id,
				sourceType: "enrollment_conversion",
				sourceId: createdInvoice.id,
				occurredAt: new Date(),
			});

			const [updatedLead] = await tx
				.update(lead)
				.set({ stage: "enrolled", updatedAt: new Date() })
				.where(
					and(
						eq(lead.id, input.leadId),
						eq(lead.organizationId, input.organizationId),
						inArray(lead.stage, convertibleLeadStages),
					),
				)
				.returning({ id: lead.id });

			if (!updatedLead) {
				throw new EnrollmentConversionError("LEAD_NOT_CONVERTIBLE");
			}

			await tx.insert(leadActivity).values({
				organizationId: input.organizationId,
				leadId: updatedLead.id,
				type: "converted",
				content: "完成报名转化",
				stage: "enrolled",
				operatorUserId: input.operatorUserId,
				operatorName: operator.name,
			});

			return {
				leadId: updatedLead.id,
				studentId,
				enrollmentId: createdEnrollment.id,
				invoiceId: createdInvoice.id,
				classGroupId: input.classGroupId,
			};
		});
	} catch (error) {
		if (error instanceof EnrollmentConversionError) {
			throw error;
		}
		if (error instanceof StudentOwnershipError) {
			throw new EnrollmentConversionError(error.code);
		}
		if (error instanceof TeachingRepositoryError) {
			throw new EnrollmentConversionError(
				error.code === "MEMBER_FORBIDDEN"
					? "MEMBER_FORBIDDEN"
					: error.code === "CAMPUS_OUT_OF_SCOPE"
						? "CAMPUS_OUT_OF_SCOPE"
						: "RESOURCE_UNAVAILABLE",
			);
		}

		const databaseError = getDatabaseError(error);
		if (
			databaseError?.code === "23505" &&
			databaseError.constraint === "enrollment_org_lead_uidx"
		) {
			throw new EnrollmentConversionError("LEAD_ALREADY_CONVERTED");
		}
		if (databaseError?.code === "23503") {
			throw new EnrollmentConversionError("RESOURCE_UNAVAILABLE");
		}
		if (databaseError?.code === "40P01" || databaseError?.code === "55P03") {
			throw new EnrollmentConversionError("RESOURCE_UNAVAILABLE");
		}

		throw error;
	}
}
