import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";

import {
	businessMetricAttendanceResultSchema,
	businessMetricConsumptionResultSchema,
	businessMetricDrilldownResultSchema,
	businessMetricFinancialAgingDrilldownResultSchema,
	businessMetricFinancialDrilldownResultSchema,
	businessMetricFinancialResultSchema,
	businessMetricRenewalResultSchema,
	businessMetricResourceResultSchema,
	businessMetricSalesResultSchema,
} from "../../api/src/contracts/business-metrics";
import {
	businessMetricDefinitionRegistry,
	getBusinessMetricAttendance,
	getBusinessMetricConsumption,
	getBusinessMetricDrilldown,
	getBusinessMetricFinancial,
	getBusinessMetricFinancialAgingDrilldown,
	getBusinessMetricFinancialDrilldown,
	getBusinessMetricRenewal,
	getBusinessMetricResource,
	getBusinessMetricSales,
} from "../../api/src/repositories/business-metrics";
import { db } from "../src";
import {
	getBusinessMetricAttendanceRecord,
	getBusinessMetricConsumptionRecord,
	getBusinessMetricRenewalRecord,
	getBusinessMetricSalesRecord,
} from "../src/repositories/business-metrics";
import { getResourceUtilizationRecord } from "../src/repositories/resource-metrics";
import {
	attendance,
	campus,
	classGroup,
	classGroupCapacityHistory,
	course,
	enrollment,
	enrollmentLifecycleEvent,
	enrollmentPurchaseCycle,
	enrollmentRegistration,
	enrollmentRenewal,
	invoice,
	invoiceMetricFact,
	lead,
	leadMilestoneEvent,
	lesson,
	lessonConsumption,
	makeupLesson,
	organization,
	payment,
	paymentReversal,
	refund,
	renewalOpportunity,
	renewalOpportunityConversion,
	student,
	teacher,
	teacherCampus,
	teacherCapacityHistory,
	user,
} from "../src/schema";

const now = new Date("2026-07-22T04:00:00.000Z");
const emptyScope = {
	organizationId: randomUUID(),
	campusAccess: { kind: "all" as const },
};

test("经营指标空机构查询返回稳定零值且所有 SQL 可执行", async () => {
	const from = new Date("2026-07-01T00:00:00.000Z");
	const to = new Date("2026-08-01T00:00:00.000Z");
	const [sales, attendance, consumption, renewal] = await Promise.all([
		getBusinessMetricSalesRecord({ scope: emptyScope, from, to, asOf: now }),
		getBusinessMetricAttendanceRecord({ scope: emptyScope, from, to }),
		getBusinessMetricConsumptionRecord({
			scope: emptyScope,
			from,
			to,
			granularity: "day",
		}),
		getBusinessMetricRenewalRecord({
			organizationId: emptyScope.organizationId,
			campusAccess: emptyScope.campusAccess,
			from,
			to,
			asOf: now,
		}),
	]);
	assert.equal(sales.convertedCycleCount, 0);
	assert.equal(attendance.present, 0);
	assert.equal(consumption.consumedLessonCount, 0);
	assert.equal(renewal.opportunityCount, 0);
	const resource = await getResourceUtilizationRecord({
		scope: emptyScope,
		from,
		to,
		asOf: now,
	});
	assert.equal(resource.completedMinutes, 0);
	assert.equal(resource.eligibleClassCount, 0);
});

test("经营指标角色权限和无效范围使用明确错误语义", async () => {
	const baseScope = {
		organizationId: emptyScope.organizationId,
		userId: "metric-user",
		campusAccess: emptyScope.campusAccess,
	};
	await assert.rejects(
		getBusinessMetricSales(
			{ ...baseScope, role: "finance" },
			{ range: { preset: "month" } },
			now,
		),
		(error: unknown) =>
			error instanceof Error && error.message.includes("招生经营指标"),
	);
	await assert.rejects(
		getBusinessMetricAttendance(
			{ ...baseScope, role: "consultant" },
			{ range: { preset: "month" } },
			now,
		),
		(error: unknown) =>
			error instanceof Error && error.message.includes("教学经营指标"),
	);
	await assert.rejects(
		getBusinessMetricRenewal(
			{ ...baseScope, role: "teacher" },
			{ range: { preset: "month" } },
			now,
		),
		(error: unknown) =>
			error instanceof Error && error.message.includes("续费经营指标"),
	);
	await assert.rejects(
		getBusinessMetricConsumption(
			{ ...baseScope, role: "owner" },
			{
				range: { preset: "custom", from: "2026-07-10", to: "2026-07-01" },
			},
			now,
		),
		(error: unknown) =>
			error instanceof Error && error.message.includes("晚于"),
	);
	await assert.rejects(
		getBusinessMetricResource(
			{ ...baseScope, role: "finance" },
			{ range: { preset: "month" } },
			now,
		),
		(error: unknown) =>
			error instanceof Error && error.message.includes("教学经营指标"),
	);
});

test("资源利用空机构保持契约和教师权限范围", async () => {
	const scope = {
		organizationId: emptyScope.organizationId,
		userId: "resource-metric-user",
		role: "teacher" as const,
		campusAccess: emptyScope.campusAccess,
	};
	const result = businessMetricResourceResultSchema.parse(
		await getBusinessMetricResource(scope, { range: { preset: "month" } }, now),
	);
	assert.equal(result.data.completedMinutes, 0);
	assert.equal(result.data.eligibleClassCount, 0);
	assert.equal(result.data.actualUtilizationRate.status, "notApplicable");
});

test("财务 summary 与事件下钻在空机构保持契约和权限稳定", async () => {
	const scope = {
		organizationId: emptyScope.organizationId,
		userId: "financial-metric-user",
		role: "owner" as const,
		campusAccess: emptyScope.campusAccess,
	};
	const input = { range: { preset: "month" as const } };
	const summary = businessMetricFinancialResultSchema.parse(
		await getBusinessMetricFinancial(scope, input, now),
	);
	assert.equal(summary.data.netReceiptsInCents, 0);
	assert.equal(summary.data.agingTotalInCents, 0);
	const drilldown = businessMetricFinancialDrilldownResultSchema.parse(
		await getBusinessMetricFinancialDrilldown(
			scope,
			{ ...input, limit: 50 },
			now,
		),
	);
	assert.deepEqual(drilldown.items, []);
	assert.equal(drilldown.nextCursor, null);
	const agingDrilldown =
		businessMetricFinancialAgingDrilldownResultSchema.parse(
			await getBusinessMetricFinancialAgingDrilldown(
				scope,
				{ ...input, limit: 50 },
				now,
			),
		);
	assert.deepEqual(agingDrilldown.items, []);
	assert.equal(agingDrilldown.nextCursor, null);
	await assert.rejects(
		getBusinessMetricFinancial({ ...scope, role: "consultant" }, input, now),
		(error: unknown) =>
			error instanceof Error && error.message.includes("财务经营指标"),
	);
	await assert.rejects(
		getBusinessMetricFinancial({ ...scope, role: "teacher" }, input, now),
		(error: unknown) =>
			error instanceof Error && error.message.includes("财务经营指标"),
	);
	assert.equal(
		businessMetricDefinitionRegistry.financial,
		getBusinessMetricFinancial,
	);
});

function createMetricFixtureIds() {
	const prefix = `business-metric-${Date.now()}-${randomUUID().slice(0, 8)}`;
	return {
		prefix,
		organizations: [randomUUID(), randomUUID()] as const,
		campuses: [randomUUID(), randomUUID(), randomUUID()] as const,
		users: {
			owner: `${prefix}-owner`,
			consultantA: `${prefix}-consultant-a`,
			consultantB: `${prefix}-consultant-b`,
			teacher: `${prefix}-teacher`,
		},
		course: randomUUID(),
		teacher: randomUUID(),
		classGroup: randomUUID(),
		students: Array.from({ length: 9 }, () => randomUUID()),
		enrollments: Array.from({ length: 9 }, () => randomUUID()),
		leads: Array.from({ length: 9 }, () => randomUUID()),
		lessons: Array.from({ length: 5 }, () => randomUUID()),
		consumptions: Array.from({ length: 6 }, () => randomUUID()),
		cycles: Array.from({ length: 5 }, () => randomUUID()),
		opportunities: Array.from({ length: 3 }, () => randomUUID()),
		invoices: Array.from({ length: 4 }, () => randomUUID()),
		renewals: Array.from({ length: 2 }, () => randomUUID()),
	};
}

type MetricFixtureIds = ReturnType<typeof createMetricFixtureIds>;

function requiredAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	assert.ok(value, `fixture 缺少索引 ${index}`);
	return value;
}

async function cleanupMetricFixture(ids: MetricFixtureIds) {
	await db
		.delete(organization)
		.where(inArray(organization.id, [...ids.organizations]));
	await db.delete(user).where(inArray(user.id, Object.values(ids.users)));
}

async function seedMetricFixture(ids: MetricFixtureIds) {
	const [organizationA, organizationB] = ids.organizations;
	const [campusA, campusA2, campusB] = ids.campuses;
	await db.insert(user).values(
		Object.entries(ids.users).map(([name, id]) => ({
			id,
			name,
			email: `${id}@example.invalid`,
		})),
	);
	await db.insert(organization).values([
		{ id: organizationA, name: `${ids.prefix} A` },
		{ id: organizationB, name: `${ids.prefix} B` },
	]);
	await db.insert(campus).values([
		{
			id: campusA,
			organizationId: organizationA,
			code: `${ids.prefix}-a`,
			name: "A 校区",
			city: "上海",
			address: "A",
		},
		{
			id: campusA2,
			organizationId: organizationA,
			code: `${ids.prefix}-a2`,
			name: "A2 校区",
			city: "上海",
			address: "A2",
		},
		{
			id: campusB,
			organizationId: organizationB,
			code: `${ids.prefix}-b`,
			name: "B 校区",
			city: "上海",
			address: "B",
		},
	]);
	await db.insert(course).values({
		id: ids.course,
		organizationId: organizationA,
		code: `${ids.prefix}-course`,
		name: "经营指标课程",
		category: "language",
		level: "L1",
		durationMinutes: 60,
		listPriceInCents: 100_000,
		lessonsPerPackage: 10,
		tags: [],
	});
	await db.insert(teacher).values({
		id: ids.teacher,
		organizationId: organizationA,
		userId: ids.users.teacher,
		name: "经营指标教师",
		subjects: ["英语"],
	});
	await db.insert(teacherCampus).values({
		teacherId: ids.teacher,
		campusId: campusA,
	});
	await db.insert(classGroup).values({
		id: ids.classGroup,
		organizationId: organizationA,
		courseId: ids.course,
		campusId: campusA,
		teacherId: ids.teacher,
		name: "经营指标班",
		status: "running",
		capacity: 20,
		scheduleText: "周一",
		startDate: "2026-06-01",
	});
	await db.insert(student).values(
		ids.students.map((id, index) => ({
			id,
			organizationId: organizationA,
			campusId: campusA,
			name: `指标学员 ${index}`,
			guardianName: `监护人 ${index}`,
			guardianPhone: `1380000${String(index).padStart(4, "0")}`,
			status: "active" as const,
		})),
	);
	await db.insert(lead).values(
		ids.leads.map((id, index) => ({
			id,
			organizationId: organizationA,
			campusId: campusA,
			createdCampusId: campusA,
			providerUserId: ids.users.consultantA,
			providerNameSnapshot: "顾问 A",
			ownerUserId: index === 0 ? ids.users.consultantB : ids.users.consultantA,
			currentCycleNumber: index === 0 ? 2 : 1,
			name: `指标线索 ${index}`,
			phone: `1390000${String(index).padStart(4, "0")}`,
			source: "fixture",
			stage: (index < 5 ? "enrolled" : "new") as "enrolled" | "new",
			createdAt: new Date(
				index === 5 ? "2026-07-30T02:00:00.000Z" : "2026-07-01T02:00:00.000Z",
			),
		})),
	);
	await db.insert(leadMilestoneEvent).values([
		{
			organizationId: organizationA,
			leadId: requiredAt(ids.leads, 0),
			cycleNumber: 1,
			kind: "lost",
			campusId: campusA,
			attributionUserId: ids.users.consultantA,
			operatorUserId: ids.users.owner,
			sourceType: "fixture",
			occurredAt: new Date("2026-07-02T02:00:00.000Z"),
		},
		{
			organizationId: organizationA,
			leadId: requiredAt(ids.leads, 0),
			cycleNumber: 2,
			kind: "converted",
			campusId: campusA,
			attributionUserId: ids.users.consultantB,
			operatorUserId: ids.users.owner,
			sourceType: "fixture",
			occurredAt: new Date("2026-07-20T02:00:00.000Z"),
		},
		...ids.leads.slice(1, 4).map((leadId, index) => ({
			organizationId: organizationA,
			leadId,
			cycleNumber: 1,
			kind: (index === 2 ? "lost" : "converted") as "lost" | "converted",
			campusId: campusA,
			attributionUserId: ids.users.consultantA,
			operatorUserId: ids.users.owner,
			sourceType: "fixture",
			occurredAt: new Date(
				`2026-07-${String(5 + index).padStart(2, "0")}T02:00:00.000Z`,
			),
		})),
		{
			organizationId: organizationA,
			leadId: requiredAt(ids.leads, 4),
			cycleNumber: 1,
			kind: "converted",
			campusId: campusA,
			attributionUserId: ids.users.consultantA,
			operatorUserId: ids.users.owner,
			sourceType: "fixture",
			occurredAt: new Date("2026-07-10T02:00:00.000Z"),
		},
		{
			organizationId: organizationA,
			leadId: requiredAt(ids.leads, 1),
			cycleNumber: 1,
			kind: "trial_booked",
			campusId: campusA,
			providerUserId: ids.users.consultantA,
			operatorUserId: ids.users.owner,
			sourceType: "fixture",
			occurredAt: new Date("2026-07-03T02:00:00.000Z"),
		},
	]);

	await db.insert(enrollment).values(
		ids.enrollments.map((id, index) => ({
			id,
			organizationId: organizationA,
			studentId: requiredAt(ids.students, index),
			conversionOwnerUserId: ids.users.consultantB,
			conversionOwnerNameSnapshot: "顾问 B",
			conversionCampusId: campusA,
			courseId: ids.course,
			classGroupId: ids.classGroup,
			purchasedLessons: 10,
			remainingLessons: 2,
			amountInCents: 100_000,
			status: (index === 7 ? "frozen" : "active") as "frozen" | "active",
			enrolledAt: new Date("2026-06-01T02:00:00.000Z"),
		})),
	);
	await db.insert(invoice).values(
		ids.invoices.map((id, index) => ({
			id,
			organizationId: organizationA,
			studentId: requiredAt(ids.students, index),
			enrollmentId: requiredAt(ids.enrollments, index),
			source: (index === 0 ? "enrollment" : "renewal") as
				| "enrollment"
				| "renewal",
			businessActivityType: (index === 0
				? "course_enrollment"
				: "course_renewal") as "course_enrollment" | "course_renewal",
			amountInCents: 100_000,
			dueDate: "2026-07-31",
			issuedAt: new Date(
				[
					"2026-06-01T02:00:00.000Z",
					"2026-07-01T02:00:00.000Z",
					"2026-07-10T02:00:00.000Z",
					"2026-07-20T02:00:00.000Z",
				][index] ?? "2026-07-01T02:00:00.000Z",
			),
		})),
	);
	await db.insert(invoiceMetricFact).values(
		ids.invoices.map((invoiceId, index) => ({
			invoiceId,
			organizationId: organizationA,
			campusId: campusA,
			campusAttributionKind: "linked" as const,
			campusNameSnapshot: "A 校区",
			courseId: ids.course,
			courseAttributionKind: "linked" as const,
			courseNameSnapshot: "经营指标课程",
			source: (index === 0 ? "lead_conversion" : "renewal") as
				| "lead_conversion"
				| "renewal",
			provenance: "native" as const,
			occurredAt: new Date(
				[
					"2026-06-01T02:00:00.000Z",
					"2026-07-01T02:00:00.000Z",
					"2026-07-10T02:00:00.000Z",
					"2026-07-20T02:00:00.000Z",
				][index] ?? "2026-07-01T02:00:00.000Z",
			),
		})),
	);
	const fixturePayments = [randomUUID(), randomUUID(), randomUUID()];
	await db.insert(payment).values([
		{
			id: fixturePayments[0] as string,
			organizationId: organizationA,
			invoiceId: requiredAt(ids.invoices, 0),
			amountInCents: 70_000,
			receivedAt: new Date("2026-07-05T02:00:00.000Z"),
			method: "bank_transfer",
			operatorUserId: ids.users.owner,
			operatorName: "owner",
			requestId: randomUUID(),
		},
		{
			id: fixturePayments[1] as string,
			organizationId: organizationA,
			invoiceId: requiredAt(ids.invoices, 1),
			amountInCents: 100_000,
			receivedAt: new Date("2026-07-20T02:00:00.000Z"),
			method: "bank_transfer",
			operatorUserId: ids.users.owner,
			operatorName: "owner",
			requestId: randomUUID(),
		},
		{
			id: fixturePayments[2] as string,
			organizationId: organizationA,
			invoiceId: requiredAt(ids.invoices, 2),
			amountInCents: 50_000,
			receivedAt: new Date("2026-07-21T02:00:00.000Z"),
			method: "bank_transfer",
			operatorUserId: ids.users.owner,
			operatorName: "owner",
			requestId: randomUUID(),
		},
	]);
	await db.insert(paymentReversal).values({
		organizationId: organizationA,
		campusId: campusA,
		invoiceId: requiredAt(ids.invoices, 2),
		paymentId: fixturePayments[2] as string,
		amountInCents: 20_000,
		reason: "fixture",
		reversedAt: new Date("2026-07-25T02:00:00.000Z"),
		operatorUserId: ids.users.owner,
		operatorName: "owner",
		requestId: randomUUID(),
	});
	await db.insert(refund).values({
		organizationId: organizationA,
		invoiceId: requiredAt(ids.invoices, 1),
		amountInCents: 20_000,
		refundedAt: new Date("2026-07-26T02:00:00.000Z"),
		method: "bank_transfer",
		reason: "fixture",
		operatorUserId: ids.users.owner,
		operatorName: "owner",
		requestId: randomUUID(),
	});
	await db.insert(enrollmentRegistration).values({
		organizationId: organizationA,
		requestId: randomUUID(),
		inputHash: "direct-fixture",
		studentId: requiredAt(ids.students, 0),
		enrollmentId: requiredAt(ids.enrollments, 0),
		invoiceId: requiredAt(ids.invoices, 0),
		classGroupId: ids.classGroup,
		campusId: campusA,
		source: "线下咨询",
		providerUserId: ids.users.consultantA,
		providerNameSnapshot: "顾问 A",
		operatorUserId: ids.users.owner,
		createdAt: new Date("2026-07-05T02:00:00.000Z"),
	});
	await db.insert(lesson).values([
		{
			id: requiredAt(ids.lessons, 0),
			organizationId: organizationA,
			classGroupId: ids.classGroup,
			teacherId: ids.teacher,
			campusId: campusA,
			room: "A1",
			startsAt: new Date("2026-06-30T16:30:00.000Z"),
			endsAt: new Date("2026-06-30T17:30:00.000Z"),
			status: "completed",
		},
		...ids.lessons.slice(1).map((id, index) => ({
			id,
			organizationId: organizationA,
			classGroupId: ids.classGroup,
			teacherId: ids.teacher,
			campusId: campusA,
			room: `A${index + 2}`,
			startsAt: new Date(
				`2026-07-${String(10 + index).padStart(2, "0")}T02:00:00.000Z`,
			),
			endsAt: new Date(
				`2026-07-${String(10 + index).padStart(2, "0")}T03:00:00.000Z`,
			),
			status: index < 2 ? ("completed" as const) : ("scheduled" as const),
		})),
	]);
	await db.insert(attendance).values([
		...(["present", "late", "absent", "leave"] as const).map(
			(status, index) => ({
				lessonId: requiredAt(ids.lessons, 0),
				studentId: requiredAt(ids.students, index),
				status,
			}),
		),
		{
			lessonId: requiredAt(ids.lessons, 0),
			studentId: requiredAt(ids.students, 4),
			status: "present",
		},
	]);
	await db.insert(makeupLesson).values([
		...(["fulfilled", "scheduled", "needs_reschedule"] as const).map(
			(status, index) => ({
				organizationId: organizationA,
				sourceLessonId: requiredAt(ids.lessons, 1),
				sourceEnrollmentId: requiredAt(ids.enrollments, 4 + index),
				targetLessonId: requiredAt(ids.lessons, index === 0 ? 0 : index + 2),
				status,
				requestId: randomUUID(),
				requestFingerprint: `makeup-${index}`,
				createdByUserId: ids.users.owner,
			}),
		),
	]);
	await db.insert(lessonConsumption).values(
		ids.consumptions.map((id, index) => ({
			id,
			organizationId: organizationA,
			enrollmentId: requiredAt(ids.enrollments, index),
			lessonId: requiredAt(ids.lessons, index === 5 ? 1 : 0),
			attendanceStatus: (index === 2 ? "absent" : "present") as
				| "absent"
				| "present",
			previousRemainingLessons: 3,
			remainingLessons: 2,
			consumedAt: new Date(
				index === 0 ? "2026-07-02T18:00:00.000Z" : "2026-06-30T17:40:00.000Z",
			),
		})),
	);

	await db.insert(enrollmentPurchaseCycle).values([
		...ids.cycles.slice(0, 4).map((id, index) => ({
			id,
			organizationId: organizationA,
			enrollmentId: requiredAt(ids.enrollments, index + 1),
			sequence: 1,
			source: "initial" as const,
			sourceLeadId: requiredAt(ids.leads, index + 1),
			purchasedLessons: 10,
			startingRemainingLessons: 10,
			amountInCents: 100_000,
			campusId: campusA,
			startedAt: new Date("2026-06-01T02:00:00.000Z"),
		})),
	]);
	await db.insert(renewalOpportunity).values(
		ids.opportunities.map((id, index) => ({
			id,
			organizationId: organizationA,
			enrollmentId: requiredAt(ids.enrollments, index + 1),
			purchaseCycleId: requiredAt(ids.cycles, index),
			triggeringLessonConsumptionId: requiredAt(ids.consumptions, index + 1),
			thresholdLessons: 2,
			remainingLessons: 2,
			campusId: campusA,
			triggeredAt: new Date(
				index === 2 ? "2026-07-20T02:00:00.000Z" : "2026-07-01T02:00:00.000Z",
			),
		})),
	);
	await db.insert(enrollmentRenewal).values([
		{
			id: requiredAt(ids.renewals, 0),
			organizationId: organizationA,
			enrollmentId: requiredAt(ids.enrollments, 1),
			invoiceId: requiredAt(ids.invoices, 1),
			addedLessons: 10,
			amountInCents: 120_000,
			dueDate: "2026-07-31",
			operatorUserId: ids.users.owner,
			requestId: randomUUID(),
			createdAt: new Date("2026-07-10T02:00:00.000Z"),
		},
		{
			id: requiredAt(ids.renewals, 1),
			organizationId: organizationA,
			enrollmentId: requiredAt(ids.enrollments, 4),
			invoiceId: requiredAt(ids.invoices, 2),
			addedLessons: 8,
			amountInCents: 80_000,
			dueDate: "2026-07-31",
			operatorUserId: ids.users.owner,
			requestId: randomUUID(),
			createdAt: new Date("2026-07-08T02:00:00.000Z"),
		},
	]);
	await db.insert(renewalOpportunityConversion).values({
		organizationId: organizationA,
		opportunityId: requiredAt(ids.opportunities, 0),
		renewalId: requiredAt(ids.renewals, 0),
		convertedAt: new Date("2026-07-10T02:00:00.000Z"),
	});
	await db.insert(enrollmentPurchaseCycle).values({
		id: requiredAt(ids.cycles, 4),
		organizationId: organizationA,
		enrollmentId: requiredAt(ids.enrollments, 4),
		sequence: 2,
		source: "renewal",
		sourceRenewalId: requiredAt(ids.renewals, 1),
		purchasedLessons: 8,
		startingRemainingLessons: 10,
		amountInCents: 80_000,
		campusId: campusA,
		startedAt: new Date("2026-07-08T02:00:00.000Z"),
	});
	await db.insert(enrollmentLifecycleEvent).values({
		organizationId: organizationA,
		enrollmentId: requiredAt(ids.enrollments, 3),
		kind: "frozen",
		beforeStatus: "active",
		afterStatus: "frozen",
		effectiveAt: new Date("2026-07-25T02:00:00.000Z"),
		reason: "fixture",
		operatorUserId: ids.users.owner,
		requestId: randomUUID(),
		inputHash: "frozen-fixture",
	});

	return { organizationA, organizationB, campusA, campusA2 };
}

test("固定 fixture 返回销售、教学、消课和续费金值", async () => {
	const ids = createMetricFixtureIds();
	try {
		const { organizationA, campusA } = await seedMetricFixture(ids);
		const range = {
			preset: "custom" as const,
			from: "2026-07-01",
			to: "2026-08-01",
		};
		const scope = {
			organizationId: organizationA,
			userId: ids.users.owner,
			role: "owner" as const,
			campusAccess: { kind: "selected" as const, campusIds: [campusA] },
		};
		const fixtureNow = new Date("2026-08-20T04:00:00.000Z");
		const sales = businessMetricSalesResultSchema.parse(
			await getBusinessMetricSales(scope, { range }, fixtureNow),
		);
		const teaching = businessMetricAttendanceResultSchema.parse(
			await getBusinessMetricAttendance(scope, { range }, fixtureNow),
		);
		const consumption = businessMetricConsumptionResultSchema.parse(
			await getBusinessMetricConsumption(scope, { range }, fixtureNow),
		);
		const renewal = businessMetricRenewalResultSchema.parse(
			await getBusinessMetricRenewal(scope, { range }, fixtureNow),
		);
		const financial = businessMetricFinancialResultSchema.parse(
			await getBusinessMetricFinancial(scope, { range }, fixtureNow),
		);

		assert.deepEqual(sales.data.conversionRate, {
			status: "available",
			value: 4 / 6,
			numerator: 4,
			denominator: 6,
		});
		assert.equal(sales.data.trialBookedLeadCount, 1);
		assert.equal(sales.data.contactedLeadCount, 0);
		assert.equal(sales.data.directEnrollmentCount, 1);
		assert.equal(sales.data.directEnrollmentAmountInCents, 100_000);
		assert.equal(sales.dataQuality.immatureCohortCount, 1);
		assert.deepEqual(teaching.data.attendanceRate, {
			status: "available",
			value: 0.5,
			numerator: 2,
			denominator: 4,
		});
		assert.deepEqual(teaching.data.makeupCompletionRate, {
			status: "available",
			value: 1 / 3,
			numerator: 1,
			denominator: 3,
		});
		assert.equal(consumption.data.consumedLessonCount, 6);
		assert.equal(
			consumption.data.trend[0]?.bucketStart,
			"2026-06-30T16:00:00.000Z",
		);
		assert.equal(consumption.dataQuality.lateConsumptionCount, 1);
		assert.deepEqual(renewal.data.renewalRate, {
			status: "available",
			value: 0.5,
			numerator: 1,
			denominator: 2,
		});
		assert.equal(renewal.data.immatureOpportunityCount, 1);
		assert.equal(renewal.data.minimumRemainingObservationDays, 25);
		assert.equal(renewal.data.earlyRenewalCount, 1);
		assert.equal(renewal.data.renewalAmountInCents, 120_000);
		assert.equal(renewal.dataQuality.missingPurchaseCycleCount, 5);
		assert.equal(financial.data.netReceiptsInCents, 180_000);
		assert.deepEqual(financial.data.cohortCollectionRate, {
			status: "available",
			value: 110_000 / 300_000,
			numerator: 110_000,
			denominator: 300_000,
		});
		assert.equal(financial.data.matureCohortInvoiceCount, 3);
		assert.equal(financial.data.immatureCohortInvoiceCount, 0);
		assert.equal(financial.data.agingTotalInCents, 200_000);
		assert.deepEqual(financial.data.agingBuckets, [
			{ kind: "notDue", amountInCents: 0, invoiceCount: 0 },
			{ kind: "overdue1To30", amountInCents: 200_000, invoiceCount: 3 },
			{ kind: "overdue31To60", amountInCents: 0, invoiceCount: 0 },
			{ kind: "overdue61To90", amountInCents: 0, invoiceCount: 0 },
			{ kind: "overdueOver90", amountInCents: 0, invoiceCount: 0 },
		]);
	} finally {
		await cleanupMetricFixture(ids);
	}
});

test("资源利用按容量历史、实际到场和教师本人范围计算", async () => {
	const ids = createMetricFixtureIds();
	try {
		const { organizationA, campusA } = await seedMetricFixture(ids);
		await db.insert(teacherCapacityHistory).values({
			organizationId: organizationA,
			teacherId: ids.teacher,
			weeklyCapacityMinutes: 420,
			effectiveFrom: "2026-07-01",
			createdByUserId: ids.users.owner,
		});
		await db.insert(classGroupCapacityHistory).values([
			{
				organizationId: organizationA,
				classGroupId: ids.classGroup,
				capacity: 10,
				effectiveFrom: "2026-07-01",
				createdByUserId: ids.users.owner,
			},
			{
				organizationId: organizationA,
				classGroupId: ids.classGroup,
				capacity: 20,
				effectiveFrom: "2026-07-15",
				createdByUserId: ids.users.owner,
			},
		]);
		const range = {
			preset: "custom" as const,
			from: "2026-07-01",
			to: "2026-08-01",
		};
		const result = businessMetricResourceResultSchema.parse(
			await getBusinessMetricResource(
				{
					organizationId: organizationA,
					userId: ids.users.teacher,
					role: "teacher",
					campusAccess: {
						kind: "selected",
						campusIds: [campusA],
					},
				},
				{ range },
				new Date("2026-08-20T04:00:00.000Z"),
			),
		);

		assert.equal(result.data.completedMinutes, 180);
		assert.equal(result.data.plannedMinutes, 300);
		assert.equal(result.data.actualCapacityMinutes, 1_860);
		assert.equal(result.data.plannedCapacityMinutes, 1_860);
		assert.deepEqual(result.data.actualUtilizationRate, {
			status: "available",
			value: 180 / 1_860,
			numerator: 180,
			denominator: 1_860,
		});
		assert.equal(result.data.activeSeatCount, 8);
		assert.equal(result.data.classCapacity, 20);
		assert.equal(result.data.nearFullClassCount, 0);
		assert.deepEqual(result.data.lessonOccupancyRate, {
			status: "available",
			value: 3 / 30,
			numerator: 3,
			denominator: 30,
		});
		assert.deepEqual(result.dataQuality, {
			missingTeacherCapacityCount: 0,
			partialTeacherCapacityCount: 0,
			missingLessonCapacityCount: 0,
		});
	} finally {
		await cleanupMetricFixture(ids);
	}
});

test("财务角色、校区范围和下钻不会泄露其他校区或未归属规模", async () => {
	const ids = createMetricFixtureIds();
	try {
		const { organizationA, campusA, campusA2 } = await seedMetricFixture(ids);
		const otherCampusInvoiceId = randomUUID();
		const unattributedInvoiceId = randomUUID();
		await db.insert(invoice).values([
			{
				id: otherCampusInvoiceId,
				organizationId: organizationA,
				studentId: requiredAt(ids.students, 5),
				source: "manual",
				businessActivityType: "other",
				amountInCents: 10_000,
				dueDate: "2026-07-31",
				issuedAt: new Date("2026-07-15T02:00:00.000Z"),
			},
			{
				id: unattributedInvoiceId,
				organizationId: organizationA,
				studentId: requiredAt(ids.students, 6),
				source: "manual",
				businessActivityType: "other",
				amountInCents: 9_000,
				dueDate: "2026-07-31",
				issuedAt: new Date("2026-07-16T02:00:00.000Z"),
			},
		]);
		await db.insert(invoiceMetricFact).values({
			invoiceId: otherCampusInvoiceId,
			organizationId: organizationA,
			campusId: campusA2,
			campusAttributionKind: "linked",
			campusNameSnapshot: "A2 校区",
			courseAttributionKind: "not_applicable",
			source: "manual",
			provenance: "native",
			occurredAt: new Date("2026-07-15T02:00:00.000Z"),
		});
		await db.insert(payment).values({
			organizationId: organizationA,
			invoiceId: otherCampusInvoiceId,
			amountInCents: 10_000,
			receivedAt: new Date("2026-07-20T02:00:00.000Z"),
			method: "bank_transfer",
			operatorUserId: ids.users.owner,
			operatorName: "owner",
			requestId: randomUUID(),
		});

		const range = {
			preset: "custom" as const,
			from: "2026-07-01",
			to: "2026-08-01",
		};
		const fixtureNow = new Date("2026-08-20T04:00:00.000Z");
		const selectedScope = {
			organizationId: organizationA,
			userId: ids.users.owner,
			role: "finance" as const,
			campusAccess: { kind: "selected" as const, campusIds: [campusA] },
		};
		const selected = await getBusinessMetricFinancial(
			selectedScope,
			{ range },
			fixtureNow,
		);
		assert.equal(selected.data.netReceiptsInCents, 180_000);
		assert.equal(selected.dataQuality.missingAttributionCount, 0);
		assert.equal(selected.dataQuality.missingFinancialFactCount, 0);
		assert.equal(selected.dataQuality.scopeCoverageIncomplete, true);

		const selectedEvents = await getBusinessMetricFinancialDrilldown(
			selectedScope,
			{ range, limit: 50 },
			fixtureNow,
		);
		assert.equal(
			selectedEvents.items.some(
				(item) => item.invoiceId === otherCampusInvoiceId,
			),
			false,
		);
		const selectedAging = await getBusinessMetricFinancialAgingDrilldown(
			selectedScope,
			{ range, limit: 50 },
			fixtureNow,
		);
		assert.equal(
			selectedAging.items.some(
				(item) => item.invoiceId === otherCampusInvoiceId,
			),
			false,
		);

		for (const role of ["owner", "admin"] as const) {
			const organizationWide = await getBusinessMetricFinancial(
				{ ...selectedScope, role, campusAccess: { kind: "all" } },
				{ range },
				fixtureNow,
			);
			assert.equal(organizationWide.data.netReceiptsInCents, 190_000);
			assert.equal(organizationWide.dataQuality.missingFinancialFactCount, 1);
		}
		const campusManager = await getBusinessMetricFinancial(
			{ ...selectedScope, role: "campus_manager" },
			{ range },
			fixtureNow,
		);
		assert.equal(campusManager.data.netReceiptsInCents, 180_000);
		for (const role of ["consultant", "teacher"] as const) {
			await assert.rejects(
				getBusinessMetricFinancial(
					{ ...selectedScope, role },
					{ range },
					fixtureNow,
				),
				(error: unknown) =>
					error instanceof Error && error.message.includes("财务经营指标"),
			);
			await assert.rejects(
				getBusinessMetricFinancialDrilldown(
					{ ...selectedScope, role },
					{ range, limit: 1 },
					fixtureNow,
				),
				(error: unknown) =>
					error instanceof Error && error.message.includes("财务经营指标"),
			);
		}
	} finally {
		await cleanupMetricFixture(ids);
	}
});

test("顾问基准 4/5 样本边界及机构和校区范围保持隔离", async () => {
	const ids = createMetricFixtureIds();
	try {
		const { organizationA, organizationB, campusA, campusA2 } =
			await seedMetricFixture(ids);
		const fixtureNow = new Date("2026-08-20T04:00:00.000Z");
		const consultantScope = {
			organizationId: organizationA,
			userId: ids.users.consultantA,
			role: "consultant" as const,
			campusAccess: { kind: "selected" as const, campusIds: [campusA] },
		};
		const four = await getBusinessMetricSales(
			consultantScope,
			{
				range: { preset: "custom", from: "2026-07-01", to: "2026-07-08" },
			},
			fixtureNow,
		);
		const five = await getBusinessMetricSales(
			consultantScope,
			{
				range: { preset: "custom", from: "2026-07-01", to: "2026-08-01" },
			},
			fixtureNow,
		);
		const otherCampus = await getBusinessMetricSales(
			{
				...consultantScope,
				campusAccess: { kind: "selected", campusIds: [campusA2] },
			},
			{
				range: { preset: "custom", from: "2026-07-01", to: "2026-08-01" },
			},
			fixtureNow,
		);
		const otherOrganization = await getBusinessMetricSales(
			{
				...consultantScope,
				organizationId: organizationB,
				campusAccess: { kind: "all" },
			},
			{
				range: { preset: "custom", from: "2026-07-01", to: "2026-08-01" },
			},
			fixtureNow,
		);

		assert.equal(
			four.data.campusBenchmarkConversionRate.status,
			"notApplicable",
		);
		assert.equal(
			four.data.campusBenchmarkConversionRate.reason,
			"insufficientSample",
		);
		assert.equal(five.data.campusBenchmarkConversionRate.status, "available");
		assert.equal(five.data.campusBenchmarkConversionRate.denominator, 6);
		assert.equal(otherCampus.data.closedCycleCount, 0);
		assert.equal(otherOrganization.data.closedCycleCount, 0);
	} finally {
		await cleanupMetricFixture(ids);
	}
});

test("经营指标下钻重新执行角色范围并使用稳定游标", async () => {
	const ids = createMetricFixtureIds();
	try {
		const { organizationA, campusA } = await seedMetricFixture(ids);
		const fixtureNow = new Date("2026-08-20T04:00:00.000Z");
		const range = {
			preset: "custom" as const,
			from: "2026-07-01",
			to: "2026-08-01",
		};
		const baseScope = {
			organizationId: organizationA,
			campusAccess: { kind: "selected" as const, campusIds: [campusA] },
		};
		const firstPage = businessMetricDrilldownResultSchema.parse(
			await getBusinessMetricDrilldown(
				{ ...baseScope, userId: ids.users.owner, role: "owner" },
				{ range, kind: "salesCycles", limit: 1 },
				fixtureNow,
			),
		);
		assert.equal(firstPage.items.length, 1);
		assert.ok(firstPage.nextCursor);
		const secondPage = businessMetricDrilldownResultSchema.parse(
			await getBusinessMetricDrilldown(
				{ ...baseScope, userId: ids.users.owner, role: "owner" },
				{
					range,
					kind: "salesCycles",
					limit: 1,
					cursor: firstPage.nextCursor,
				},
				fixtureNow,
			),
		);
		assert.notEqual(secondPage.items[0]?.id, firstPage.items[0]?.id);

		const consultant = businessMetricDrilldownResultSchema.parse(
			await getBusinessMetricDrilldown(
				{
					...baseScope,
					userId: ids.users.consultantA,
					role: "consultant",
				},
				{ range, kind: "salesCycles", limit: 20 },
				fixtureNow,
			),
		);
		assert.equal(consultant.items.length, 5);
		assert.ok(
			consultant.items.every(
				(item) =>
					item.kind === "salesCycle" && item.attributionLabel === "本人",
			),
		);

		const teacherDrilldown = businessMetricDrilldownResultSchema.parse(
			await getBusinessMetricDrilldown(
				{ ...baseScope, userId: ids.users.teacher, role: "teacher" },
				{ range, kind: "attendanceLessons", limit: 20 },
				fixtureNow,
			),
		);
		assert.deepEqual(teacherDrilldown.items, [
			{
				kind: "attendanceLesson",
				id: requiredAt(ids.lessons, 0),
				occurredAt: "2026-06-30T16:30:00.000Z",
				present: 1,
				late: 1,
				absent: 1,
				leave: 1,
			},
		]);

		const renewalDrilldown = businessMetricDrilldownResultSchema.parse(
			await getBusinessMetricDrilldown(
				{ ...baseScope, userId: ids.users.owner, role: "owner" },
				{ range, kind: "renewalOpportunities", limit: 20 },
				fixtureNow,
			),
		);
		assert.deepEqual(
			new Set(
				renewalDrilldown.items.map((item) =>
					item.kind === "renewalOpportunity" ? item.status : "wrong",
				),
			),
			new Set(["succeeded", "unsucceeded", "immature"]),
		);

		await assert.rejects(
			getBusinessMetricDrilldown(
				{ ...baseScope, userId: ids.users.owner, role: "finance" },
				{ range, kind: "renewalOpportunities", limit: 20 },
				fixtureNow,
			),
			(error: unknown) =>
				error instanceof Error && error.message.includes("续费经营指标"),
		);
	} finally {
		await cleanupMetricFixture(ids);
	}
});
