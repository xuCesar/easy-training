import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	organizationMember,
	organizationMemberCampus,
	student,
	studentContact,
	studentImportBatch,
	studentOwnerAssignmentEvent,
	studentTag,
	studentTagAssignment,
	user,
} from "../schema";
import { writeOrganizationAuditEvent } from "./audit";
import {
	campusAccessCondition,
	escapedContains,
	isCampusAccessible,
	type Transaction,
} from "./campus-access";
import {
	CsvRepositoryError,
	type CsvRow,
	hasCsvFormulaPrefix,
	MAX_IMPORT_ROWS,
	parseCsvRecords,
} from "./csv";
import type { CampusAccess } from "./organization";
import {
	lockStudentPhonesInTransaction,
	normalizeStudentPhone,
} from "./student-phone";
import {
	getCurrentStudentWriteCampusAccess,
	StudentRepositoryError,
} from "./students";

type StudentStatus = NonNullable<(typeof student.$inferInsert)["status"]>;

const studentImportRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager", "consultant"]);
const studentExportRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager"]);
const eligibleOwnerRoles = new Set<
	(typeof organizationMember.$inferSelect)["role"]
>(["owner", "admin", "campus_manager", "consultant"]);

const STUDENT_IMPORT_HEADERS = [
	"姓名",
	"校区编码",
	"主要联系人姓名",
	"主要联系人手机号",
	"出生日期",
	"状态",
	"负责人邮箱",
	"已有标签",
] as const;

export const STUDENT_IMPORT_TEMPLATE = `${STUDENT_IMPORT_HEADERS.join(",")}\n张同学,CAMPUS-001,张家长,13800138000,2018-01-02,trial,consultant@example.com,重点学员|暑期班`;

export type StudentImportErrorCode =
	| "INVALID_ROW"
	| "FORMULA_VALUE"
	| "DUPLICATE_IN_FILE"
	| "DUPLICATE_EXISTING"
	| "DUPLICATE_RESTRICTED"
	| "CAMPUS_INVALID"
	| "OWNER_INVALID"
	| "TAG_INVALID";

export type StudentImportRowError = {
	row: number;
	code: StudentImportErrorCode;
	message: string;
	duplicateCandidate?: {
		id: string;
		name: string;
		phoneMasked: string;
	} | null;
};

export class StudentImportExportError extends Error {
	constructor(
		public readonly code:
			| "IMPORT_INVALID_CSV"
			| "IMPORT_LIMIT_EXCEEDED"
			| "IMPORT_IDEMPOTENCY_CONFLICT"
			| "MEMBER_FORBIDDEN"
			| "CAMPUS_OUT_OF_SCOPE",
	) {
		super(code);
		this.name = "StudentImportExportError";
	}
}

type ParsedStudentImportRow = {
	row: number;
	name: string;
	campusCode: string;
	primaryContactName: string;
	primaryContactPhone: string;
	phoneNormalized: string;
	birthDate: string | null;
	status: StudentStatus;
	ownerEmail: string | null;
	tagNames: string[];
};

type ResolvedStudentImportRow = ParsedStudentImportRow & {
	campusId: string;
	ownerUserId: string | null;
	tagIds: string[];
};

function maskPhone(phone: string): string {
	const compact = phone.replace(/[\s()（）-]/gu, "");
	if (compact.length < 5) return "***";
	return `${compact.slice(0, 3)}****${compact.slice(-4)}`;
}

function parseStatus(value: string): StudentStatus | null {
	const normalized = value || "trial";
	switch (normalized) {
		case "active":
		case "trial":
		case "paused":
		case "graduated":
			return normalized;
		case "atRisk":
			return "at_risk";
		default:
			return null;
	}
}

function isIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return (
		!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
	);
}

function normalizeTagName(value: string): string {
	return value.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function parseStudentImport(content: string): {
	rows: ParsedStudentImportRow[];
	errors: StudentImportRowError[];
} {
	let records: CsvRow[];
	try {
		records = parseCsvRecords(content.replace(/^\uFEFF/u, ""));
	} catch (error) {
		if (error instanceof CsvRepositoryError) {
			throw new StudentImportExportError(
				error.code === "LIMIT_EXCEEDED"
					? "IMPORT_LIMIT_EXCEEDED"
					: "IMPORT_INVALID_CSV",
			);
		}
		throw error;
	}
	const [header, ...data] = records;
	if (!header || data.length > MAX_IMPORT_ROWS) {
		throw new StudentImportExportError(
			data.length > MAX_IMPORT_ROWS
				? "IMPORT_LIMIT_EXCEEDED"
				: "IMPORT_INVALID_CSV",
		);
	}
	if (
		header.cells.length !== STUDENT_IMPORT_HEADERS.length ||
		header.cells.some(
			(value, index) => value !== STUDENT_IMPORT_HEADERS[index],
		) ||
		new Set(header.cells).size !== header.cells.length
	) {
		throw new StudentImportExportError("IMPORT_INVALID_CSV");
	}

	const rows: ParsedStudentImportRow[] = [];
	const errors: StudentImportRowError[] = [];
	for (const record of data) {
		if (
			record.cells.length > STUDENT_IMPORT_HEADERS.length ||
			record.cells.some(hasCsvFormulaPrefix)
		) {
			errors.push({
				row: record.row,
				code:
					record.cells.length > STUDENT_IMPORT_HEADERS.length
						? "INVALID_ROW"
						: "FORMULA_VALUE",
				message:
					record.cells.length > STUDENT_IMPORT_HEADERS.length
						? "列数超过模板定义。"
						: "字段不能以 =、+、- 或 @ 开头。",
			});
			continue;
		}
		const [
			name = "",
			campusCode = "",
			primaryContactName = "",
			primaryContactPhone = "",
			birthDateValue = "",
			statusValue = "",
			ownerEmailValue = "",
			tagValue = "",
		] = record.cells;
		const phoneNormalized = normalizeStudentPhone(primaryContactPhone);
		const status = parseStatus(statusValue);
		const ownerEmail = ownerEmailValue.toLocaleLowerCase("en-US") || null;
		const tagNames = tagValue
			.split("|")
			.map((value) => value.trim())
			.filter(Boolean);
		if (
			!name ||
			name.length > 50 ||
			!campusCode ||
			campusCode.length > 30 ||
			!primaryContactName ||
			primaryContactName.length > 50 ||
			primaryContactPhone.length > 30 ||
			!/^\d{5,20}$/u.test(phoneNormalized) ||
			(birthDateValue !== "" && !isIsoDate(birthDateValue)) ||
			!status ||
			(ownerEmail !== null &&
				(ownerEmail.length > 254 ||
					!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(ownerEmail))) ||
			tagNames.some((tagName) => tagName.length > 30) ||
			new Set(tagNames.map(normalizeTagName)).size !== tagNames.length
		) {
			errors.push({
				row: record.row,
				code: "INVALID_ROW",
				message: "必填值、日期、状态、手机号、邮箱或字段长度不符合要求。",
			});
			continue;
		}
		rows.push({
			row: record.row,
			name,
			campusCode,
			primaryContactName,
			primaryContactPhone,
			phoneNormalized,
			birthDate: birthDateValue || null,
			status,
			ownerEmail,
			tagNames,
		});
	}

	const counts = new Map<string, number>();
	for (const row of rows) {
		counts.set(row.phoneNormalized, (counts.get(row.phoneNormalized) ?? 0) + 1);
	}
	return {
		rows: rows.filter((row) => {
			if ((counts.get(row.phoneNormalized) ?? 0) === 1) return true;
			errors.push({
				row: row.row,
				code: "DUPLICATE_IN_FILE",
				message: "文件内主要联系人手机号重复。",
			});
			return false;
		}),
		errors,
	};
}

async function resolveStudentImport(
	tx: Transaction,
	input: {
		organizationId: string;
		campusAccess: CampusAccess;
		parsed: ReturnType<typeof parseStudentImport>;
	},
): Promise<{
	rows: ResolvedStudentImportRow[];
	errors: StudentImportRowError[];
}> {
	const campusCodes = [
		...new Set(input.parsed.rows.map((row) => row.campusCode)),
	];
	const ownerEmails = [
		...new Set(
			input.parsed.rows
				.map((row) => row.ownerEmail)
				.filter((value): value is string => value !== null),
		),
	];
	const tagNames = [
		...new Set(
			input.parsed.rows.flatMap((row) => row.tagNames.map(normalizeTagName)),
		),
	];
	const phones = [
		...new Set(input.parsed.rows.map((row) => row.phoneNormalized)),
	];

	const campuses =
		campusCodes.length === 0
			? []
			: await tx
					.select({
						id: campus.id,
						code: campus.code,
						isActive: campus.isActive,
					})
					.from(campus)
					.where(
						and(
							eq(campus.organizationId, input.organizationId),
							inArray(campus.code, campusCodes),
						),
					);
	const owners =
		ownerEmails.length === 0
			? []
			: await tx
					.select({
						memberId: organizationMember.id,
						userId: organizationMember.userId,
						email: user.email,
						role: organizationMember.role,
						campusAccessMode: organizationMember.campusAccessMode,
					})
					.from(organizationMember)
					.innerJoin(user, eq(user.id, organizationMember.userId))
					.where(
						and(
							eq(organizationMember.organizationId, input.organizationId),
							inArray(sql<string>`lower(${user.email})`, ownerEmails),
						),
					);
	const ownerScopes =
		owners.length === 0
			? []
			: await tx
					.select({
						memberId: organizationMemberCampus.organizationMemberId,
						campusId: organizationMemberCampus.campusId,
					})
					.from(organizationMemberCampus)
					.where(
						inArray(
							organizationMemberCampus.organizationMemberId,
							owners.map((owner) => owner.memberId),
						),
					);
	const tags =
		tagNames.length === 0
			? []
			: await tx
					.select({
						id: studentTag.id,
						nameNormalized: studentTag.nameNormalized,
					})
					.from(studentTag)
					.where(
						and(
							eq(studentTag.organizationId, input.organizationId),
							eq(studentTag.isActive, true),
							inArray(studentTag.nameNormalized, tagNames),
						),
					);
	const duplicates =
		phones.length === 0
			? []
			: await tx
					.select({
						id: student.id,
						name: student.name,
						campusId: student.campusId,
						guardianPhone: student.guardianPhone,
						guardianPhoneNormalized: student.guardianPhoneNormalized,
						contactPhoneNormalized: studentContact.phoneNormalized,
					})
					.from(student)
					.leftJoin(studentContact, eq(studentContact.studentId, student.id))
					.where(
						and(
							eq(student.organizationId, input.organizationId),
							isNull(student.mergedIntoStudentId),
							or(
								inArray(student.guardianPhoneNormalized, phones),
								inArray(studentContact.phoneNormalized, phones),
							),
						),
					);

	const campusByCode = new Map(campuses.map((item) => [item.code, item]));
	const ownerByEmail = new Map(
		owners.map((item) => [item.email.toLocaleLowerCase("en-US"), item]),
	);
	const scopesByMember = new Map<string, Set<string>>();
	for (const scope of ownerScopes) {
		const scopes = scopesByMember.get(scope.memberId) ?? new Set<string>();
		scopes.add(scope.campusId);
		scopesByMember.set(scope.memberId, scopes);
	}
	const tagByName = new Map(tags.map((item) => [item.nameNormalized, item.id]));
	const duplicateByPhone = new Map<string, (typeof duplicates)[number]>();
	for (const duplicate of duplicates) {
		for (const phone of [
			duplicate.guardianPhoneNormalized,
			duplicate.contactPhoneNormalized,
		]) {
			if (phone && phones.includes(phone) && !duplicateByPhone.has(phone)) {
				duplicateByPhone.set(phone, duplicate);
			}
		}
	}

	const rows: ResolvedStudentImportRow[] = [];
	const errors = [...input.parsed.errors];
	for (const row of input.parsed.rows) {
		const campusRecord = campusByCode.get(row.campusCode);
		if (!campusRecord) {
			errors.push({
				row: row.row,
				code: "CAMPUS_INVALID",
				message: "校区编码不存在、已停用或不在当前可访问范围。",
			});
			continue;
		}
		if (
			!campusRecord.isActive ||
			!isCampusAccessible(input.campusAccess, campusRecord.id)
		) {
			errors.push({
				row: row.row,
				code: "CAMPUS_INVALID",
				message: "校区编码不存在、已停用或不在当前可访问范围。",
			});
			continue;
		}

		let ownerUserId: string | null = null;
		if (row.ownerEmail) {
			const owner = ownerByEmail.get(row.ownerEmail);
			const organizationWide =
				owner?.role === "owner" ||
				owner?.role === "admin" ||
				owner?.campusAccessMode === "all";
			if (
				!owner ||
				!eligibleOwnerRoles.has(owner.role) ||
				(!organizationWide &&
					!scopesByMember.get(owner.memberId)?.has(campusRecord.id))
			) {
				errors.push({
					row: row.row,
					code: "OWNER_INVALID",
					message: "负责人不存在、角色不可用或无权负责该校区。",
				});
				continue;
			}
			ownerUserId = owner.userId;
		}

		const tagIds = row.tagNames.map((name) =>
			tagByName.get(normalizeTagName(name)),
		);
		if (tagIds.some((id) => id === undefined)) {
			errors.push({
				row: row.row,
				code: "TAG_INVALID",
				message: "标签不存在或已停用。",
			});
			continue;
		}

		const duplicate = duplicateByPhone.get(row.phoneNormalized);
		if (duplicate) {
			const visible = isCampusAccessible(
				input.campusAccess,
				duplicate.campusId,
			);
			errors.push({
				row: row.row,
				code: visible ? "DUPLICATE_EXISTING" : "DUPLICATE_RESTRICTED",
				message: visible
					? "手机号已存在于当前机构学员档案。"
					: "手机号已存在于当前机构其他受限档案。",
				duplicateCandidate: visible
					? {
							id: duplicate.id,
							name: duplicate.name,
							phoneMasked: maskPhone(duplicate.guardianPhone),
						}
					: null,
			});
			continue;
		}

		rows.push({
			...row,
			campusId: campusRecord.id,
			ownerUserId,
			tagIds: tagIds as string[],
		});
	}
	return { rows, errors: errors.sort((left, right) => left.row - right.row) };
}

function createImportHash(input: { userId: string; content: string }): string {
	return createHash("sha256")
		.update(JSON.stringify(input), "utf8")
		.digest("hex");
}

export async function previewStudentImportRecord(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	content: string;
}) {
	const parsed = parseStudentImport(input.content);
	const resolved = await db.transaction((tx) =>
		resolveStudentImport(tx, { ...input, parsed }),
	);
	return {
		totalRows: parsed.rows.length + parsed.errors.length,
		validRows: resolved.rows.length,
		errors: resolved.errors,
	};
}

export async function confirmStudentImportRecord(input: {
	organizationId: string;
	userId: string;
	requestId: string;
	content: string;
}) {
	const parsed = parseStudentImport(input.content);
	const inputHash = createImportHash({
		userId: input.userId,
		content: input.content,
	});
	try {
		return await db.transaction(async (tx) => {
			const [createdBatch] = await tx
				.insert(studentImportBatch)
				.values({
					organizationId: input.organizationId,
					requestId: input.requestId,
					inputHash,
					createdByUserId: input.userId,
					totalRows: parsed.rows.length + parsed.errors.length,
					importedRows: 0,
					errorRows: parsed.errors.length,
					errors: parsed.errors,
				})
				.onConflictDoNothing()
				.returning({ id: studentImportBatch.id });
			if (!createdBatch) {
				const [existing] = await tx
					.select()
					.from(studentImportBatch)
					.where(
						and(
							eq(studentImportBatch.organizationId, input.organizationId),
							eq(studentImportBatch.requestId, input.requestId),
						),
					)
					.limit(1);
				if (!existing) throw new Error("Student import batch disappeared.");
				if (existing.inputHash !== inputHash) {
					throw new StudentImportExportError("IMPORT_IDEMPOTENCY_CONFLICT");
				}
				return {
					batchId: existing.id,
					importedRows: existing.importedRows,
					errorRows: existing.errorRows,
					errors: existing.errors as StudentImportRowError[],
					replayed: true,
				};
			}

			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentImportRoles,
			});
			await lockStudentPhonesInTransaction(tx, {
				organizationId: input.organizationId,
				normalizedPhones: parsed.rows.map((row) => row.phoneNormalized),
			});
			const resolved = await resolveStudentImport(tx, {
				organizationId: input.organizationId,
				campusAccess,
				parsed,
			});
			const studentIds: string[] = [];
			for (const row of resolved.rows) {
				const [created] = await tx
					.insert(student)
					.values({
						organizationId: input.organizationId,
						campusId: row.campusId,
						ownerUserId: row.ownerUserId,
						name: row.name,
						birthDate: row.birthDate,
						status: row.status,
						guardianName: row.primaryContactName,
						guardianPhone: row.primaryContactPhone,
						guardianPhoneNormalized: row.phoneNormalized,
					})
					.returning({ id: student.id });
				if (!created) throw new Error("Student import insert returned no row.");
				studentIds.push(created.id);
				await tx.insert(studentContact).values({
					studentId: created.id,
					name: row.primaryContactName,
					phone: row.primaryContactPhone,
					phoneNormalized: row.phoneNormalized,
					isPrimary: true,
				});
				if (row.tagIds.length > 0) {
					await tx.insert(studentTagAssignment).values(
						row.tagIds.map((studentTagId) => ({
							studentId: created.id,
							studentTagId,
						})),
					);
				}
				if (row.ownerUserId) {
					await tx.insert(studentOwnerAssignmentEvent).values({
						organizationId: input.organizationId,
						studentId: created.id,
						campusId: row.campusId,
						beforeOwnerUserId: null,
						afterOwnerUserId: row.ownerUserId,
						operatorUserId: input.userId,
						source: "import",
						batchId: createdBatch.id,
					});
				}
			}

			await tx
				.update(studentImportBatch)
				.set({
					importedRows: studentIds.length,
					errorRows: resolved.errors.length,
					errors: resolved.errors,
				})
				.where(eq(studentImportBatch.id, createdBatch.id));
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "student_imported",
				entityType: "student_import_batch",
				entityId: createdBatch.id,
				actorUserId: input.userId,
				after: {
					requestId: input.requestId,
					importedRows: studentIds.length,
					errorRows: resolved.errors.length,
					studentIds,
				},
			});
			return {
				batchId: createdBatch.id,
				importedRows: studentIds.length,
				errorRows: resolved.errors.length,
				errors: resolved.errors,
				replayed: false,
			};
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new StudentImportExportError(
				error.code === "CAMPUS_OUT_OF_SCOPE"
					? "CAMPUS_OUT_OF_SCOPE"
					: "MEMBER_FORBIDDEN",
			);
		}
		throw error;
	}
}

export type StudentExportRecord = {
	id: string;
	name: string;
	campusCode: string;
	campusName: string;
	birthDate: string | null;
	status: StudentStatus;
	ownerName: string | null;
	ownerEmail: string | null;
	primaryContactName: string;
	primaryContactPhone: string;
	tagNames: string[];
	createdAt: Date;
	updatedAt: Date;
};

export async function exportStudentRecords(input: {
	organizationId: string;
	userId: string;
	query?: string;
	campusId?: string;
	status?: StudentStatus;
	tagId?: string;
	ownerUserId?: string | null;
	limit: number;
}): Promise<StudentExportRecord[]> {
	try {
		return await db.transaction(async (tx) => {
			const campusAccess = await getCurrentStudentWriteCampusAccess(tx, {
				organizationId: input.organizationId,
				userId: input.userId,
				allowedRoles: studentExportRoles,
			});
			if (input.campusId && !isCampusAccessible(campusAccess, input.campusId)) {
				throw new StudentImportExportError("CAMPUS_OUT_OF_SCOPE");
			}
			const filters = [
				eq(student.organizationId, input.organizationId),
				isNull(student.mergedIntoStudentId),
				campusAccessCondition(student.campusId, campusAccess),
			];
			if (input.campusId) filters.push(eq(student.campusId, input.campusId));
			if (input.status) filters.push(eq(student.status, input.status));
			if (input.ownerUserId === null) filters.push(isNull(student.ownerUserId));
			else if (input.ownerUserId) {
				filters.push(eq(student.ownerUserId, input.ownerUserId));
			}
			if (input.tagId) {
				filters.push(sql<boolean>`exists (
					select 1 from "student_tag_assignment"
					where "student_tag_assignment"."student_id" = ${student.id}
						and "student_tag_assignment"."student_tag_id" = ${input.tagId}
				)`);
			}
			if (input.query) {
				const pattern = escapedContains(input.query);
				filters.push(sql<boolean>`(
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

			const rows = await tx
				.select({
					id: student.id,
					name: student.name,
					campusCode: campus.code,
					campusName: campus.name,
					birthDate: student.birthDate,
					status: student.status,
					ownerName: user.name,
					ownerEmail: user.email,
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
				.leftJoin(user, eq(user.id, student.ownerUserId))
				.innerJoin(
					studentContact,
					and(
						eq(studentContact.studentId, student.id),
						eq(studentContact.isPrimary, true),
					),
				)
				.where(and(...filters))
				.orderBy(asc(student.name), asc(student.id))
				.limit(input.limit);
			const tagRows =
				rows.length === 0
					? []
					: await tx
							.select({
								studentId: studentTagAssignment.studentId,
								name: studentTag.name,
							})
							.from(studentTagAssignment)
							.innerJoin(
								studentTag,
								eq(studentTag.id, studentTagAssignment.studentTagId),
							)
							.where(
								inArray(
									studentTagAssignment.studentId,
									rows.map((row) => row.id),
								),
							)
							.orderBy(asc(studentTag.name), asc(studentTag.id));
			const tagsByStudent = new Map<string, string[]>();
			for (const tag of tagRows) {
				const names = tagsByStudent.get(tag.studentId) ?? [];
				names.push(tag.name);
				tagsByStudent.set(tag.studentId, names);
			}
			await writeOrganizationAuditEvent(tx, {
				organizationId: input.organizationId,
				action: "student_exported",
				entityType: "student_export",
				entityId: crypto.randomUUID(),
				actorUserId: input.userId,
				after: {
					resultCount: rows.length,
					filters: {
						campusId: input.campusId ?? null,
						status: input.status ?? null,
						tagId: input.tagId ?? null,
						ownerUserId: input.ownerUserId ?? null,
						queryApplied: Boolean(input.query),
					},
				},
			});
			return rows.map((row) => ({
				...row,
				tagNames: tagsByStudent.get(row.id) ?? [],
			}));
		});
	} catch (error) {
		if (error instanceof StudentRepositoryError) {
			throw new StudentImportExportError("MEMBER_FORBIDDEN");
		}
		throw error;
	}
}
