import {
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	ne,
	or,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "../index";
import {
	campus,
	classGroup,
	course,
	invoice,
	lead,
	lesson,
	receiptDocument,
	student,
	studentContact,
	teacher,
} from "../schema";
import type { CampusAccess } from "./organization";

export const globalSearchKinds = [
	"lead",
	"student",
	"course",
	"class",
	"lesson",
	"invoice",
	"receipt",
] as const;
export type GlobalSearchKind = (typeof globalSearchKinds)[number];

export type GlobalSearchRecord = {
	readonly kind: GlobalSearchKind;
	readonly id: string;
	readonly title: string;
	readonly subtitle: string | null;
	readonly invoiceId?: string;
};

type SearchInput = {
	organizationId: string;
	userId: string;
	campusAccess: CampusAccess;
	kinds: readonly GlobalSearchKind[];
	query: string;
};

const perKindLimit = 6;

function escapedContains(query: string): string {
	return `%${query.replace(/[\\%_]/gu, "\\$&")}%`;
}

function maskedPhone(phone: string | null): string | null {
	if (!phone) return null;
	const compact = phone.replace(/\s/gu, "");
	if (compact.length <= 4) return "****";
	return `${compact.slice(0, 3)}****${compact.slice(-4)}`;
}

function campusCondition(column: AnyPgColumn, access: CampusAccess) {
	if (access.kind === "all") return undefined;
	if (access.kind === "none") return sql`false`;
	return access.campusIds.length > 0
		? inArray(column, access.campusIds)
		: sql`false`;
}

function rank(column: SQLWrapper, query: string) {
	return sql<number>`case when lower(${column}) = lower(${query}) then 0 when lower(${column}) like lower(${`${query}%`}) then 1 else 2 end`;
}

async function searchLeads(input: SearchInput): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const rows = await db
		.select({
			id: lead.id,
			name: lead.name,
			phone: lead.phone,
			campusName: campus.name,
		})
		.from(lead)
		.leftJoin(campus, eq(campus.id, lead.campusId))
		.where(
			and(
				eq(lead.organizationId, input.organizationId),
				ne(lead.stage, "enrolled"),
				campusCondition(lead.campusId, input.campusAccess),
				or(
					ilike(lead.name, query),
					ilike(lead.phone, query),
					ilike(lead.source, query),
				),
			),
		)
		.orderBy(
			asc(rank(lead.name, input.query)),
			desc(lead.updatedAt),
			asc(lead.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "lead",
		id: row.id,
		title: row.name,
		subtitle:
			[row.campusName, maskedPhone(row.phone)].filter(Boolean).join(" · ") ||
			null,
	}));
}

async function searchStudents(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const contactMatch = sql<boolean>`exists (select 1 from student_contact as search_contact where search_contact.student_id = ${student.id} and (search_contact.name ilike ${query} or search_contact.phone ilike ${query} or search_contact.phone_normalized ilike ${query}))`;
	const rows = await db
		.select({
			id: student.id,
			name: student.name,
			campusName: campus.name,
			contactName: studentContact.name,
			phone: studentContact.phone,
		})
		.from(student)
		.leftJoin(campus, eq(campus.id, student.campusId))
		.leftJoin(
			studentContact,
			and(
				eq(studentContact.studentId, student.id),
				eq(studentContact.isPrimary, true),
			),
		)
		.where(
			and(
				eq(student.organizationId, input.organizationId),
				sql`${student.mergedIntoStudentId} is null`,
				campusCondition(student.campusId, input.campusAccess),
				or(ilike(student.name, query), contactMatch),
			),
		)
		.orderBy(
			asc(rank(student.name, input.query)),
			desc(student.updatedAt),
			asc(student.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "student",
		id: row.id,
		title: row.name,
		subtitle:
			[row.campusName, row.contactName, maskedPhone(row.phone)]
				.filter(Boolean)
				.join(" · ") || null,
	}));
}

async function searchCourses(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const rows = await db
		.select({ id: course.id, name: course.name, code: course.code })
		.from(course)
		.where(
			and(
				eq(course.organizationId, input.organizationId),
				or(ilike(course.name, query), ilike(course.code, query)),
			),
		)
		.orderBy(
			asc(rank(course.name, input.query)),
			desc(course.updatedAt),
			asc(course.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "course",
		id: row.id,
		title: row.name,
		subtitle: row.code,
	}));
}

async function searchClasses(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const rows = await db
		.select({
			id: classGroup.id,
			name: classGroup.name,
			courseName: course.name,
			campusName: campus.name,
		})
		.from(classGroup)
		.innerJoin(course, eq(course.id, classGroup.courseId))
		.innerJoin(campus, eq(campus.id, classGroup.campusId))
		.where(
			and(
				eq(classGroup.organizationId, input.organizationId),
				campusCondition(classGroup.campusId, input.campusAccess),
				or(ilike(classGroup.name, query), ilike(course.name, query)),
			),
		)
		.orderBy(
			asc(rank(classGroup.name, input.query)),
			desc(classGroup.updatedAt),
			asc(classGroup.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "class",
		id: row.id,
		title: row.name,
		subtitle: `${row.courseName} · ${row.campusName}`,
	}));
}

async function searchLessons(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const teacherFilter =
		input.kinds.length === 1 && input.kinds[0] === "lesson"
			? eq(teacher.userId, input.userId)
			: undefined;
	const rows = await db
		.select({
			id: lesson.id,
			className: classGroup.name,
			room: lesson.room,
			startsAt: lesson.startsAt,
		})
		.from(lesson)
		.innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
		.innerJoin(teacher, eq(teacher.id, lesson.teacherId))
		.where(
			and(
				eq(lesson.organizationId, input.organizationId),
				campusCondition(lesson.campusId, input.campusAccess),
				teacherFilter,
				or(ilike(classGroup.name, query), ilike(lesson.room, query)),
			),
		)
		.orderBy(
			asc(rank(classGroup.name, input.query)),
			desc(lesson.startsAt),
			asc(lesson.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "lesson",
		id: row.id,
		title: row.className,
		subtitle: `${row.startsAt.toISOString()} · ${row.room}`,
	}));
}

async function searchInvoices(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const rows = await db
		.select({
			id: invoice.id,
			summary: invoice.summary,
			studentName: student.name,
			campusName: campus.name,
		})
		.from(invoice)
		.innerJoin(student, eq(student.id, invoice.studentId))
		.innerJoin(campus, eq(campus.id, student.campusId))
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				campusCondition(student.campusId, input.campusAccess),
				or(ilike(invoice.summary, query), ilike(student.name, query)),
			),
		)
		.orderBy(
			asc(rank(invoice.summary, input.query)),
			desc(invoice.issuedAt),
			asc(invoice.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "invoice",
		id: row.id,
		title: row.summary,
		subtitle: `${row.studentName} · ${row.campusName}`,
	}));
}

async function searchReceipts(
	input: SearchInput,
): Promise<GlobalSearchRecord[]> {
	const query = escapedContains(input.query);
	const rows = await db
		.select({
			id: receiptDocument.id,
			invoiceId: receiptDocument.invoiceId,
			number: receiptDocument.number,
			studentName: receiptDocument.studentName,
			campusName: receiptDocument.campusName,
		})
		.from(receiptDocument)
		.where(
			and(
				eq(receiptDocument.organizationId, input.organizationId),
				campusCondition(receiptDocument.campusId, input.campusAccess),
				or(
					ilike(receiptDocument.number, query),
					ilike(receiptDocument.studentName, query),
					ilike(receiptDocument.invoiceSummary, query),
				),
			),
		)
		.orderBy(
			asc(rank(receiptDocument.number, input.query)),
			desc(receiptDocument.generatedAt),
			asc(receiptDocument.id),
		)
		.limit(perKindLimit);
	return rows.map((row) => ({
		kind: "receipt",
		id: row.id,
		invoiceId: row.invoiceId,
		title: row.number,
		subtitle: `${row.studentName} · ${row.campusName}`,
	}));
}

export async function searchGlobalRecords(input: SearchInput): Promise<
	Array<{
		kind: GlobalSearchKind;
		items: GlobalSearchRecord[];
		hasMore: boolean;
	}>
> {
	const handlers: Record<
		GlobalSearchKind,
		() => Promise<GlobalSearchRecord[]>
	> = {
		lead: () => searchLeads(input),
		student: () => searchStudents(input),
		course: () => searchCourses(input),
		class: () => searchClasses(input),
		lesson: () => searchLessons(input),
		invoice: () => searchInvoices(input),
		receipt: () => searchReceipts(input),
	};
	const results = await Promise.all(
		input.kinds.map(async (kind) => ({ kind, rows: await handlers[kind]() })),
	);
	return results
		.map(({ kind, rows }) => ({
			kind,
			items: rows.slice(0, 5),
			hasMore: rows.length > 5,
		}))
		.filter((group) => group.items.length > 0);
}
