import { and, asc, count, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { db } from "../index";
import {
	organizationMember,
	organizationMemberCampus,
	student,
	studentOwnerAssignmentEvent,
} from "../schema";

export type StudentOwnershipTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

type MemberRole = (typeof organizationMember.$inferSelect)["role"];
type AssignmentSource =
	(typeof studentOwnerAssignmentEvent.$inferInsert)["source"];

const eligibleOwnerRoles = new Set<MemberRole>([
	"owner",
	"admin",
	"campus_manager",
	"consultant",
]);

export class StudentOwnershipError extends Error {
	constructor(
		public readonly code:
			| "STUDENT_OWNER_NOT_ELIGIBLE"
			| "STUDENT_VERSION_CONFLICT",
	) {
		super(code);
		this.name = "StudentOwnershipError";
	}
}

function isOrganizationWideMember(member: {
	role: MemberRole;
	campusAccessMode: "all" | "selected";
}): boolean {
	return (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	);
}

export async function assertEligibleStudentOwner(
	tx: StudentOwnershipTransaction,
	input: { organizationId: string; ownerUserId: string; campusId: string },
): Promise<void> {
	const [member] = await tx
		.select({
			id: organizationMember.id,
			role: organizationMember.role,
			campusAccessMode: organizationMember.campusAccessMode,
		})
		.from(organizationMember)
		.where(
			and(
				eq(organizationMember.organizationId, input.organizationId),
				eq(organizationMember.userId, input.ownerUserId),
			),
		)
		.limit(1)
		.for("update");
	if (!member || !eligibleOwnerRoles.has(member.role)) {
		throw new StudentOwnershipError("STUDENT_OWNER_NOT_ELIGIBLE");
	}
	if (isOrganizationWideMember(member)) return;

	const [scope] = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(
			and(
				eq(organizationMemberCampus.organizationMemberId, member.id),
				eq(organizationMemberCampus.campusId, input.campusId),
			),
		)
		.limit(1);
	if (!scope) {
		throw new StudentOwnershipError("STUDENT_OWNER_NOT_ELIGIBLE");
	}
}

export async function recordStudentOwnerAssignment(
	tx: StudentOwnershipTransaction,
	input: {
		organizationId: string;
		studentId: string;
		campusId: string;
		beforeOwnerUserId: string | null;
		afterOwnerUserId: string | null;
		operatorUserId: string | null;
		source: AssignmentSource;
		batchId?: string | null;
	},
): Promise<void> {
	if (input.beforeOwnerUserId === input.afterOwnerUserId) return;
	await tx.insert(studentOwnerAssignmentEvent).values({
		...input,
		batchId: input.batchId ?? null,
	});
}

export async function setStudentOwnerInTransaction(
	tx: StudentOwnershipTransaction,
	input: {
		organizationId: string;
		studentId: string;
		campusId: string;
		beforeOwnerUserId: string | null;
		afterOwnerUserId: string | null;
		expectedVersion: number;
		operatorUserId: string | null;
		source: AssignmentSource;
		batchId?: string | null;
	},
): Promise<number> {
	if (input.beforeOwnerUserId === input.afterOwnerUserId) {
		return input.expectedVersion;
	}
	if (input.afterOwnerUserId) {
		await assertEligibleStudentOwner(tx, {
			organizationId: input.organizationId,
			ownerUserId: input.afterOwnerUserId,
			campusId: input.campusId,
		});
	}
	const [updated] = await tx
		.update(student)
		.set({
			ownerUserId: input.afterOwnerUserId,
			version: sql`${student.version} + 1`,
			updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
		})
		.where(
			and(
				eq(student.id, input.studentId),
				eq(student.organizationId, input.organizationId),
				eq(student.version, input.expectedVersion),
			),
		)
		.returning({ version: student.version });
	if (!updated) {
		throw new StudentOwnershipError("STUDENT_VERSION_CONFLICT");
	}
	await recordStudentOwnerAssignment(tx, input);
	return updated.version;
}

export async function clearInvalidStudentOwnersForMember(
	tx: StudentOwnershipTransaction,
	input: {
		organizationId: string;
		memberUserId: string;
		nextRole: MemberRole | null;
		nextCampusAccessMode: "all" | "selected";
		nextCampusIds: string[];
		operatorUserId: string;
	},
): Promise<string[]> {
	const filters = invalidStudentOwnerFilters(input);
	if (!filters) return [];

	const affected = await tx
		.select({ id: student.id, campusId: student.campusId })
		.from(student)
		.where(and(...filters))
		.orderBy(asc(student.id))
		.for("update");
	if (affected.length === 0) return [];

	const affectedIds = affected.map((item) => item.id);
	await tx
		.update(student)
		.set({
			ownerUserId: null,
			version: sql`${student.version} + 1`,
			updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
		})
		.where(inArray(student.id, affectedIds));
	await tx.insert(studentOwnerAssignmentEvent).values(
		affected.map((item) => ({
			organizationId: input.organizationId,
			studentId: item.id,
			campusId: item.campusId,
			beforeOwnerUserId: input.memberUserId,
			afterOwnerUserId: null,
			operatorUserId: input.operatorUserId,
			source: "authorization_revoked" as const,
		})),
	);
	return affectedIds;
}

function invalidStudentOwnerFilters(input: {
	organizationId: string;
	memberUserId: string;
	nextRole: MemberRole | null;
	nextCampusAccessMode: "all" | "selected";
	nextCampusIds: string[];
}) {
	const remainsEligible =
		input.nextRole !== null && eligibleOwnerRoles.has(input.nextRole);
	const organizationWide =
		remainsEligible &&
		(input.nextRole === "owner" ||
			input.nextRole === "admin" ||
			input.nextCampusAccessMode === "all");
	if (organizationWide) return null;

	const filters = [
		eq(student.organizationId, input.organizationId),
		eq(student.ownerUserId, input.memberUserId),
	];
	if (remainsEligible && input.nextCampusIds.length > 0) {
		filters.push(notInArray(student.campusId, input.nextCampusIds));
	}
	return filters;
}

export async function countInvalidStudentOwnersForMember(
	tx: StudentOwnershipTransaction,
	input: {
		organizationId: string;
		memberUserId: string;
		nextRole: MemberRole | null;
		nextCampusAccessMode: "all" | "selected";
		nextCampusIds: string[];
	},
): Promise<number> {
	const filters = invalidStudentOwnerFilters(input);
	if (!filters) return 0;
	const [result] = await tx
		.select({ value: count() })
		.from(student)
		.where(and(...filters));
	return result?.value ?? 0;
}
