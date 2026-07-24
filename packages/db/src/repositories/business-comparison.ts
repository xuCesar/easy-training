import { type SQL, sql } from "drizzle-orm";

import { db } from "../index";
import type { CampusAccess } from "./organization";

export type BusinessComparisonDimension =
	| "campus"
	| "course"
	| "teacher"
	| "class";

type ComparisonRatio =
	| {
			status: "available";
			value: number;
			numerator: number;
			denominator: number;
	  }
	| {
			status: "notApplicable";
			value: null;
			numerator: number;
			denominator: number;
			reason:
				| "noDenominator"
				| "immatureCohort"
				| "insufficientSample"
				| "factCoverageMissing";
	  };

export type BusinessComparisonValues = {
	enrollmentCount: number;
	enrollmentAmountInCents: number;
	lessonCount: number;
	completedLessonCount: number;
	consumedLessonCount: number;
	completedMinutes: number;
	plannedMinutes: number;
	attendanceRate: ComparisonRatio;
	utilizationRate: ComparisonRatio;
	occupancyRate: ComparisonRatio;
	netReceiptsInCents: number;
	activeSeatCount: number;
	capacity: number;
	capacityConfigured: boolean;
	dataCoverageIncomplete: boolean;
};

export type BusinessComparisonDimensionRecord = {
	id: string;
	label: string;
	campusId: string | null;
	weeklyCapacityHours: number;
	activeSeatCount: number;
	capacity: number;
};

export type BusinessComparisonRow = {
	id: string;
	label: string;
	campusId: string | null;
	sampleSmall: boolean;
	detailPath: string | null;
	current: BusinessComparisonValues;
	comparison: BusinessComparisonValues;
};

export type BusinessComparisonResult = {
	dimension: BusinessComparisonDimension;
	rows: BusinessComparisonRow[];
	missingFinancialFactCount: number;
	unlinkedDimensionCount: number;
	scopeCoverageIncomplete: boolean;
};

type AggregateRow = {
	key: string | null;
	count: number;
	amount: number;
	lessonCount: number;
	completedLessonCount: number;
	completedMinutes: number;
	plannedMinutes: number;
	capacitySeats: number;
	presentLate: number;
	attendanceCount: number;
	consumedLessonCount: number;
	netReceiptsInCents: number;
};

type DimensionMetric = Omit<AggregateRow, "key">;

const zeroMetric = (): DimensionMetric => ({
	count: 0,
	amount: 0,
	lessonCount: 0,
	completedLessonCount: 0,
	completedMinutes: 0,
	plannedMinutes: 0,
	capacitySeats: 0,
	presentLate: 0,
	attendanceCount: 0,
	consumedLessonCount: 0,
	netReceiptsInCents: 0,
});

function sqlList(values: string[]): SQL {
	return sql.join(
		values.map((value) => sql`${value}`),
		sql`, `,
	);
}

function campusCondition(access: CampusAccess, expression: SQL): SQL {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "all") return sql`true`;
	if (access.campusIds.length === 0) return sql`false`;
	return sql`${expression} in (${sqlList(access.campusIds)})`;
}

function teacherCondition(userId: string | undefined): SQL {
	return userId
		? sql`cg.teacher_id in (select t_scope.id from teacher t_scope where t_scope.organization_id = cg.organization_id and t_scope.user_id = ${userId})`
		: sql`true`;
}

function dimensionExpressions(
	dimension: BusinessComparisonDimension,
	keySource: "enrollment" | "lesson" | "invoice",
) {
	if (keySource === "invoice") {
		switch (dimension) {
			case "campus":
				return { key: sql`f.campus_id`, campus: sql`f.campus_id` };
			case "course":
				return { key: sql`f.course_id`, campus: sql`cg.campus_id` };
			case "teacher":
				return { key: sql`cg.teacher_id`, campus: sql`cg.campus_id` };
			case "class":
				return { key: sql`e.class_group_id`, campus: sql`cg.campus_id` };
		}
	}
	if (keySource === "lesson") {
		switch (dimension) {
			case "campus":
				return { key: sql`l.campus_id`, campus: sql`l.campus_id` };
			case "course":
				return { key: sql`cg.course_id`, campus: sql`cg.campus_id` };
			case "teacher":
				return { key: sql`l.teacher_id`, campus: sql`l.campus_id` };
			case "class":
				return { key: sql`l.class_group_id`, campus: sql`l.campus_id` };
		}
	}
	switch (dimension) {
		case "campus":
			return {
				key: sql`e.conversion_campus_id`,
				campus: sql`e.conversion_campus_id`,
			};
		case "course":
			return { key: sql`e.course_id`, campus: sql`cg.campus_id` };
		case "teacher":
			return { key: sql`cg.teacher_id`, campus: sql`cg.campus_id` };
		case "class":
			return { key: sql`e.class_group_id`, campus: sql`cg.campus_id` };
	}
}

function asRows<T>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === "object" && "rows" in value) {
		const rows = (value as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
}

async function getDimensionRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	dimension: BusinessComparisonDimension;
	teacherUserId?: string;
}): Promise<BusinessComparisonDimensionRecord[]> {
	const { organizationId, campusAccess, dimension, teacherUserId } = input;
	const rows =
		dimension === "campus"
			? await db.execute(sql`
				select c.id::text as id, c.name as label, c.id::text as "campusId",
					0::int as "weeklyCapacityHours", 0::int as "activeSeatCount", 0::int as capacity
				from campus c
				where c.organization_id = ${organizationId}
					and c.is_active = true
					and ${campusCondition(campusAccess, sql`c.id`)}
				order by c.name, c.id
			`)
			: dimension === "course"
				? await db.execute(sql`
					select c.id::text as id, c.name as label, null::text as "campusId",
						0::int as "weeklyCapacityHours", 0::int as "activeSeatCount", 0::int as capacity
					from course c
					where c.organization_id = ${organizationId}
						and c.is_active = true
						and (
							${
								campusAccess.kind === "all"
									? sql`true`
									: sql`exists (
								select 1 from class_group scoped_cg
								where scoped_cg.course_id = c.id
								and ${campusCondition(campusAccess, sql`scoped_cg.campus_id`)}
							)`
							}
						)
					order by c.name, c.id
				`)
				: dimension === "teacher"
					? await db.execute(sql`
						select t.id::text as id, t.name as label, null::text as "campusId",
							t.weekly_capacity_hours::int as "weeklyCapacityHours",
							0::int as "activeSeatCount", 0::int as capacity
						from teacher t
						left join teacher_campus tc on tc.teacher_id = t.id
						where t.organization_id = ${organizationId}
							and ${teacherUserId ? sql`t.user_id = ${teacherUserId}` : sql`true`}
							and ${campusCondition(campusAccess, sql`tc.campus_id`)}
						group by t.id
						order by t.name, t.id
					`)
					: await db.execute(sql`
						select cg.id::text as id, cg.name as label, cg.campus_id::text as "campusId",
							0::int as "weeklyCapacityHours",
							count(distinct en.student_id) filter (where en.status = 'active')::int as "activeSeatCount",
							cg.capacity::int as capacity
						from class_group cg
						left join enrollment en on en.class_group_id = cg.id
						where cg.organization_id = ${organizationId}
							and cg.status in ('recruiting', 'running')
							and ${campusCondition(campusAccess, sql`cg.campus_id`)}
							and ${teacherCondition(teacherUserId)}
						group by cg.id
						order by cg.name, cg.id
					`);
	return asRows<BusinessComparisonDimensionRecord>(rows);
}

async function getMetricRows(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	dimension: BusinessComparisonDimension;
	teacherUserId?: string;
	from: Date;
	to: Date;
}): Promise<Map<string, DimensionMetric>> {
	const { organizationId, campusAccess, dimension, from, to } = input;
	const enrollmentExpr = dimensionExpressions(dimension, "enrollment");
	const lessonExpr = dimensionExpressions(dimension, "lesson");
	const invoiceExpr = dimensionExpressions(dimension, "invoice");
	const [enrollments, lessons, attendance, consumption, receipts] =
		await Promise.all([
			db.execute(sql`
				select ${enrollmentExpr.key}::text as key,
					count(*)::int as count,
					coalesce(sum(e.amount_in_cents), 0)::int as amount,
					0::int as "lessonCount", 0::int as "completedLessonCount",
					0::numeric as "completedMinutes", 0::numeric as "plannedMinutes",
					0::int as "capacitySeats", 0::int as "presentLate", 0::int as "attendanceCount",
					0::int as "consumedLessonCount", 0::int as "netReceiptsInCents"
				from enrollment e
				left join class_group cg on cg.id = e.class_group_id and cg.organization_id = e.organization_id
				where e.organization_id = ${organizationId}
					and e.enrolled_at >= ${from} and e.enrolled_at < ${to}
					and ${campusCondition(campusAccess, enrollmentExpr.campus)}
					and ${teacherCondition(input.teacherUserId)}
				group by ${enrollmentExpr.key}
			`),
			db.execute(sql`
				select ${lessonExpr.key}::text as key,
					0::int as count, 0::int as amount,
					count(*)::int as "lessonCount",
					count(*) filter (where l.status = 'completed')::int as "completedLessonCount",
					coalesce(sum(extract(epoch from (l.ends_at - l.starts_at)) / 60)
						filter (where l.status = 'completed'), 0)::numeric as "completedMinutes",
					coalesce(sum(extract(epoch from (l.ends_at - l.starts_at)) / 60)
						filter (where l.status <> 'cancelled'), 0)::numeric as "plannedMinutes",
					coalesce(sum(cg.capacity) filter (where l.status = 'completed'), 0)::int as "capacitySeats",
					0::int as "presentLate", 0::int as "attendanceCount",
					0::int as "consumedLessonCount", 0::int as "netReceiptsInCents"
				from lesson l
				left join class_group cg on cg.id = l.class_group_id and cg.organization_id = l.organization_id
				where l.organization_id = ${organizationId}
					and l.starts_at >= ${from} and l.starts_at < ${to}
					and ${campusCondition(campusAccess, lessonExpr.campus)}
					and ${teacherCondition(input.teacherUserId)}
				group by ${lessonExpr.key}
			`),
			db.execute(sql`
				select ${lessonExpr.key}::text as key,
					0::int as count, 0::int as amount, 0::int as "lessonCount",
					0::int as "completedLessonCount", 0::numeric as "completedMinutes",
					0::numeric as "plannedMinutes", 0::int as "capacitySeats",
					count(a.id) filter (where a.status in ('present', 'late'))::int as "presentLate",
					count(a.id)::int as "attendanceCount",
					0::int as "consumedLessonCount", 0::int as "netReceiptsInCents"
				from lesson l
				left join class_group cg on cg.id = l.class_group_id and cg.organization_id = l.organization_id
				left join attendance a on a.lesson_id = l.id
				where l.organization_id = ${organizationId}
					and l.status = 'completed'
					and l.starts_at >= ${from} and l.starts_at < ${to}
					and ${campusCondition(campusAccess, lessonExpr.campus)}
					and ${teacherCondition(input.teacherUserId)}
				group by ${lessonExpr.key}
			`),
			db.execute(sql`
				select ${lessonExpr.key}::text as key,
					0::int as count, 0::int as amount, 0::int as "lessonCount",
					0::int as "completedLessonCount", 0::numeric as "completedMinutes",
					0::numeric as "plannedMinutes", 0::int as "capacitySeats",
					0::int as "presentLate", 0::int as "attendanceCount",
					count(distinct lc.lesson_id)::int as "consumedLessonCount",
					0::int as "netReceiptsInCents"
				from lesson_consumption lc
				inner join lesson l on l.id = lc.lesson_id and l.organization_id = lc.organization_id
				left join class_group cg on cg.id = l.class_group_id and cg.organization_id = l.organization_id
				where lc.organization_id = ${organizationId}
					and l.starts_at >= ${from} and l.starts_at < ${to}
					and ${campusCondition(campusAccess, lessonExpr.campus)}
					and ${teacherCondition(input.teacherUserId)}
				group by ${lessonExpr.key}
			`),
			db.execute(sql`
				select key, 0::int as count, 0::int as amount, 0::int as "lessonCount",
					0::int as "completedLessonCount", 0::numeric as "completedMinutes",
					0::numeric as "plannedMinutes", 0::int as "capacitySeats",
					0::int as "presentLate", 0::int as "attendanceCount",
					0::int as "consumedLessonCount", coalesce(sum(amount), 0)::int as "netReceiptsInCents"
				from (
					select ${invoiceExpr.key}::text as key, p.amount_in_cents as amount
					from payment p
					inner join invoice_metric_fact f on f.invoice_id = p.invoice_id and f.organization_id = p.organization_id
					left join invoice i on i.id = p.invoice_id and i.organization_id = p.organization_id
					left join enrollment e on e.id = i.enrollment_id and e.organization_id = i.organization_id
					left join class_group cg on cg.id = e.class_group_id and cg.organization_id = e.organization_id
					where p.organization_id = ${organizationId} and p.received_at >= ${from} and p.received_at < ${to}
						and ${campusCondition(campusAccess, invoiceExpr.campus)}
						and ${teacherCondition(input.teacherUserId)}
					union all
					select ${invoiceExpr.key}::text as key, -r.amount_in_cents as amount
					from payment_reversal r
					inner join invoice_metric_fact f on f.invoice_id = r.invoice_id and f.organization_id = r.organization_id
					left join invoice i on i.id = r.invoice_id and i.organization_id = r.organization_id
					left join enrollment e on e.id = i.enrollment_id and e.organization_id = i.organization_id
					left join class_group cg on cg.id = e.class_group_id and cg.organization_id = e.organization_id
					where r.organization_id = ${organizationId} and r.reversed_at >= ${from} and r.reversed_at < ${to}
						and ${campusCondition(campusAccess, invoiceExpr.campus)}
						and ${teacherCondition(input.teacherUserId)}
					union all
					select ${invoiceExpr.key}::text as key, -rf.amount_in_cents as amount
					from refund rf
					inner join invoice_metric_fact f on f.invoice_id = rf.invoice_id and f.organization_id = rf.organization_id
					left join invoice i on i.id = rf.invoice_id and i.organization_id = rf.organization_id
					left join enrollment e on e.id = i.enrollment_id and e.organization_id = i.organization_id
					left join class_group cg on cg.id = e.class_group_id and cg.organization_id = e.organization_id
					where rf.organization_id = ${organizationId} and rf.refunded_at >= ${from} and rf.refunded_at < ${to}
						and ${campusCondition(campusAccess, invoiceExpr.campus)}
						and ${teacherCondition(input.teacherUserId)}
				) events
				group by key
			`),
		]);

	const byKey = new Map<string, DimensionMetric>();
	const merge = (rows: unknown) => {
		for (const row of asRows<AggregateRow>(rows)) {
			const key = row.key ?? "__unlinked__";
			const current = byKey.get(key) ?? zeroMetric();
			current.count += Number(row.count ?? 0);
			current.amount += Number(row.amount ?? 0);
			current.lessonCount += Number(row.lessonCount ?? 0);
			current.completedLessonCount += Number(row.completedLessonCount ?? 0);
			current.completedMinutes += Number(row.completedMinutes ?? 0);
			current.plannedMinutes += Number(row.plannedMinutes ?? 0);
			current.capacitySeats += Number(row.capacitySeats ?? 0);
			current.presentLate += Number(row.presentLate ?? 0);
			current.attendanceCount += Number(row.attendanceCount ?? 0);
			current.consumedLessonCount += Number(row.consumedLessonCount ?? 0);
			current.netReceiptsInCents += Number(row.netReceiptsInCents ?? 0);
			byKey.set(key, current);
		}
	};
	for (const rows of [enrollments, lessons, attendance, consumption, receipts])
		merge(rows);
	return byKey;
}

function ratio(numerator: number, denominator: number): ComparisonRatio {
	if (denominator <= 0)
		return {
			status: "notApplicable",
			value: null,
			numerator,
			denominator,
			reason: "noDenominator",
		};
	return {
		status: "available",
		value: numerator / denominator,
		numerator,
		denominator,
	};
}

function valuesFor(
	metric: DimensionMetric,
	record: BusinessComparisonDimensionRecord | undefined,
	dimension: BusinessComparisonDimension,
	from: Date,
	to: Date,
): BusinessComparisonValues {
	const days = Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
	const capacityMinutes =
		dimension === "teacher" && record
			? (record.weeklyCapacityHours * 60 * days) / 7
			: 0;
	const occupancyDenominator = dimension === "class" ? metric.capacitySeats : 0;
	return {
		enrollmentCount: metric.count,
		enrollmentAmountInCents: metric.amount,
		lessonCount: metric.lessonCount,
		completedLessonCount: metric.completedLessonCount,
		consumedLessonCount: metric.consumedLessonCount,
		completedMinutes: metric.completedMinutes,
		plannedMinutes: metric.plannedMinutes,
		attendanceRate: ratio(metric.presentLate, metric.attendanceCount),
		utilizationRate: ratio(metric.completedMinutes, capacityMinutes),
		occupancyRate: ratio(metric.presentLate, occupancyDenominator),
		netReceiptsInCents: metric.netReceiptsInCents,
		activeSeatCount: record?.activeSeatCount ?? 0,
		capacity: record?.capacity ?? 0,
		capacityConfigured:
			(dimension === "teacher" && (record?.weeklyCapacityHours ?? 0) > 0) ||
			(dimension === "class" && (record?.capacity ?? 0) > 0),
		dataCoverageIncomplete:
			(dimension === "teacher" && (record?.weeklyCapacityHours ?? 0) === 0) ||
			(dimension === "class" && (record?.capacity ?? 0) === 0),
	};
}

async function countMissingFinancialFacts(input: {
	organizationId: string;
	from: Date;
	to: Date;
}): Promise<number> {
	const rows = await db.execute(sql`
		select count(*)::int as count
		from invoice i
		left join invoice_metric_fact f on f.invoice_id = i.id and f.organization_id = i.organization_id
		where i.organization_id = ${input.organizationId}
			and i.issued_at >= ${input.from} and i.issued_at < ${input.to}
			and f.invoice_id is null
	`);
	return Number(asRows<{ count: number }>(rows)[0]?.count ?? 0);
}

export async function getBusinessComparisonRecords(input: {
	organizationId: string;
	campusAccess: CampusAccess;
	dimension: BusinessComparisonDimension;
	teacherUserId?: string;
	from: Date;
	to: Date;
	comparisonFrom: Date;
	comparisonTo: Date;
}): Promise<BusinessComparisonResult> {
	const records = await getDimensionRecords(input);
	const [currentMetrics, comparisonMetrics, missingFinancialFactCount] =
		await Promise.all([
			getMetricRows(input),
			getMetricRows({
				...input,
				from: input.comparisonFrom,
				to: input.comparisonTo,
			}),
			countMissingFinancialFacts({
				organizationId: input.organizationId,
				from: input.from,
				to: input.to,
			}),
		]);
	const recordsById = new Map(records.map((record) => [record.id, record]));
	const keys = new Set([
		...recordsById.keys(),
		...currentMetrics.keys(),
		...comparisonMetrics.keys(),
	]);
	const rows: BusinessComparisonRow[] = [];
	for (const key of keys) {
		const record = recordsById.get(key);
		const current = currentMetrics.get(key) ?? zeroMetric();
		const comparison = comparisonMetrics.get(key) ?? zeroMetric();
		const synthetic = key === "__unlinked__";
		if (!record && !synthetic) continue;
		const dimensionRecord = record ?? {
			id: key,
			label:
				input.dimension === "course" ? "未关联课程 / 其他业务" : "未关联维度",
			campusId: null,
			weeklyCapacityHours: 0,
			activeSeatCount: 0,
			capacity: 0,
		};
		rows.push({
			id: dimensionRecord.id,
			label: dimensionRecord.label,
			campusId: dimensionRecord.campusId,
			sampleSmall: current.count > 0 && current.count < 5,
			detailPath: synthetic
				? null
				: `/analytics?dimension=${input.dimension}&id=${dimensionRecord.id}`,
			current: valuesFor(
				current,
				record,
				input.dimension,
				input.from,
				input.to,
			),
			comparison: valuesFor(
				comparison,
				record,
				input.dimension,
				input.comparisonFrom,
				input.comparisonTo,
			),
		});
	}
	rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
	return {
		dimension: input.dimension,
		rows,
		missingFinancialFactCount,
		unlinkedDimensionCount: rows.filter((row) => row.id === "__unlinked__")
			.length,
		scopeCoverageIncomplete:
			input.campusAccess.kind !== "all" && missingFinancialFactCount > 0,
	};
}
