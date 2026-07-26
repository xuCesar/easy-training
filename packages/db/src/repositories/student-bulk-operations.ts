import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../index";
import {
	type organizationMember,
	student,
	studentBulkOperationBatch,
	studentTag,
	studentTagAssignment,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import { isCampusAccessible, type Transaction } from "./campus-access";
import type { CampusAccess } from "./organization";
import {
	assertEligibleStudentOwner,
	StudentOwnershipError,
	setStudentOwnerInTransaction,
} from "./student-ownership";
import {
	getCurrentStudentWriteCampusAccess,
	StudentRepositoryError,
} from "./students";

type StudentBulkTarget = { studentId: string; expectedVersion: number };
export type StudentBulkOperationInput =
	| {
			kind: "setStudentOwner";
			targets: StudentBulkTarget[];
			ownerUserId: string;
	  }
	| { kind: "clearStudentOwner"; targets: StudentBulkTarget[] }
	| { kind: "addStudentTag"; targets: StudentBulkTarget[]; tagId: string }
	| { kind: "removeStudentTag"; targets: StudentBulkTarget[]; tagId: string };

export type StudentBulkBlockerCode =
	| "STUDENT_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "STUDENT_VERSION_CONFLICT"
	| "STUDENT_OWNER_NOT_ELIGIBLE"
	| "STUDENT_TAG_NOT_FOUND"
	| "STUDENT_TAG_INACTIVE";

export type StudentBulkPreviewItem = {
	studentId: string;
	studentName: string | null;
	status: "change" | "no_change" | "blocked";
	blockerCode: StudentBulkBlockerCode | null;
	before: string | null;
	after: string | null;
};

export class StudentBulkOperationError extends Error {
	constructor(
		public readonly code:
			| "MEMBER_FORBIDDEN"
			| "BULK_BLOCKED"
			| "IDEMPOTENCY_CONFLICT",
		public readonly items: StudentBulkPreviewItem[] = [],
	) {
		super(code);
		this.name = "StudentBulkOperationError";
	}
}

const managementRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager"]);

function summarize(items: StudentBulkPreviewItem[]) {
	return {
		items,
		changeCount: items.filter((item) => item.status === "change").length,
		noChangeCount: items.filter((item) => item.status === "no_change").length,
		blockedCount: items.filter((item) => item.status === "blocked").length,
	};
}

async function planStudentBulkOperation(
	tx: Transaction,
	input: StudentBulkOperationInput & {
		organizationId: string;
		campusAccess: CampusAccess;
	},
) {
	const targets = [...input.targets].sort((left, right) =>
		left.studentId.localeCompare(right.studentId),
	);
	const records = await tx
		.select({
			id: student.id,
			name: student.name,
			campusId: student.campusId,
			ownerUserId: student.ownerUserId,
			version: student.version,
		})
		.from(student)
		.where(
			and(
				eq(student.organizationId, input.organizationId),
				isNull(student.mergedIntoStudentId),
				isNull(student.anonymizedAt),
				inArray(
					student.id,
					targets.map((target) => target.studentId),
				),
			),
		)
		.orderBy(asc(student.id))
		.for("update");
	const recordById = new Map(records.map((record) => [record.id, record]));

	let tagRecord: { id: string; name: string; isActive: boolean } | null = null;
	const tagId =
		input.kind === "addStudentTag" || input.kind === "removeStudentTag"
			? input.tagId
			: null;
	if (tagId) {
		[tagRecord = null] = await tx
			.select({
				id: studentTag.id,
				name: studentTag.name,
				isActive: studentTag.isActive,
			})
			.from(studentTag)
			.where(
				and(
					eq(studentTag.id, tagId),
					eq(studentTag.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
	}
	const tagAssignments = tagId
		? await tx
				.select({ studentId: studentTagAssignment.studentId })
				.from(studentTagAssignment)
				.where(
					and(
						eq(studentTagAssignment.studentTagId, tagId),
						inArray(
							studentTagAssignment.studentId,
							targets.map((target) => target.studentId),
						),
					),
				)
				.for("update")
		: [];
	const assignedStudentIds = new Set(
		tagAssignments.map((item) => item.studentId),
	);

	const items: StudentBulkPreviewItem[] = [];
	for (const target of targets) {
		const record = recordById.get(target.studentId);
		if (!record) {
			items.push({
				studentId: target.studentId,
				studentName: null,
				status: "blocked",
				blockerCode: "STUDENT_NOT_FOUND",
				before: null,
				after: null,
			});
			continue;
		}
		if (!isCampusAccessible(input.campusAccess, record.campusId)) {
			items.push({
				studentId: record.id,
				studentName: record.name,
				status: "blocked",
				blockerCode: "CAMPUS_OUT_OF_SCOPE",
				before: null,
				after: null,
			});
			continue;
		}
		if (record.version !== target.expectedVersion) {
			items.push({
				studentId: record.id,
				studentName: record.name,
				status: "blocked",
				blockerCode: "STUDENT_VERSION_CONFLICT",
				before: String(record.version),
				after: String(target.expectedVersion),
			});
			continue;
		}

		if (input.kind === "setStudentOwner") {
			try {
				await assertEligibleStudentOwner(tx, {
					organizationId: input.organizationId,
					ownerUserId: input.ownerUserId,
					campusId: record.campusId,
				});
			} catch (error) {
				if (!(error instanceof StudentOwnershipError)) throw error;
				items.push({
					studentId: record.id,
					studentName: record.name,
					status: "blocked",
					blockerCode: "STUDENT_OWNER_NOT_ELIGIBLE",
					before: record.ownerUserId,
					after: input.ownerUserId,
				});
				continue;
			}
			items.push({
				studentId: record.id,
				studentName: record.name,
				status:
					record.ownerUserId === input.ownerUserId ? "no_change" : "change",
				blockerCode: null,
				before: record.ownerUserId,
				after: input.ownerUserId,
			});
			continue;
		}
		if (input.kind === "clearStudentOwner") {
			items.push({
				studentId: record.id,
				studentName: record.name,
				status: record.ownerUserId === null ? "no_change" : "change",
				blockerCode: null,
				before: record.ownerUserId,
				after: null,
			});
			continue;
		}
		if (!tagRecord) {
			items.push({
				studentId: record.id,
				studentName: record.name,
				status: "blocked",
				blockerCode: "STUDENT_TAG_NOT_FOUND",
				before: null,
				after: null,
			});
			continue;
		}
		if (input.kind === "addStudentTag" && !tagRecord.isActive) {
			items.push({
				studentId: record.id,
				studentName: record.name,
				status: "blocked",
				blockerCode: "STUDENT_TAG_INACTIVE",
				before: null,
				after: tagRecord.name,
			});
			continue;
		}
		const assigned = assignedStudentIds.has(record.id);
		const changes = input.kind === "addStudentTag" ? !assigned : assigned;
		items.push({
			studentId: record.id,
			studentName: record.name,
			status: changes ? "change" : "no_change",
			blockerCode: null,
			before: assigned ? tagRecord.name : null,
			after: input.kind === "addStudentTag" ? tagRecord.name : null,
		});
	}
	return summarize(items);
}

function databaseKind(kind: StudentBulkOperationInput["kind"]) {
	switch (kind) {
		case "setStudentOwner":
			return "set_owner" as const;
		case "clearStudentOwner":
			return "clear_owner" as const;
		case "addStudentTag":
			return "add_tag" as const;
		case "removeStudentTag":
			return "remove_tag" as const;
	}
}

function createInputHash(
	input: StudentBulkOperationInput & { userId: string },
) {
	return createHash("sha256")
		.update(JSON.stringify(input), "utf8")
		.digest("hex");
}

export async function previewStudentBulkOperationRecord(
	input: StudentBulkOperationInput & { organizationId: string; userId: string },
) {
	try {
		return await db.transaction(async (tx) => {
			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: managementRoles,
			});
			return planStudentBulkOperation(tx, { ...input, campusAccess });
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new StudentBulkOperationError("MEMBER_FORBIDDEN");
		}
		throw error;
	}
}

export async function commitStudentBulkOperationRecord(
	input: StudentBulkOperationInput & {
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
				.limit(1);
			if (existing) {
				if (existing.inputHash !== inputHash) {
					throw new StudentBulkOperationError("IDEMPOTENCY_CONFLICT");
				}
				return {
					batchId: existing.id,
					changedCount: existing.changedCount,
					unchangedCount: existing.unchangedCount,
					replayed: true,
				};
			}

			const plan = await planStudentBulkOperation(tx, {
				...input,
				campusAccess,
			});
			if (plan.blockedCount > 0) {
				throw new StudentBulkOperationError("BULK_BLOCKED", plan.items);
			}
			const [batch] = await tx
				.insert(studentBulkOperationBatch)
				.values({
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash,
					kind: databaseKind(input.kind),
					targetCount: input.targets.length,
					changedCount: plan.changeCount,
					unchangedCount: plan.noChangeCount,
					targetIds: input.targets.map((target) => target.studentId).sort(),
					createdByUserId: input.userId,
				})
				.returning({ id: studentBulkOperationBatch.id });
			if (!batch) throw new Error("Student bulk batch insert returned no row.");

			const versionByStudentId = new Map(
				input.targets.map((target) => [
					target.studentId,
					target.expectedVersion,
				]),
			);
			for (const item of plan.items.filter(
				(candidate) => candidate.status === "change",
			)) {
				const expectedVersion = versionByStudentId.get(item.studentId);
				if (!expectedVersion)
					throw new Error("Student bulk target version was lost.");
				if (
					input.kind === "setStudentOwner" ||
					input.kind === "clearStudentOwner"
				) {
					const [record] = await tx
						.select({
							campusId: student.campusId,
							ownerUserId: student.ownerUserId,
						})
						.from(student)
						.where(eq(student.id, item.studentId))
						.limit(1);
					if (!record)
						throw new StudentBulkOperationError("BULK_BLOCKED", plan.items);
					await setStudentOwnerInTransaction(tx, {
						organizationId: input.organizationId,
						studentId: item.studentId,
						campusId: record.campusId,
						beforeOwnerUserId: record.ownerUserId,
						afterOwnerUserId:
							input.kind === "setStudentOwner" ? input.ownerUserId : null,
						expectedVersion,
						operatorUserId: input.userId,
						source: "bulk",
						batchId: batch.id,
					});
					continue;
				}

				if (input.kind === "addStudentTag") {
					await tx.insert(studentTagAssignment).values({
						studentId: item.studentId,
						studentTagId: input.tagId,
					});
				} else {
					await tx
						.delete(studentTagAssignment)
						.where(
							and(
								eq(studentTagAssignment.studentId, item.studentId),
								eq(studentTagAssignment.studentTagId, input.tagId),
							),
						);
				}
				const [updated] = await tx
					.update(student)
					.set({
						version: sql`${student.version} + 1`,
						updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
					})
					.where(
						and(
							eq(student.id, item.studentId),
							eq(student.version, expectedVersion),
						),
					)
					.returning({ id: student.id });
				if (!updated)
					throw new StudentBulkOperationError("BULK_BLOCKED", plan.items);
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
					targetIds: input.targets.map((target) => target.studentId).sort(),
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
			throw new StudentBulkOperationError("MEMBER_FORBIDDEN");
		}
		if (
			error instanceof StudentOwnershipError &&
			error.code === "STUDENT_VERSION_CONFLICT"
		) {
			throw new StudentBulkOperationError("BULK_BLOCKED");
		}
		throw error;
	}
}
