import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	ne,
	sql,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	classGroup,
	course,
	enrollment,
	invoice,
	lead,
	lesson,
	operationTask,
	organizationMember,
	student,
	teacher,
	user,
} from "../schema";

export type DashboardLeadSummaryRow = {
	id: string;
	name: string;
	stage: "new" | "contacted" | "trial_booked";
	interestedCourse: string | null;
	nextFollowAt: Date | null;
};

export type DashboardTaskSummaryRow = {
	id: string;
	title: string;
	module: (typeof operationTask.$inferSelect)["module"];
	owner: string | null;
	dueAt: Date;
	priority: (typeof operationTask.$inferSelect)["priority"];
};

export type DashboardLessonSummaryRow = {
	id: string;
	className: string;
	courseName: string;
	campusName: string;
	teacherName: string;
	room: string;
	startsAt: Date;
	endsAt: Date;
};

export type DashboardReceivableSummaryRow = {
	id: string;
	studentName: string;
	courseName: string | null;
	outstandingAmountInCents: number;
	status: "pending" | "overdue";
	isPastDue: boolean;
	dueDate: string;
};

export type GetDashboardLeadSummaryInput = {
	organizationId: string;
	now: Date;
	nextDayStart: Date;
};

export type GetDashboardTaskSummaryInput = {
	organizationId: string;
	now: Date;
	nextDayStart: Date;
	ownerUserId?: string;
};

export type GetDashboardLessonSummaryInput = {
	organizationId: string;
	now: Date;
	windowEnd: Date;
	teacherUserId?: string;
};

export type GetDashboardReceivableSummaryInput = {
	organizationId: string;
	today: string;
};

export type GetDashboardLearningSummaryInput = {
	organizationId: string;
};

export type DashboardLearningSummary = {
	studentCount: number;
	enrollmentCount: number;
	activeClassCount: number;
};

const windowTotal = sql<number>`count(*) over()`;

function toDashboardLeadStage(
	stage: (typeof lead.$inferSelect)["stage"],
): DashboardLeadSummaryRow["stage"] {
	switch (stage) {
		case "new":
		case "contacted":
		case "trial_booked":
			return stage;
		case "enrolled":
		case "lost":
			throw new Error("Dashboard lead query returned a closed lead.");
	}
}

function toDashboardReceivableStatus(
	status: (typeof invoice.$inferSelect)["status"],
): DashboardReceivableSummaryRow["status"] {
	if (status === "pending" || status === "overdue") {
		return status;
	}

	throw new Error("Dashboard receivable query returned a settled invoice.");
}

export async function getDashboardLeadSummary(
	input: GetDashboardLeadSummaryInput,
): Promise<{ total: number; items: DashboardLeadSummaryRow[] }> {
	const followUpBucket = sql<number>`
		case
			when ${lead.nextFollowAt} < ${input.now} then 0
			when ${lead.nextFollowAt} is null then 1
			when ${lead.nextFollowAt} < ${input.nextDayStart} then 2
			else 3
		end
	`;
	const rows = await db
		.select({
			id: lead.id,
			name: lead.name,
			stage: lead.stage,
			interestedCourse: course.name,
			nextFollowAt: lead.nextFollowAt,
			total: windowTotal.mapWith(Number),
		})
		.from(lead)
		.leftJoin(
			course,
			and(
				eq(course.id, lead.interestedCourseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(lead.organizationId, input.organizationId),
				ne(lead.stage, "enrolled"),
				ne(lead.stage, "lost"),
			),
		)
		.orderBy(
			asc(followUpBucket),
			asc(lead.nextFollowAt),
			desc(lead.updatedAt),
			asc(lead.id),
		)
		.limit(5);

	return {
		total: rows[0]?.total ?? 0,
		items: rows.map((row) => ({
			id: row.id,
			name: row.name,
			stage: toDashboardLeadStage(row.stage),
			interestedCourse: row.interestedCourse,
			nextFollowAt: row.nextFollowAt,
		})),
	};
}

export async function getDashboardTaskSummary(
	input: GetDashboardTaskSummaryInput,
): Promise<{ total: number; items: DashboardTaskSummaryRow[] }> {
	const dueOrder = sql<number>`
		case when ${operationTask.dueAt} < ${input.now} then 0 else 1 end
	`;
	const priorityOrder = sql<number>`
		case ${operationTask.priority}
			when 'high' then 0
			when 'medium' then 1
			else 2
		end
	`;
	const filters = [
		eq(operationTask.organizationId, input.organizationId),
		isNull(operationTask.completedAt),
		lt(operationTask.dueAt, input.nextDayStart),
	];

	if (input.ownerUserId !== undefined) {
		filters.push(eq(operationTask.ownerUserId, input.ownerUserId));
	}

	const rows = await db
		.select({
			id: operationTask.id,
			title: operationTask.title,
			module: operationTask.module,
			owner: user.name,
			dueAt: operationTask.dueAt,
			priority: operationTask.priority,
			total: windowTotal.mapWith(Number),
		})
		.from(operationTask)
		.leftJoin(
			organizationMember,
			and(
				eq(organizationMember.userId, operationTask.ownerUserId),
				eq(organizationMember.organizationId, input.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, organizationMember.userId))
		.where(and(...filters))
		.orderBy(
			asc(dueOrder),
			asc(priorityOrder),
			asc(operationTask.dueAt),
			asc(operationTask.id),
		)
		.limit(5);

	return {
		total: rows[0]?.total ?? 0,
		items: rows.map((row) => ({
			id: row.id,
			title: row.title,
			module: row.module,
			owner: row.owner,
			dueAt: row.dueAt,
			priority: row.priority,
		})),
	};
}

export async function getDashboardLessonSummary(
	input: GetDashboardLessonSummaryInput,
): Promise<{ total: number; items: DashboardLessonSummaryRow[] }> {
	const filters = [
		eq(lesson.organizationId, input.organizationId),
		eq(lesson.status, "scheduled"),
		gte(lesson.startsAt, input.now),
		lt(lesson.startsAt, input.windowEnd),
	];

	if (input.teacherUserId !== undefined) {
		filters.push(eq(teacher.userId, input.teacherUserId));
	}

	const rows = await db
		.select({
			id: lesson.id,
			className: classGroup.name,
			courseName: course.name,
			campusName: campus.name,
			teacherName: teacher.name,
			room: lesson.room,
			startsAt: lesson.startsAt,
			endsAt: lesson.endsAt,
			total: windowTotal.mapWith(Number),
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
			course,
			and(
				eq(course.id, classGroup.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			campus,
			and(
				eq(campus.id, lesson.campusId),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			teacher,
			and(
				eq(teacher.id, lesson.teacherId),
				eq(teacher.organizationId, input.organizationId),
			),
		)
		.where(and(...filters))
		.orderBy(asc(lesson.startsAt), asc(lesson.id))
		.limit(4);

	return {
		total: rows[0]?.total ?? 0,
		items: rows.map((row) => ({
			id: row.id,
			className: row.className,
			courseName: row.courseName,
			campusName: row.campusName,
			teacherName: row.teacherName,
			room: row.room,
			startsAt: row.startsAt,
			endsAt: row.endsAt,
		})),
	};
}

export async function getDashboardReceivableSummary(
	input: GetDashboardReceivableSummaryInput,
): Promise<{
	total: number;
	outstandingAmountInCents: number;
	items: DashboardReceivableSummaryRow[];
}> {
	const outstandingAmount = sql<number>`greatest(
		${invoice.amountInCents} - ${invoice.paidAmountInCents},
		0
	)`;
	const totalOutstandingAmount = sql<number>`sum(${outstandingAmount}) over()`;
	const isPastDue = sql<boolean>`${invoice.dueDate} < ${input.today}`;
	const statusOrder = sql<number>`
		case
			when ${invoice.status} = 'overdue' or ${isPastDue} then 0
			else 1
		end
	`;
	const rows = await db
		.select({
			id: invoice.id,
			studentName: student.name,
			courseName: course.name,
			outstandingAmountInCents: outstandingAmount.mapWith(Number),
			status: invoice.status,
			isPastDue,
			dueDate: invoice.dueDate,
			total: windowTotal.mapWith(Number),
			totalOutstandingAmount: totalOutstandingAmount.mapWith(Number),
		})
		.from(invoice)
		.innerJoin(
			student,
			and(
				eq(student.id, invoice.studentId),
				eq(student.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			enrollment,
			and(
				eq(enrollment.id, invoice.enrollmentId),
				eq(enrollment.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			course,
			and(
				eq(course.id, enrollment.courseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(invoice.organizationId, input.organizationId),
				inArray(invoice.status, ["pending", "overdue"]),
				sql`${outstandingAmount} > 0`,
			),
		)
		.orderBy(asc(statusOrder), asc(invoice.dueDate), asc(invoice.id))
		.limit(4);

	return {
		total: rows[0]?.total ?? 0,
		outstandingAmountInCents: rows[0]?.totalOutstandingAmount ?? 0,
		items: rows.map((row) => ({
			id: row.id,
			studentName: row.studentName,
			courseName: row.courseName,
			outstandingAmountInCents: row.outstandingAmountInCents,
			status: toDashboardReceivableStatus(row.status),
			isPastDue: row.isPastDue,
			dueDate: row.dueDate,
		})),
	};
}

export async function getDashboardLearningSummary(
	input: GetDashboardLearningSummaryInput,
): Promise<DashboardLearningSummary> {
	const [studentRows, enrollmentRows, activeClassRows] = await Promise.all([
		db
			.select({ value: count() })
			.from(student)
			.where(eq(student.organizationId, input.organizationId)),
		db
			.select({ value: count() })
			.from(enrollment)
			.where(eq(enrollment.organizationId, input.organizationId)),
		db
			.select({ value: count() })
			.from(classGroup)
			.where(
				and(
					eq(classGroup.organizationId, input.organizationId),
					inArray(classGroup.status, ["recruiting", "running"]),
				),
			),
	]);

	return {
		studentCount: studentRows[0]?.value ?? 0,
		enrollmentCount: enrollmentRows[0]?.value ?? 0,
		activeClassCount: activeClassRows[0]?.value ?? 0,
	};
}
