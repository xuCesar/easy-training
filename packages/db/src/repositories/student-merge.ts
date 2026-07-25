import { createHash } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
	attendance,
	campus,
	classGroup,
	enrollment,
	enrollmentRegistration,
	invoice,
	type organizationMember,
	student,
	studentContact,
	studentMerge,
	studentTagAssignment,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	assertEligibleStudentOwner,
	recordStudentOwnerAssignment,
	StudentOwnershipError,
} from "./student-ownership";
import {
	assertWritableCampus,
	getCurrentWriteCampusAccess,
	type Transaction,
} from "./teaching-foundation";

type StudentStatus = (typeof student.$inferSelect)["status"];
type MemberRole = (typeof organizationMember.$inferSelect)["role"];

const mergeRoles = new Set<MemberRole>(["owner", "admin"]);

export type StudentMergeErrorCode =
	| "MEMBER_FORBIDDEN"
	| "CAMPUS_OUT_OF_SCOPE"
	| "STUDENT_NOT_FOUND"
	| "STUDENT_ALREADY_MERGED"
	| "STUDENT_MERGE_SAME_RECORD"
	| "STUDENT_VERSION_CONFLICT"
	| "STUDENT_MERGE_ACTIVE_COURSE_ENROLLMENT"
	| "STUDENT_MERGE_ATTENDANCE_CONFLICT"
	| "STUDENT_MERGE_CAMPUS_ENROLLMENT_CONFLICT"
	| "STUDENT_MERGE_CONTACT_INVALID"
	| "STUDENT_OWNER_NOT_ELIGIBLE"
	| "IDEMPOTENCY_CONFLICT";

export class StudentMergeRepositoryError extends Error {
	constructor(public readonly code: StudentMergeErrorCode) {
		super(code);
		this.name = "StudentMergeRepositoryError";
	}
}

export type StudentMergeFieldSources = {
	name: "source" | "target";
	campusId: "source" | "target";
	birthDate: "source" | "target";
	status: "source" | "target";
	ownerUserId: "source" | "target";
	primaryContactId: string;
};

export type StudentMergePreview = {
	source: StudentMergeProfile;
	target: StudentMergeProfile;
	contacts: StudentMergeContact[];
	conflicts: Array<
		| "name"
		| "campusId"
		| "birthDate"
		| "status"
		| "ownerUserId"
		| "primaryContactId"
	>;
	blockingReasons: Array<"ACTIVE_COURSE_ENROLLMENT" | "ATTENDANCE_CONFLICT">;
};

export type StudentMergeProfile = {
	id: string;
	name: string;
	campusId: string;
	campusName: string;
	birthDate: string | null;
	status: StudentStatus;
	ownerUserId: string | null;
	ownerName: string | null;
	version: number;
	updatedAt: Date;
};

export type StudentMergeContact = {
	id: string;
	studentId: string;
	name: string;
	phone: string;
	relationship: string | null;
	isPrimary: boolean;
	duplicateOfContactId: string | null;
};

type LockedStudent = StudentMergeProfile & {
	guardianName: string;
	guardianPhone: string;
	guardianPhoneNormalized: string;
	mergedIntoStudentId: string | null;
};

export type MergeStudentsRecordInput = {
	organizationId: string;
	userId: string;
	sourceStudentId: string;
	targetStudentId: string;
	expectedSourceVersion: number;
	expectedTargetVersion: number;
	requestId: string;
	fieldSources: StudentMergeFieldSources;
};

export type MergeStudentsRecordResult = {
	sourceStudentId: string;
	targetStudentId: string;
	replayed: boolean;
};

function inputHash(input: MergeStudentsRecordInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				sourceStudentId: input.sourceStudentId,
				targetStudentId: input.targetStudentId,
				expectedSourceVersion: input.expectedSourceVersion,
				expectedTargetVersion: input.expectedTargetVersion,
				fieldSources: input.fieldSources,
			}),
		)
		.digest("hex");
}

async function getMergeAccess(
	tx: Transaction,
	input: { organizationId: string; userId: string },
) {
	return getCurrentWriteCampusAccess(tx, {
		...input,
		allowedRoles: mergeRoles,
	});
}

async function lockStudents(
	tx: Transaction,
	input: {
		organizationId: string;
		sourceStudentId: string;
		targetStudentId: string;
	},
): Promise<{ source: LockedStudent; target: LockedStudent }> {
	if (input.sourceStudentId === input.targetStudentId) {
		throw new StudentMergeRepositoryError("STUDENT_MERGE_SAME_RECORD");
	}
	// 固定锁顺序，避免两位管理员反向选择主档案时产生死锁。
	const rows = await tx
		.select({
			id: student.id,
			name: student.name,
			campusId: student.campusId,
			campusName: campus.name,
			birthDate: student.birthDate,
			status: student.status,
			ownerUserId: student.ownerUserId,
			version: student.version,
			updatedAt: student.updatedAt,
			guardianName: student.guardianName,
			guardianPhone: student.guardianPhone,
			guardianPhoneNormalized: student.guardianPhoneNormalized,
			mergedIntoStudentId: student.mergedIntoStudentId,
		})
		.from(student)
		.innerJoin(
			campus,
			and(
				eq(campus.id, student.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(student.organizationId, input.organizationId),
				inArray(student.id, [input.sourceStudentId, input.targetStudentId]),
			),
		)
		.orderBy(asc(student.id))
		.for("update");
	if (rows.length !== 2) {
		throw new StudentMergeRepositoryError("STUDENT_NOT_FOUND");
	}
	const source = rows.find((item) => item.id === input.sourceStudentId);
	const target = rows.find((item) => item.id === input.targetStudentId);
	if (!source || !target)
		throw new StudentMergeRepositoryError("STUDENT_NOT_FOUND");
	if (source.mergedIntoStudentId || target.mergedIntoStudentId) {
		throw new StudentMergeRepositoryError("STUDENT_ALREADY_MERGED");
	}
	const ownerUserIds = [source.ownerUserId, target.ownerUserId].filter(
		(ownerUserId): ownerUserId is string => ownerUserId !== null,
	);
	const owners =
		ownerUserIds.length > 0
			? await tx
					.select({ id: user.id, name: user.name })
					.from(user)
					.where(inArray(user.id, ownerUserIds))
			: [];
	const ownerNameById = new Map(owners.map((owner) => [owner.id, owner.name]));
	return {
		source: {
			...source,
			ownerName: source.ownerUserId
				? (ownerNameById.get(source.ownerUserId) ?? null)
				: null,
		},
		target: {
			...target,
			ownerName: target.ownerUserId
				? (ownerNameById.get(target.ownerUserId) ?? null)
				: null,
		},
	};
}

async function loadMergeContacts(
	tx: Transaction,
	studentIds: string[],
): Promise<StudentMergeContact[]> {
	const rows = await tx
		.select({
			id: studentContact.id,
			studentId: studentContact.studentId,
			name: studentContact.name,
			phone: studentContact.phone,
			phoneNormalized: studentContact.phoneNormalized,
			relationship: studentContact.relationship,
			isPrimary: studentContact.isPrimary,
			createdAt: studentContact.createdAt,
		})
		.from(studentContact)
		.where(inArray(studentContact.studentId, studentIds))
		.orderBy(asc(studentContact.createdAt), asc(studentContact.id))
		.for("update");
	// 目标档案优先保留原联系人 ID；避免因创建时间较早的源联系人反向覆盖主档案。
	const targetStudentId = studentIds[1];
	const orderedRows = [...rows].sort((left, right) => {
		const leftTarget = left.studentId === targetStudentId ? 0 : 1;
		const rightTarget = right.studentId === targetStudentId ? 0 : 1;
		return leftTarget - rightTarget;
	});
	const canonicalByPhone = new Map<string, string>();
	return orderedRows.map((item) => {
		const duplicateOfContactId = item.phoneNormalized
			? (canonicalByPhone.get(item.phoneNormalized) ?? null)
			: null;
		if (item.phoneNormalized && !duplicateOfContactId) {
			canonicalByPhone.set(item.phoneNormalized, item.id);
		}
		return {
			id: item.id,
			studentId: item.studentId,
			name: item.name,
			phone: item.phone,
			relationship: item.relationship,
			isPrimary: item.isPrimary,
			duplicateOfContactId,
		};
	});
}

async function getBlockingReasons(
	tx: Transaction,
	input: {
		organizationId: string;
		sourceStudentId: string;
		targetStudentId: string;
	},
): Promise<StudentMergePreview["blockingReasons"]> {
	const [activeCourseConflict, attendanceConflict] = await Promise.all([
		tx
			.select({ courseId: enrollment.courseId })
			.from(enrollment)
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					inArray(enrollment.studentId, [
						input.sourceStudentId,
						input.targetStudentId,
					]),
					inArray(enrollment.status, ["active", "frozen"]),
				),
			)
			.groupBy(enrollment.courseId)
			.having(sql`count(*) > 1`)
			.limit(1),
		tx.execute<{ lesson_id: string }>(sql`
			select source_attendance.lesson_id
			from attendance source_attendance
			inner join attendance target_attendance
				on target_attendance.lesson_id = source_attendance.lesson_id
				and target_attendance.student_id = ${input.targetStudentId}
			where source_attendance.student_id = ${input.sourceStudentId}
			limit 1
		`),
	]);
	const reasons: StudentMergePreview["blockingReasons"] = [];
	if (activeCourseConflict.length > 0) reasons.push("ACTIVE_COURSE_ENROLLMENT");
	if (attendanceConflict.rows.length > 0) reasons.push("ATTENDANCE_CONFLICT");
	return reasons;
}

function profileOf(record: LockedStudent): StudentMergeProfile {
	return {
		id: record.id,
		name: record.name,
		campusId: record.campusId,
		campusName: record.campusName,
		birthDate: record.birthDate,
		status: record.status,
		ownerUserId: record.ownerUserId,
		ownerName: record.ownerName,
		version: record.version,
		updatedAt: record.updatedAt,
	};
}

function mergeConflicts(
	source: LockedStudent,
	target: LockedStudent,
	contacts: StudentMergeContact[],
): StudentMergePreview["conflicts"] {
	const conflicts: StudentMergePreview["conflicts"] = [];
	if (source.name !== target.name) conflicts.push("name");
	if (source.campusId !== target.campusId) conflicts.push("campusId");
	if (source.birthDate !== target.birthDate) conflicts.push("birthDate");
	if (source.status !== target.status) conflicts.push("status");
	if (source.ownerUserId !== target.ownerUserId) conflicts.push("ownerUserId");
	const primaryIds = contacts
		.filter((contact) => contact.isPrimary && !contact.duplicateOfContactId)
		.map((contact) => contact.id);
	if (primaryIds.length > 1) conflicts.push("primaryContactId");
	return conflicts;
}

async function loadPreviewInTransaction(
	tx: Transaction,
	input: {
		organizationId: string;
		sourceStudentId: string;
		targetStudentId: string;
		campusAccess: Awaited<ReturnType<typeof getMergeAccess>>;
	},
): Promise<StudentMergePreview> {
	const { source, target } = await lockStudents(tx, input);
	await assertWritableCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: input.campusAccess,
		campusId: source.campusId,
	});
	await assertWritableCampus(tx, {
		organizationId: input.organizationId,
		campusAccess: input.campusAccess,
		campusId: target.campusId,
	});
	const contacts = await loadMergeContacts(tx, [source.id, target.id]);
	return {
		source: profileOf(source),
		target: profileOf(target),
		contacts,
		conflicts: mergeConflicts(source, target, contacts),
		blockingReasons: await getBlockingReasons(tx, {
			organizationId: input.organizationId,
			sourceStudentId: source.id,
			targetStudentId: target.id,
		}),
	};
}

export async function getStudentMergePreviewRecord(input: {
	organizationId: string;
	userId: string;
	sourceStudentId: string;
	targetStudentId: string;
}): Promise<StudentMergePreview> {
	return db.transaction(async (tx) => {
		const campusAccess = await getMergeAccess(tx, input);
		return loadPreviewInTransaction(tx, { ...input, campusAccess });
	});
}

export async function mergeStudentRecords(
	input: MergeStudentsRecordInput,
): Promise<MergeStudentsRecordResult> {
	const requestHash = inputHash(input);
	return db.transaction(async (tx) => {
		const campusAccess = await getMergeAccess(tx, input);
		const [replay] = await tx
			.select({
				sourceStudentId: studentMerge.sourceStudentId,
				targetStudentId: studentMerge.targetStudentId,
				inputHash: studentMerge.inputHash,
			})
			.from(studentMerge)
			.where(
				and(
					eq(studentMerge.organizationId, input.organizationId),
					eq(studentMerge.requestId, input.requestId),
				),
			)
			.limit(1)
			.for("update");
		if (replay) {
			if (replay.inputHash !== requestHash) {
				throw new StudentMergeRepositoryError("IDEMPOTENCY_CONFLICT");
			}
			return {
				sourceStudentId: replay.sourceStudentId,
				targetStudentId: replay.targetStudentId,
				replayed: true,
			};
		}

		const preview = await loadPreviewInTransaction(tx, {
			...input,
			campusAccess,
		});
		if (
			preview.source.version !== input.expectedSourceVersion ||
			preview.target.version !== input.expectedTargetVersion
		) {
			throw new StudentMergeRepositoryError("STUDENT_VERSION_CONFLICT");
		}
		if (preview.blockingReasons.includes("ACTIVE_COURSE_ENROLLMENT")) {
			throw new StudentMergeRepositoryError(
				"STUDENT_MERGE_ACTIVE_COURSE_ENROLLMENT",
			);
		}
		if (preview.blockingReasons.includes("ATTENDANCE_CONFLICT")) {
			throw new StudentMergeRepositoryError(
				"STUDENT_MERGE_ATTENDANCE_CONFLICT",
			);
		}
		const selectedCampusId =
			input.fieldSources.campusId === "source"
				? preview.source.campusId
				: preview.target.campusId;
		const selectedOwnerUserId =
			input.fieldSources.ownerUserId === "source"
				? preview.source.ownerUserId
				: preview.target.ownerUserId;
		if (selectedOwnerUserId) {
			try {
				await assertEligibleStudentOwner(tx, {
					organizationId: input.organizationId,
					ownerUserId: selectedOwnerUserId,
					campusId: selectedCampusId,
				});
			} catch (error) {
				if (error instanceof StudentOwnershipError) {
					throw new StudentMergeRepositoryError("STUDENT_OWNER_NOT_ELIGIBLE");
				}
				throw error;
			}
		}
		const activeEnrollmentCampuses = await tx
			.select({ campusId: classGroup.campusId })
			.from(enrollment)
			.innerJoin(classGroup, eq(classGroup.id, enrollment.classGroupId))
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					inArray(enrollment.studentId, [preview.source.id, preview.target.id]),
					inArray(enrollment.status, ["active", "frozen"]),
				),
			)
			.for("update");
		if (
			activeEnrollmentCampuses.some(
				(item) => item.campusId !== selectedCampusId,
			)
		) {
			throw new StudentMergeRepositoryError(
				"STUDENT_MERGE_CAMPUS_ENROLLMENT_CONFLICT",
			);
		}

		const contactsById = new Map(
			preview.contacts.map((contact) => [contact.id, contact]),
		);
		const primaryContact = contactsById.get(
			input.fieldSources.primaryContactId,
		);
		if (
			!primaryContact ||
			primaryContact.duplicateOfContactId ||
			!preview.contacts.some(
				(contact) =>
					contact.id === primaryContact.id ||
					contact.duplicateOfContactId === primaryContact.id,
			)
		) {
			throw new StudentMergeRepositoryError("STUDENT_MERGE_CONTACT_INVALID");
		}

		const source = preview.source;
		const target = preview.target;
		const contactIdsToDelete = preview.contacts
			.filter(
				(contact) =>
					contact.studentId === source.id &&
					contact.duplicateOfContactId !== null,
			)
			.map((contact) => contact.id);
		const contactIdsToMove = preview.contacts
			.filter(
				(contact) =>
					contact.studentId === source.id &&
					contact.duplicateOfContactId === null,
			)
			.map((contact) => contact.id);

		await tx
			.update(studentContact)
			.set({ isPrimary: false })
			.where(eq(studentContact.studentId, target.id));
		if (contactIdsToDelete.length > 0) {
			await tx
				.delete(studentContact)
				.where(inArray(studentContact.id, contactIdsToDelete));
		}
		if (contactIdsToMove.length > 0) {
			await tx
				.update(studentContact)
				.set({ studentId: target.id, isPrimary: false })
				.where(inArray(studentContact.id, contactIdsToMove));
		}
		await tx
			.update(studentContact)
			.set({ isPrimary: true })
			.where(eq(studentContact.id, primaryContact.id));

		const sourceTags = await tx
			.select({ studentTagId: studentTagAssignment.studentTagId })
			.from(studentTagAssignment)
			.where(eq(studentTagAssignment.studentId, source.id))
			.for("update");
		if (sourceTags.length > 0) {
			await tx
				.insert(studentTagAssignment)
				.values(
					sourceTags.map((tag) => ({
						studentId: target.id,
						studentTagId: tag.studentTagId,
					})),
				)
				.onConflictDoNothing();
		}

		await tx
			.update(enrollment)
			.set({ studentId: target.id })
			.where(
				and(
					eq(enrollment.organizationId, input.organizationId),
					eq(enrollment.studentId, source.id),
				),
			);
		await tx
			.update(enrollmentRegistration)
			.set({ studentId: target.id })
			.where(
				and(
					eq(enrollmentRegistration.organizationId, input.organizationId),
					eq(enrollmentRegistration.studentId, source.id),
				),
			);
		await tx
			.update(invoice)
			.set({ studentId: target.id })
			.where(
				and(
					eq(invoice.organizationId, input.organizationId),
					eq(invoice.studentId, source.id),
				),
			);
		await tx
			.update(attendance)
			.set({ studentId: target.id })
			.where(eq(attendance.studentId, source.id));

		const primary = await tx
			.select({
				name: studentContact.name,
				phone: studentContact.phone,
				phoneNormalized: studentContact.phoneNormalized,
			})
			.from(studentContact)
			.where(eq(studentContact.id, primaryContact.id))
			.limit(1)
			.for("update");
		const primaryRecord = primary[0];
		if (!primaryRecord) {
			throw new StudentMergeRepositoryError("STUDENT_MERGE_CONTACT_INVALID");
		}
		const now = new Date();
		await tx
			.update(student)
			.set({
				name: input.fieldSources.name === "source" ? source.name : target.name,
				campusId:
					input.fieldSources.campusId === "source"
						? source.campusId
						: target.campusId,
				birthDate:
					input.fieldSources.birthDate === "source"
						? source.birthDate
						: target.birthDate,
				status:
					input.fieldSources.status === "source"
						? source.status
						: target.status,
				ownerUserId: selectedOwnerUserId,
				guardianName: primaryRecord.name,
				guardianPhone: primaryRecord.phone,
				guardianPhoneNormalized: primaryRecord.phoneNormalized,
				version: sql`${student.version} + 1`,
				updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
			})
			.where(eq(student.id, target.id));
		await recordStudentOwnerAssignment(tx, {
			organizationId: input.organizationId,
			studentId: target.id,
			campusId: selectedCampusId,
			beforeOwnerUserId: target.ownerUserId,
			afterOwnerUserId: selectedOwnerUserId,
			operatorUserId: input.userId,
			source: "merge",
		});
		await tx
			.update(student)
			.set({
				mergedIntoStudentId: target.id,
				mergedAt: now,
				version: sql`${student.version} + 1`,
				updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
			})
			.where(eq(student.id, source.id));

		const [merge] = await tx
			.insert(studentMerge)
			.values({
				organizationId: input.organizationId,
				sourceStudentId: source.id,
				targetStudentId: target.id,
				operatorUserId: input.userId,
				requestId: input.requestId,
				inputHash: requestHash,
				selection: input.fieldSources,
			})
			.returning({ id: studentMerge.id });
		if (!merge) throw new StudentMergeRepositoryError("STUDENT_NOT_FOUND");
		await writeOrganizationAuditEvent(tx, {
			organizationId: input.organizationId,
			action: "student_merged",
			entityType: "student_merge",
			entityId: merge.id,
			actorUserId: input.userId,
			campusId: target.campusId,
			before: { sourceStudentId: source.id, targetStudentId: target.id },
			after: {
				requestId: input.requestId,
				movedContactCount: contactIdsToMove.length,
				mergedTagCount: sourceTags.length,
			},
		});
		return {
			sourceStudentId: source.id,
			targetStudentId: target.id,
			replayed: false,
		};
	});
}
