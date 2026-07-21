import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	or,
	sql,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	organizationMember,
	organizationMemberCampus,
	student,
	studentContact,
	studentStatusEvent,
	studentTag,
	studentTagAssignment,
} from "../schema";
import type { CampusAccess } from "./organization";
import { normalizeStudentPhone } from "./student-phone";

export type StudentRepositoryErrorCode =
	| "STUDENT_NOT_FOUND"
	| "STUDENT_VERSION_CONFLICT"
	| "CAMPUS_NOT_FOUND"
	| "CAMPUS_OUT_OF_SCOPE"
	| "CAMPUS_INACTIVE"
	| "CONTACT_INVARIANT"
	| "INVALID_TAGS"
	| "STUDENT_TAG_NOT_FOUND"
	| "STUDENT_TAG_DUPLICATE"
	| "MEMBER_FORBIDDEN"
	| "STUDENT_MERGED"
	| "INVALID_CURSOR";

export class StudentRepositoryError extends Error {
	constructor(public readonly code: StudentRepositoryErrorCode) {
		super(code);
		this.name = "StudentRepositoryError";
	}
}

export type StudentContactInput = {
	id?: string;
	name: string;
	phone: string;
	relationship: string | null;
	isPrimary: boolean;
};

export type StudentTagRecord = {
	id: string;
	name: string;
	isActive: boolean;
};

export type StudentSummaryRecord = {
	id: string;
	name: string;
	campusId: string;
	campusName: string;
	status: (typeof student.$inferSelect)["status"];
	primaryContactName: string;
	primaryContactPhoneMasked: string;
	tags: StudentTagRecord[];
	createdAt: Date;
	updatedAt: Date;
};

export type StudentDetailRecord = StudentSummaryRecord & {
	birthDate: string | null;
	contacts: Array<{
		id: string;
		name: string;
		phone: string;
		relationship: string | null;
		isPrimary: boolean;
	}>;
};

export type DuplicateStudentCandidateRecord = {
	id: string;
	name: string;
	campusId: string;
	campusName: string;
	status: (typeof student.$inferSelect)["status"];
	phoneMasked: string;
};

export type CreateStudentRecordInput = {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	name: string;
	campusId: string;
	birthDate: string | null;
	status: (typeof student.$inferInsert)["status"];
	contacts: StudentContactInput[];
	tagIds: string[];
};

export type UpdateStudentRecordInput = {
	name: string;
	birthDate: string | null;
	status: (typeof student.$inferInsert)["status"];
	contacts: StudentContactInput[];
	tagIds: string[];
};

type StudentCursor = { name: string; id: string };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isCampusAccessible(
	campusAccess: CampusAccess,
	campusId: string,
): boolean {
	return (
		campusAccess.kind === "all" ||
		(campusAccess.kind === "selected" &&
			campusAccess.campusIds.includes(campusId))
	);
}

const studentWriteRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager", "consultant"]);

const studentTagWriteRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin"]);

function isOrganizationWideMember(
	member: Pick<
		typeof organizationMember.$inferSelect,
		"role" | "campusAccessMode"
	>,
): boolean {
	return (
		member.role === "owner" ||
		member.role === "admin" ||
		member.campusAccessMode === "all"
	);
}

async function getCurrentWriteCampusAccess(
	tx: Transaction,
	input: {
		organizationId: string;
		userId: string;
		allowedRoles: ReadonlySet<(typeof organizationMember.$inferSelect)["role"]>;
	},
): Promise<CampusAccess> {
	// 与成员权限变更共用机构级事务锁，避免请求使用已撤销的授权快照写入。
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`,
	);

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
				eq(organizationMember.userId, input.userId),
			),
		)
		.limit(1)
		.for("update");
	if (!member || !input.allowedRoles.has(member.role)) {
		throw new StudentRepositoryError("MEMBER_FORBIDDEN");
	}
	if (isOrganizationWideMember(member)) return { kind: "all" };

	const scopes = await tx
		.select({ campusId: organizationMemberCampus.campusId })
		.from(organizationMemberCampus)
		.where(eq(organizationMemberCampus.organizationMemberId, member.id))
		.orderBy(asc(organizationMemberCampus.campusId));
	return scopes.length > 0
		? { kind: "selected", campusIds: scopes.map((scope) => scope.campusId) }
		: { kind: "none" };
}

function campusAccessCondition(campusAccess: CampusAccess) {
	if (campusAccess.kind === "none") return sql`false`;
	if (campusAccess.kind === "selected") {
		return inArray(student.campusId, campusAccess.campusIds);
	}
	return sql`true`;
}

function encodeCursor(cursor: StudentCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function isStudentCursor(value: unknown): value is StudentCursor {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		"id" in value &&
		typeof value.name === "string" &&
		typeof value.id === "string" &&
		Boolean(value.name) &&
		Boolean(value.id)
	);
}

function decodeCursor(cursor: string | undefined): StudentCursor | undefined {
	if (!cursor) return undefined;

	try {
		const decoded: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (!isStudentCursor(decoded)) {
			throw new Error("Invalid cursor payload.");
		}
		return decoded;
	} catch {
		throw new StudentRepositoryError("INVALID_CURSOR");
	}
}

function maskPhone(phone: string): string {
	const compact = phone.replace(/[\s()（）-]/gu, "");
	if (compact.length < 5) return "***";
	if (compact.length < 8)
		return `${compact.slice(0, 1)}***${compact.slice(-1)}`;
	return `${compact.slice(0, 3)}****${compact.slice(-4)}`;
}

export async function findDuplicateStudentCandidates(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	phone: string;
	excludeStudentId?: string;
}): Promise<DuplicateStudentCandidateRecord[]> {
	const normalizedPhone = normalizeStudentPhone(input.phone);
	if (!normalizedPhone || input.campusAccess.kind === "none") return [];
	const candidates = await db
		.select({
			id: student.id,
			name: student.name,
			campusId: campus.id,
			campusName: campus.name,
			status: student.status,
			guardianPhone: student.guardianPhone,
		})
		.from(student)
		.innerJoin(
			campus,
			and(
				eq(campus.id, student.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.leftJoin(studentContact, eq(studentContact.studentId, student.id))
		.where(
			and(
				eq(student.organizationId, input.organizationId),
				isNull(student.mergedIntoStudentId),
				campusAccessCondition(input.campusAccess),
				input.excludeStudentId
					? sql`${student.id} <> ${input.excludeStudentId}`
					: undefined,
				or(
					eq(student.guardianPhoneNormalized, normalizedPhone),
					eq(studentContact.phoneNormalized, normalizedPhone),
				),
			),
		)
		.orderBy(asc(student.name), asc(student.id));
	return Array.from(
		new Map(
			candidates.map((item) => [
				item.id,
				{
					id: item.id,
					name: item.name,
					campusId: item.campusId,
					campusName: item.campusName,
					status: item.status,
					phoneMasked: maskPhone(item.guardianPhone),
				},
			]),
		).values(),
	);
}

function normalizeTagName(name: string): string {
	return name.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function ensureTagName(name: string): { name: string; normalized: string } {
	const trimmed = name.trim();
	const normalized = normalizeTagName(trimmed);
	if (!trimmed || !normalized) {
		throw new StudentRepositoryError("INVALID_TAGS");
	}
	return { name: trimmed, normalized };
}

function normalizeContacts(
	contacts: StudentContactInput[],
	options: { allowExistingIds: boolean },
): StudentContactInput[] {
	if (
		contacts.length === 0 ||
		contacts.filter((contact) => contact.isPrimary).length !== 1
	) {
		throw new StudentRepositoryError("CONTACT_INVARIANT");
	}

	const ids = new Set<string>();
	return contacts.map((contact) => {
		const name = contact.name.trim();
		const phone = contact.phone.trim();
		if (!name || !phone || (!options.allowExistingIds && contact.id)) {
			throw new StudentRepositoryError("CONTACT_INVARIANT");
		}
		if (contact.id) {
			if (ids.has(contact.id)) {
				throw new StudentRepositoryError("CONTACT_INVARIANT");
			}
			ids.add(contact.id);
		}
		return {
			...contact,
			name,
			phone,
			relationship: contact.relationship?.trim() || null,
		};
	});
}

function normalizeTagIds(tagIds: string[]): string[] {
	if (new Set(tagIds).size !== tagIds.length) {
		throw new StudentRepositoryError("INVALID_TAGS");
	}
	return tagIds;
}

async function assertWritableCampus(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		campusId: string;
	},
): Promise<void> {
	if (!isCampusAccessible(input.campusAccess, input.campusId)) {
		throw new StudentRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}

	const [campusRecord] = await tx
		.select({ id: campus.id, isActive: campus.isActive })
		.from(campus)
		.where(
			and(
				eq(campus.id, input.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.limit(1)
		.for("update");

	if (!campusRecord) throw new StudentRepositoryError("CAMPUS_NOT_FOUND");
	if (!campusRecord.isActive) {
		throw new StudentRepositoryError("CAMPUS_INACTIVE");
	}
}

async function loadStudentTags(
	executor: Pick<typeof db, "select">,
	organizationId: string,
	studentIds: string[],
): Promise<Map<string, StudentTagRecord[]>> {
	const tagsByStudent = new Map<string, StudentTagRecord[]>();
	if (studentIds.length === 0) return tagsByStudent;

	const rows = await executor
		.select({
			studentId: studentTagAssignment.studentId,
			id: studentTag.id,
			name: studentTag.name,
			isActive: studentTag.isActive,
		})
		.from(studentTagAssignment)
		.innerJoin(
			studentTag,
			and(
				eq(studentTag.id, studentTagAssignment.studentTagId),
				eq(studentTag.organizationId, organizationId),
			),
		)
		.where(inArray(studentTagAssignment.studentId, studentIds))
		.orderBy(asc(studentTag.name), asc(studentTag.id));

	for (const row of rows) {
		const tags = tagsByStudent.get(row.studentId) ?? [];
		tags.push({ id: row.id, name: row.name, isActive: row.isActive });
		tagsByStudent.set(row.studentId, tags);
	}
	return tagsByStudent;
}

async function assertAssignableTags(
	tx: Transaction,
	input: {
		organizationId: string;
		studentId: string | null;
		tagIds: string[];
	},
): Promise<void> {
	const tagIds = normalizeTagIds(input.tagIds);
	if (tagIds.length === 0) return;

	const tags = await tx
		.select({ id: studentTag.id, isActive: studentTag.isActive })
		.from(studentTag)
		.where(
			and(
				eq(studentTag.organizationId, input.organizationId),
				inArray(studentTag.id, tagIds),
			),
		)
		.for("update");

	if (tags.length !== tagIds.length) {
		throw new StudentRepositoryError("STUDENT_TAG_NOT_FOUND");
	}

	const existingTagIds = input.studentId
		? new Set(
				(
					await tx
						.select({ studentTagId: studentTagAssignment.studentTagId })
						.from(studentTagAssignment)
						.where(eq(studentTagAssignment.studentId, input.studentId))
						.for("update")
				).map((row) => row.studentTagId),
			)
		: new Set<string>();

	if (tags.some((tag) => !tag.isActive && !existingTagIds.has(tag.id))) {
		throw new StudentRepositoryError("INVALID_TAGS");
	}
}

async function replaceStudentTags(
	tx: Transaction,
	studentId: string,
	tagIds: string[],
): Promise<void> {
	await tx
		.delete(studentTagAssignment)
		.where(eq(studentTagAssignment.studentId, studentId));
	if (tagIds.length > 0) {
		await tx
			.insert(studentTagAssignment)
			.values(tagIds.map((studentTagId) => ({ studentId, studentTagId })));
	}
}

function getDatabaseError(error: unknown): {
	code?: unknown;
	constraint?: unknown;
} | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error;
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

function mapDatabaseError(error: unknown): never {
	const databaseError = getDatabaseError(error);
	if (
		databaseError?.code === "23505" &&
		databaseError.constraint === "student_tag_org_name_normalized_uidx"
	) {
		throw new StudentRepositoryError("STUDENT_TAG_DUPLICATE");
	}
	if (
		databaseError?.code === "23505" &&
		databaseError.constraint === "student_contact_primary_uidx"
	) {
		throw new StudentRepositoryError("CONTACT_INVARIANT");
	}
	throw error;
}

export async function listStudentRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	query?: string;
	campusId?: string;
	status?: (typeof student.$inferSelect)["status"];
	tagId?: string;
	cursor?: string;
	pageSize: number;
}): Promise<{
	items: StudentSummaryRecord[];
	nextCursor: string | null;
	total: number;
}> {
	if (
		input.campusId &&
		!isCampusAccessible(input.campusAccess, input.campusId)
	) {
		throw new StudentRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}

	const cursor = decodeCursor(input.cursor);
	const baseFilters = [
		eq(student.organizationId, input.organizationId),
		isNull(student.mergedIntoStudentId),
		campusAccessCondition(input.campusAccess),
	];
	if (input.campusId) baseFilters.push(eq(student.campusId, input.campusId));
	if (input.status) baseFilters.push(eq(student.status, input.status));
	if (input.tagId) {
		baseFilters.push(sql<boolean>`exists (
			select 1 from "student_tag_assignment"
			inner join "student_tag"
				on "student_tag"."id" = "student_tag_assignment"."student_tag_id"
			where "student_tag_assignment"."student_id" = ${student.id}
				and "student_tag_assignment"."student_tag_id" = ${input.tagId}
				and "student_tag"."organization_id" = ${input.organizationId}
		)`);
	}
	if (input.query) {
		const pattern = `%${input.query}%`;
		baseFilters.push(sql<boolean>`(
			${student.name} ilike ${pattern}
			or exists (
				select 1 from "student_contact"
				where "student_contact"."student_id" = ${student.id}
					and (
						"student_contact"."name" ilike ${pattern}
						or "student_contact"."phone" ilike ${pattern}
					)
			)
		)`);
	}
	const filters = [...baseFilters];
	if (cursor) {
		const cursorFilter = or(
			gt(student.name, cursor.name),
			and(eq(student.name, cursor.name), gt(student.id, cursor.id)),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}

	const where = and(...filters);
	const [rows, totalRows] = await Promise.all([
		db
			.select({
				id: student.id,
				name: student.name,
				campusId: student.campusId,
				campusName: campus.name,
				status: student.status,
				primaryContactName: studentContact.name,
				primaryContactPhone: studentContact.phone,
				createdAt: student.createdAt,
				updatedAt: student.updatedAt,
			})
			.from(student)
			.innerJoin(
				campus,
				and(
					eq(campus.id, student.campusId),
					eq(campus.organizationId, input.organizationId),
				),
			)
			.innerJoin(
				studentContact,
				and(
					eq(studentContact.studentId, student.id),
					eq(studentContact.isPrimary, true),
				),
			)
			.where(where)
			.orderBy(asc(student.name), asc(student.id))
			.limit(input.pageSize + 1),
		db
			.select({ value: count() })
			.from(student)
			.innerJoin(
				studentContact,
				and(
					eq(studentContact.studentId, student.id),
					eq(studentContact.isPrimary, true),
				),
			)
			.where(and(...baseFilters)),
	]);

	const pageRows = rows.slice(0, input.pageSize);
	const tagsByStudent = await loadStudentTags(
		db,
		input.organizationId,
		pageRows.map((row) => row.id),
	);
	const items = pageRows.map((row) => ({
		id: row.id,
		name: row.name,
		campusId: row.campusId,
		campusName: row.campusName,
		status: row.status,
		primaryContactName: row.primaryContactName,
		primaryContactPhoneMasked: maskPhone(row.primaryContactPhone),
		tags: tagsByStudent.get(row.id) ?? [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
	const lastItem = items.at(-1);

	return {
		items,
		nextCursor:
			rows.length > input.pageSize && lastItem
				? encodeCursor({ name: lastItem.name, id: lastItem.id })
				: null,
		total: totalRows[0]?.value ?? 0,
	};
}

export async function getStudentRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	id: string;
}): Promise<StudentDetailRecord> {
	const [studentScope] = await db
		.select({ campusId: student.campusId })
		.from(student)
		.where(
			and(
				eq(student.id, input.id),
				eq(student.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!studentScope) throw new StudentRepositoryError("STUDENT_NOT_FOUND");
	if (!isCampusAccessible(input.campusAccess, studentScope.campusId)) {
		throw new StudentRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}

	const [row] = await db
		.select({
			id: student.id,
			name: student.name,
			campusId: student.campusId,
			campusName: campus.name,
			birthDate: student.birthDate,
			status: student.status,
			primaryContactName: studentContact.name,
			primaryContactPhone: studentContact.phone,
			createdAt: student.createdAt,
			updatedAt: student.updatedAt,
		})
		.from(student)
		.innerJoin(
			campus,
			and(
				eq(campus.id, student.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			studentContact,
			and(
				eq(studentContact.studentId, student.id),
				eq(studentContact.isPrimary, true),
			),
		)
		.where(
			and(
				eq(student.id, input.id),
				eq(student.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!row) throw new StudentRepositoryError("CONTACT_INVARIANT");

	const [contacts, tagsByStudent] = await Promise.all([
		db
			.select({
				id: studentContact.id,
				name: studentContact.name,
				phone: studentContact.phone,
				relationship: studentContact.relationship,
				isPrimary: studentContact.isPrimary,
			})
			.from(studentContact)
			.where(eq(studentContact.studentId, input.id))
			.orderBy(desc(studentContact.isPrimary), asc(studentContact.createdAt)),
		loadStudentTags(db, input.organizationId, [input.id]),
	]);

	return {
		id: row.id,
		name: row.name,
		campusId: row.campusId,
		campusName: row.campusName,
		birthDate: row.birthDate,
		status: row.status,
		primaryContactName: row.primaryContactName,
		primaryContactPhoneMasked: maskPhone(row.primaryContactPhone),
		tags: tagsByStudent.get(row.id) ?? [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		contacts,
	};
}

export async function createStudentRecord(
	input: CreateStudentRecordInput,
): Promise<StudentDetailRecord> {
	const contacts = normalizeContacts(input.contacts, {
		allowExistingIds: false,
	});
	const tagIds = normalizeTagIds(input.tagIds);
	try {
		const id = await db.transaction(async (tx) => {
			const campusAccess = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentWriteRoles,
			});
			await assertWritableCampus(tx, { ...input, campusAccess });
			await assertAssignableTags(tx, {
				organizationId: input.organizationId,
				studentId: null,
				tagIds,
			});

			const primaryContact = contacts.find((contact) => contact.isPrimary);
			if (!primaryContact)
				throw new StudentRepositoryError("CONTACT_INVARIANT");
			const [created] = await tx
				.insert(student)
				.values({
					organizationId: input.organizationId,
					campusId: input.campusId,
					name: input.name.trim(),
					birthDate: input.birthDate,
					status: input.status,
					guardianName: primaryContact.name,
					guardianPhone: primaryContact.phone,
					guardianPhoneNormalized: normalizeStudentPhone(primaryContact.phone),
				})
				.returning({ id: student.id });
			if (!created)
				throw new Error("Student creation did not return a record.");

			await tx.insert(studentContact).values(
				contacts.map((contact) => ({
					studentId: created.id,
					name: contact.name,
					phone: contact.phone,
					phoneNormalized: normalizeStudentPhone(contact.phone),
					relationship: contact.relationship,
					isPrimary: contact.isPrimary,
				})),
			);
			await replaceStudentTags(tx, created.id, tagIds);
			return created.id;
		});
		return getStudentRecord({
			organizationId: input.organizationId,
			campusAccess: input.campusAccess,
			id,
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) throw error;
		return mapDatabaseError(error);
	}
}

export async function updateStudentRecord(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	id: string;
	expectedUpdatedAt: Date;
	data: UpdateStudentRecordInput;
}): Promise<StudentDetailRecord> {
	const contacts = normalizeContacts(input.data.contacts, {
		allowExistingIds: true,
	});
	const tagIds = normalizeTagIds(input.data.tagIds);
	const nextStatus = input.data.status;
	if (!nextStatus) throw new Error("Student status is required.");
	try {
		await db.transaction(async (tx) => {
			const campusAccess = await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentWriteRoles,
			});
			const [current] = await tx
				.select({
					id: student.id,
					campusId: student.campusId,
					updatedAt: student.updatedAt,
					mergedIntoStudentId: student.mergedIntoStudentId,
					status: student.status,
				})
				.from(student)
				.where(
					and(
						eq(student.id, input.id),
						eq(student.organizationId, input.organizationId),
					),
				)
				.limit(1)
				.for("update");
			if (!current) throw new StudentRepositoryError("STUDENT_NOT_FOUND");
			if (current.mergedIntoStudentId) {
				throw new StudentRepositoryError("STUDENT_MERGED");
			}
			await assertWritableCampus(tx, {
				organizationId: input.organizationId,
				campusAccess,
				campusId: current.campusId,
			});
			if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
				throw new StudentRepositoryError("STUDENT_VERSION_CONFLICT");
			}

			const existingContacts = await tx
				.select({ id: studentContact.id })
				.from(studentContact)
				.where(eq(studentContact.studentId, current.id))
				.for("update");
			const currentContactIds = new Set(existingContacts.map((row) => row.id));
			if (
				contacts.some(
					(contact) => contact.id && !currentContactIds.has(contact.id),
				)
			) {
				throw new StudentRepositoryError("CONTACT_INVARIANT");
			}

			await assertAssignableTags(tx, {
				organizationId: input.organizationId,
				studentId: current.id,
				tagIds,
			});
			const primaryContact = contacts.find((contact) => contact.isPrimary);
			if (!primaryContact)
				throw new StudentRepositoryError("CONTACT_INVARIANT");

			await tx
				.delete(studentContact)
				.where(eq(studentContact.studentId, current.id));
			await tx.insert(studentContact).values(
				contacts.map((contact) => ({
					...(contact.id ? { id: contact.id } : {}),
					studentId: current.id,
					name: contact.name,
					phone: contact.phone,
					phoneNormalized: normalizeStudentPhone(contact.phone),
					relationship: contact.relationship,
					isPrimary: contact.isPrimary,
				})),
			);
			await replaceStudentTags(tx, current.id, tagIds);
			await tx
				.update(student)
				.set({
					name: input.data.name.trim(),
					birthDate: input.data.birthDate,
					status: nextStatus,
					guardianName: primaryContact.name,
					guardianPhone: primaryContact.phone,
					guardianPhoneNormalized: normalizeStudentPhone(primaryContact.phone),
					updatedAt: sql`greatest(clock_timestamp(), ${student.updatedAt} + interval '1 millisecond')`,
				})
				.where(eq(student.id, current.id));
			const currentStatus = current.status;
			if (!currentStatus) throw new Error("Student status is missing.");
			if (currentStatus !== nextStatus) {
				await tx.insert(studentStatusEvent).values({
					organizationId: input.organizationId,
					studentId: current.id,
					campusId: current.campusId,
					beforeStatus: currentStatus,
					afterStatus: nextStatus,
					operatorUserId: input.userId,
				});
			}
		});
		return getStudentRecord({
			organizationId: input.organizationId,
			campusAccess: input.campusAccess,
			id: input.id,
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) throw error;
		return mapDatabaseError(error);
	}
}

export async function listStudentTagRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	includeInactive?: boolean;
}): Promise<{ items: StudentTagRecord[] }> {
	if (input.campusAccess.kind === "none") return { items: [] };
	const filters = [eq(studentTag.organizationId, input.organizationId)];
	if (!input.includeInactive) filters.push(eq(studentTag.isActive, true));
	const items = await db
		.select({
			id: studentTag.id,
			name: studentTag.name,
			isActive: studentTag.isActive,
		})
		.from(studentTag)
		.where(and(...filters))
		.orderBy(asc(studentTag.name), asc(studentTag.id));
	return { items };
}

export async function createStudentTagRecord(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	name: string;
}): Promise<StudentTagRecord> {
	const tagName = ensureTagName(input.name);
	try {
		const created = await db.transaction(async (tx) => {
			await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentTagWriteRoles,
			});
			const [record] = await tx
				.insert(studentTag)
				.values({
					organizationId: input.organizationId,
					name: tagName.name,
					nameNormalized: tagName.normalized,
				})
				.returning({
					id: studentTag.id,
					name: studentTag.name,
					isActive: studentTag.isActive,
				});
			if (!record)
				throw new Error("Student tag creation did not return a record.");
			return record;
		});
		if (!created)
			throw new Error("Student tag creation did not return a record.");
		return created;
	} catch (error) {
		if (error instanceof StudentRepositoryError) throw error;
		return mapDatabaseError(error);
	}
}

export async function renameStudentTagRecord(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	id: string;
	name: string;
}): Promise<StudentTagRecord> {
	const tagName = ensureTagName(input.name);
	try {
		const updated = await db.transaction(async (tx) => {
			await getCurrentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentTagWriteRoles,
			});
			const [record] = await tx
				.update(studentTag)
				.set({
					name: tagName.name,
					nameNormalized: tagName.normalized,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(studentTag.id, input.id),
						eq(studentTag.organizationId, input.organizationId),
					),
				)
				.returning({
					id: studentTag.id,
					name: studentTag.name,
					isActive: studentTag.isActive,
				});
			if (!record) throw new StudentRepositoryError("STUDENT_TAG_NOT_FOUND");
			return record;
		});
		if (!updated) throw new StudentRepositoryError("STUDENT_TAG_NOT_FOUND");
		return updated;
	} catch (error) {
		if (error instanceof StudentRepositoryError) throw error;
		return mapDatabaseError(error);
	}
}

export async function setStudentTagActiveRecord(input: {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	id: string;
	isActive: boolean;
}): Promise<StudentTagRecord> {
	const updated = await db.transaction(async (tx) => {
		await getCurrentWriteCampusAccess(tx, {
			organizationId: input.organizationId,
			userId: input.userId,
			allowedRoles: studentTagWriteRoles,
		});
		const [record] = await tx
			.update(studentTag)
			.set({ isActive: input.isActive, updatedAt: new Date() })
			.where(
				and(
					eq(studentTag.id, input.id),
					eq(studentTag.organizationId, input.organizationId),
				),
			)
			.returning({
				id: studentTag.id,
				name: studentTag.name,
				isActive: studentTag.isActive,
			});
		if (!record) throw new StudentRepositoryError("STUDENT_TAG_NOT_FOUND");
		return record;
	});
	if (!updated) throw new StudentRepositoryError("STUDENT_TAG_NOT_FOUND");
	return updated;
}
