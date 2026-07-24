import { Buffer } from "node:buffer";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../index";
import { student } from "../schema";
import { isCampusAccessible } from "./campus-access";
import type { CampusAccess } from "./organization";
import { StudentRepositoryError } from "./students";

export type StudentTimelineKind =
	| "enrollment_created"
	| "enrollment_lifecycle"
	| "invoice_issued"
	| "payment_received"
	| "enrollment_renewed"
	| "enrollment_transferred"
	| "refund_created"
	| "attendance_recorded"
	| "lesson_consumed"
	| "student_status_changed";

export type StudentTimelineRecord = {
	id: string;
	kind: StudentTimelineKind;
	sourceId: string;
	occurredAt: Date;
	recordedAt: Date | null;
	actorName: string | null;
	courseName: string | null;
	className: string | null;
	invoiceSummary: string | null;
	invoiceSource: "enrollment" | "renewal" | "manual" | null;
	invoiceId: string | null;
	lessonId: string | null;
	amountInCents: number | null;
	lessonCount: number | null;
	previousRemainingLessons: number | null;
	remainingLessons: number | null;
	status: string | null;
	beforeStatus: string | null;
	afterStatus: string | null;
};

type TimelineCursor = {
	occurredAt: string;
	kindRank: number;
	sourceId: string;
};

const uuidSchema = z.uuid();
const cursorSchema = z.object({
	occurredAt: z.iso.datetime({ offset: true }),
	kindRank: z.number().int().min(0).max(200),
	sourceId: uuidSchema,
});
const nullableDateSchema = z.preprocess(
	(value) => (value === null ? null : value),
	z.coerce.date().nullable(),
);
const timelineRowSchema = z.object({
	kind: z.enum([
		"enrollment_created",
		"enrollment_lifecycle",
		"invoice_issued",
		"payment_received",
		"enrollment_renewed",
		"enrollment_transferred",
		"refund_created",
		"attendance_recorded",
		"lesson_consumed",
		"student_status_changed",
	]),
	kindRank: z.coerce.number().int(),
	sourceId: uuidSchema,
	occurredAt: z.coerce.date(),
	recordedAt: nullableDateSchema,
	actorName: z.string().nullable(),
	courseName: z.string().nullable(),
	className: z.string().nullable(),
	invoiceSummary: z.string().nullable(),
	invoiceSource: z.enum(["enrollment", "renewal", "manual"]).nullable(),
	invoiceId: uuidSchema.nullable(),
	lessonId: uuidSchema.nullable(),
	amountInCents: z.coerce.number().int().nullable(),
	lessonCount: z.coerce.number().int().nullable(),
	previousRemainingLessons: z.coerce.number().int().nullable(),
	remainingLessons: z.coerce.number().int().nullable(),
	status: z.string().nullable(),
	beforeStatus: z.string().nullable(),
	afterStatus: z.string().nullable(),
});

function encodeCursor(cursor: TimelineCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value?: string): TimelineCursor | null {
	if (!value) return null;
	try {
		return cursorSchema.parse(
			JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
		);
	} catch {
		throw new StudentRepositoryError("INVALID_CURSOR");
	}
}

export async function listStudentTimelineRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	studentId: string;
	includeFinancial: boolean;
	cursor?: string;
	pageSize: number;
}): Promise<{
	items: StudentTimelineRecord[];
	nextCursor: string | null;
}> {
	const [studentScope] = await db
		.select({ campusId: student.campusId })
		.from(student)
		.where(
			and(
				eq(student.id, input.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!studentScope) throw new StudentRepositoryError("STUDENT_NOT_FOUND");
	if (!isCampusAccessible(input.campusAccess, studentScope.campusId)) {
		throw new StudentRepositoryError("CAMPUS_OUT_OF_SCOPE");
	}

	const cursor = decodeCursor(input.cursor);
	const financialPredicate = input.includeFinancial ? sql`true` : sql`false`;
	const cursorPredicate = cursor
		? sql`where (occurred_at, kind_rank, source_id) < (${new Date(
				cursor.occurredAt,
			)}, ${cursor.kindRank}, ${cursor.sourceId}::uuid)`
		: sql``;
	const result = await db.execute(sql`
		with timeline as (
			select
				'enrollment_created'::text as kind,
				20::integer as kind_rank,
				e.id as source_id,
				e.enrolled_at as occurred_at,
				er.created_at as recorded_at,
				u.name as actor_name,
				c.name as course_name,
				cg.name as class_name,
				null::text as invoice_summary,
				null::text as invoice_source,
				case when ${financialPredicate} then er.invoice_id else null::uuid end as invoice_id,
				null::uuid as lesson_id,
				case when ${financialPredicate} then e.amount_in_cents else null::integer end as amount_in_cents,
				e.purchased_lessons as lesson_count,
				null::integer as previous_remaining_lessons,
				e.remaining_lessons as remaining_lessons,
				e.status::text as status,
				null::text as before_status,
				null::text as after_status
			from enrollment e
			join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			left join class_group cg on cg.id = e.class_group_id and cg.organization_id = ${input.organizationId}::uuid
			left join enrollment_registration er on er.enrollment_id = e.id and er.organization_id = ${input.organizationId}::uuid
			left join "user" u on u.id = er.operator_user_id
			where e.organization_id = ${input.organizationId}::uuid and e.student_id = ${input.studentId}::uuid

			union all
			select
				'enrollment_lifecycle', 80, ele.id, ele.effective_at, ele.created_at,
				u.name, c.name, coalesce(to_cg.name, from_cg.name), null::text, null::text,
				null::uuid, null::uuid,
				null::integer, null::integer, null::integer, e.remaining_lessons,
				ele.kind::text, ele.before_status::text, ele.after_status::text
			from enrollment_lifecycle_event ele
			join enrollment e on e.id = ele.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			left join class_group from_cg on from_cg.id = ele.from_class_group_id
			left join class_group to_cg on to_cg.id = ele.to_class_group_id
			left join "user" u on u.id = ele.operator_user_id
			where ele.organization_id = ${input.organizationId}::uuid and e.student_id = ${input.studentId}::uuid

			union all
			select
				'invoice_issued', 30, i.id, i.issued_at, i.issued_at, null::text,
				c.name, null::text, i.summary, i.source::text, i.id, null::uuid, i.amount_in_cents,
				null::integer, null::integer, null::integer, i.status::text, null::text, null::text
			from invoice i
			left join enrollment e on e.id = i.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			left join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			where ${financialPredicate} and i.organization_id = ${input.organizationId}::uuid and i.student_id = ${input.studentId}::uuid

			union all
			select
				'payment_received', 60, p.id, p.received_at, p.created_at, p.operator_name,
				c.name, null::text, i.summary, i.source::text, p.invoice_id, null::uuid, p.amount_in_cents,
				null::integer, null::integer, null::integer, p.method::text, null::text, null::text
			from payment p
			join invoice i on i.id = p.invoice_id and i.organization_id = ${input.organizationId}::uuid
			left join enrollment e on e.id = i.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			left join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			where ${financialPredicate} and p.organization_id = ${input.organizationId}::uuid and i.student_id = ${input.studentId}::uuid

			union all
			select
				'enrollment_renewed', 50, er.id, er.created_at, er.created_at, u.name,
				c.name, null::text, null::text, null::text, er.invoice_id, null::uuid, er.amount_in_cents,
				er.added_lessons, null::integer, e.remaining_lessons, null::text, null::text, null::text
			from enrollment_renewal er
			join enrollment e on e.id = er.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			left join "user" u on u.id = er.operator_user_id
			where ${financialPredicate} and er.organization_id = ${input.organizationId}::uuid and e.student_id = ${input.studentId}::uuid

			union all
			select
				'enrollment_transferred', 40, et.id, et.created_at, et.created_at, u.name,
				source_course.name || ' → ' || target_course.name, null::text,
				null::text, null::text, null::uuid, null::uuid,
				null::integer, et.transferred_lessons, null::integer, null::integer,
				null::text, null::text, null::text
			from enrollment_transfer et
			join enrollment source_e on source_e.id = et.source_enrollment_id and source_e.organization_id = ${input.organizationId}::uuid
			join course source_course on source_course.id = source_e.course_id and source_course.organization_id = ${input.organizationId}::uuid
			join course target_course on target_course.id = et.target_course_id and target_course.organization_id = ${input.organizationId}::uuid
			left join "user" u on u.id = et.operator_user_id
			where ${financialPredicate} and et.organization_id = ${input.organizationId}::uuid and source_e.student_id = ${input.studentId}::uuid

			union all
			select
				'refund_created', 70, r.id, r.refunded_at, r.created_at, r.operator_name,
				c.name, null::text, i.summary, i.source::text, r.invoice_id, null::uuid, r.amount_in_cents,
				null::integer, null::integer, null::integer, r.method::text, null::text, null::text
			from refund r
			join invoice i on i.id = r.invoice_id and i.organization_id = ${input.organizationId}::uuid
			left join enrollment e on e.id = i.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			left join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			where ${financialPredicate} and r.organization_id = ${input.organizationId}::uuid and i.student_id = ${input.studentId}::uuid

			union all
			select
				'attendance_recorded', 90, a.id, l.starts_at, a.updated_at, u.name,
				c.name, cg.name, null::text, null::text, null::uuid, l.id, null::integer,
				null::integer, null::integer, null::integer, a.status::text, null::text, null::text
			from attendance a
			join lesson l on l.id = a.lesson_id and l.organization_id = ${input.organizationId}::uuid
			join class_group cg on cg.id = l.class_group_id and cg.organization_id = ${input.organizationId}::uuid
			join course c on c.id = cg.course_id and c.organization_id = ${input.organizationId}::uuid
			left join "user" u on u.id = a.recorded_by_user_id
			where a.student_id = ${input.studentId}::uuid

			union all
			select
				'lesson_consumed', 100, lc.id, l.starts_at, lc.consumed_at, u.name,
				c.name, cg.name, null::text, null::text, null::uuid, l.id, null::integer,
				1, lc.previous_remaining_lessons, lc.remaining_lessons,
				lc.attendance_status::text, null::text, null::text
			from lesson_consumption lc
			join enrollment e on e.id = lc.enrollment_id and e.organization_id = ${input.organizationId}::uuid
			join lesson l on l.id = lc.lesson_id and l.organization_id = ${input.organizationId}::uuid
			join class_group cg on cg.id = l.class_group_id and cg.organization_id = ${input.organizationId}::uuid
			join course c on c.id = e.course_id and c.organization_id = ${input.organizationId}::uuid
			left join "user" u on u.id = lc.consumed_by_user_id
			where lc.organization_id = ${input.organizationId}::uuid and e.student_id = ${input.studentId}::uuid

			union all
			select
				'student_status_changed', 110, sse.id, sse.occurred_at, sse.occurred_at,
				u.name, null::text, null::text, null::text, null::text,
				null::uuid, null::uuid, null::integer,
				null::integer, null::integer, null::integer, null::text,
				sse.before_status::text, sse.after_status::text
			from student_status_event sse
			left join "user" u on u.id = sse.operator_user_id
			where sse.organization_id = ${input.organizationId}::uuid and sse.student_id = ${input.studentId}::uuid
		)
		select
			kind,
			kind_rank as "kindRank",
			source_id as "sourceId",
			occurred_at as "occurredAt",
			recorded_at as "recordedAt",
			actor_name as "actorName",
			course_name as "courseName",
			class_name as "className",
			invoice_summary as "invoiceSummary",
			invoice_source as "invoiceSource",
			invoice_id as "invoiceId",
			lesson_id as "lessonId",
			amount_in_cents as "amountInCents",
			lesson_count as "lessonCount",
			previous_remaining_lessons as "previousRemainingLessons",
			remaining_lessons as "remainingLessons",
			status,
			before_status as "beforeStatus",
			after_status as "afterStatus"
		from timeline
		${cursorPredicate}
		order by occurred_at desc, kind_rank desc, source_id desc
		limit ${input.pageSize + 1}
	`);
	const rows = z.array(timelineRowSchema).parse(result.rows);
	const pageRows = rows.slice(0, input.pageSize);
	const last = pageRows.at(-1);
	return {
		items: pageRows.map(({ kindRank: _kindRank, ...row }) => ({
			...row,
			id: `${row.kind}:${row.sourceId}`,
		})),
		nextCursor:
			rows.length > input.pageSize && last
				? encodeCursor({
						occurredAt: last.occurredAt.toISOString(),
						kindRank: last.kindRank,
						sourceId: last.sourceId,
					})
				: null,
	};
}
