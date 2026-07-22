import {
	getBusinessMetricAttendanceRecord,
	getBusinessMetricConsumptionRecord,
	getBusinessMetricDrilldownRecords,
	getBusinessMetricRenewalRecord,
	getBusinessMetricSalesRecord,
} from "@easy-training/db/repositories/business-metrics";
import { getFinancialReceiptRecord } from "@easy-training/db/repositories/financial-metrics";
import { ORPCError } from "@orpc/server";

import type { OrganizationRole } from "../authorization/training";
import {
	BUSINESS_METRIC_CONTRACT_VERSION,
	BUSINESS_METRIC_DEFINITION_VERSION,
	BUSINESS_METRIC_TIMEZONE,
	type BusinessMetricAttendanceResult,
	type BusinessMetricConsumptionResult,
	type BusinessMetricDataQuality,
	type BusinessMetricDrilldownInput,
	type BusinessMetricDrilldownResult,
	type BusinessMetricFinancialReceiptResult,
	type BusinessMetricQueryInput,
	type BusinessMetricRatio,
	type BusinessMetricRenewalResult,
	type BusinessMetricSalesResult,
	FINANCIAL_METRIC_DEFINITION_VERSION,
} from "../contracts/business-metrics";
import {
	BusinessMetricRangeError,
	resolveBusinessMetricWindow,
} from "./business-metrics-time";

type BusinessMetricScope = {
	organizationId: string;
	userId: string;
	role: OrganizationRole;
	campusAccess: Parameters<
		typeof getBusinessMetricSalesRecord
	>[0]["scope"]["campusAccess"];
};

const emptyDataQuality = (): BusinessMetricDataQuality => ({
	missingAttributionCount: 0,
	missingMilestoneHistoryCount: 0,
	missingPurchaseCycleCount: 0,
	immatureCohortCount: 0,
	lateConsumptionCount: 0,
	insufficientSampleCount: 0,
});

function ratio(numerator: number, denominator: number): BusinessMetricRatio {
	if (denominator === 0) {
		return {
			status: "notApplicable",
			value: null,
			numerator,
			denominator,
			reason: "noDenominator",
		};
	}
	return {
		status: "available",
		value: numerator / denominator,
		numerator,
		denominator,
	};
}

function insufficientSampleRatio(
	numerator: number,
	denominator: number,
): BusinessMetricRatio {
	return {
		status: "notApplicable",
		value: null,
		numerator,
		denominator,
		reason: "insufficientSample",
	};
}

function immatureCohortRatio(
	numerator: number,
	denominator: number,
): BusinessMetricRatio {
	return {
		status: "notApplicable",
		value: null,
		numerator,
		denominator,
		reason: "immatureCohort",
	};
}

function resolveWindow(input: BusinessMetricQueryInput, now: Date) {
	try {
		return resolveBusinessMetricWindow(input.range, now);
	} catch (error) {
		if (error instanceof BusinessMetricRangeError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
}

function assertSalesAccess(role: OrganizationRole): void {
	if (role === "finance" || role === "teacher") {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权读取招生经营指标。",
		});
	}
}

function assertTeachingAccess(role: OrganizationRole): void {
	if (role === "finance" || role === "consultant") {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权读取教学经营指标。",
		});
	}
}

function assertRenewalAccess(role: OrganizationRole): void {
	if (role === "finance" || role === "consultant" || role === "teacher") {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权读取续费经营指标。",
		});
	}
}

export async function getBusinessMetricFinancialReceipts(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricFinancialReceiptResult> {
	if (
		scope.role !== "owner" &&
		scope.role !== "admin" &&
		scope.role !== "campus_manager" &&
		scope.role !== "finance"
	) {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权读取财务经营指标。",
		});
	}
	const { window, base } = envelope(scope, input, now);
	const recordInput = {
		scope: {
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
		},
		granularity: window.granularity,
	};
	const [record, comparison] = await Promise.all([
		getFinancialReceiptRecord({
			...recordInput,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
		}),
		getFinancialReceiptRecord({
			...recordInput,
			from: new Date(window.comparisonRange.from),
			to: new Date(window.comparisonRange.to),
		}),
	]);
	return {
		...base,
		definitionVersion: FINANCIAL_METRIC_DEFINITION_VERSION,
		dataQuality: {
			missingAttributionCount: record.missingAttributionCount,
			scopeCoverageIncomplete:
				scope.campusAccess.kind !== "all" && record.missingAttributionCount > 0,
		},
		data: {
			paymentsInCents: record.paymentsInCents,
			reversalsInCents: record.reversalsInCents,
			refundsInCents: record.refundsInCents,
			netReceiptsInCents: record.netReceiptsInCents,
			comparisonNetReceiptsInCents: comparison.netReceiptsInCents,
			trend: record.trend.map((point) => ({
				...point,
				bucketStart: new Date(point.bucketStart).toISOString(),
			})),
		},
	};
}

export async function getBusinessMetricSales(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricSalesResult> {
	assertSalesAccess(scope.role);
	const window = resolveWindow(input, now);
	try {
		const recordInput = {
			scope: {
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				consultantUserId:
					scope.role === "consultant" ? scope.userId : undefined,
			},
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			asOf: now,
		};
		const [record, comparisonRecord, campusBenchmark] = await Promise.all([
			getBusinessMetricSalesRecord(recordInput),
			getBusinessMetricSalesRecord({
				...recordInput,
				from: new Date(window.comparisonRange.from),
				to: new Date(window.comparisonRange.to),
			}),
			scope.role === "consultant"
				? getBusinessMetricSalesRecord({
						...recordInput,
						scope: {
							organizationId: scope.organizationId,
							campusAccess: scope.campusAccess,
						},
					})
				: Promise.resolve(null),
		]);
		const closedCycleCount = record.convertedCycleCount + record.lostCycleCount;
		const comparisonClosedCycleCount =
			comparisonRecord.convertedCycleCount + comparisonRecord.lostCycleCount;
		return {
			contractVersion: BUSINESS_METRIC_CONTRACT_VERSION,
			definitionVersion: BUSINESS_METRIC_DEFINITION_VERSION,
			timezone: BUSINESS_METRIC_TIMEZONE,
			asOf: now.toISOString(),
			...window,
			dataQuality: {
				...emptyDataQuality(),
				missingAttributionCount: record.missingAttributionCount,
				missingMilestoneHistoryCount: record.missingMilestoneHistoryCount,
				immatureCohortCount: record.immatureCohortCount,
				insufficientSampleCount:
					scope.role === "consultant" &&
					(campusBenchmark?.convertedCycleCount ?? 0) +
						(campusBenchmark?.lostCycleCount ?? 0) <
						5
						? 1
						: 0,
			},
			data: {
				conversionRate: ratio(record.convertedCycleCount, closedCycleCount),
				comparisonConversionRate: ratio(
					comparisonRecord.convertedCycleCount,
					comparisonClosedCycleCount,
				),
				campusBenchmarkConversionRate: campusBenchmark
					? campusBenchmark.convertedCycleCount +
							campusBenchmark.lostCycleCount >=
						5
						? ratio(
								campusBenchmark.convertedCycleCount,
								campusBenchmark.convertedCycleCount +
									campusBenchmark.lostCycleCount,
							)
						: insufficientSampleRatio(
								campusBenchmark.convertedCycleCount,
								campusBenchmark.convertedCycleCount +
									campusBenchmark.lostCycleCount,
							)
					: ratio(record.convertedCycleCount, closedCycleCount),
				closedCycleCount,
				openCycleCount: record.openCycleCount,
				createdLeadCount: record.createdLeadCount,
				contactedLeadCount: record.contactedLeadCount,
				trialBookedLeadCount: record.trialBookedLeadCount,
				convertedLeadCount: record.convertedLeadCount,
				lostLeadCount: record.lostLeadCount,
				directEnrollmentCount: record.directEnrollmentCount,
				directEnrollmentAmountInCents: record.directEnrollmentAmountInCents,
			},
		};
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载招生经营指标，请稍后重试。",
		});
	}
}

export const businessMetricDefinitionRegistry = {
	sales: getBusinessMetricSales,
	attendance: getBusinessMetricAttendance,
	consumption: getBusinessMetricConsumption,
	renewal: getBusinessMetricRenewal,
	drilldown: getBusinessMetricDrilldown,
} as const;

function envelope(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now: Date,
) {
	const window = resolveWindow(input, now);
	return {
		window,
		repositoryScope: {
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			teacherUserId: scope.role === "teacher" ? scope.userId : undefined,
		},
		base: {
			contractVersion: BUSINESS_METRIC_CONTRACT_VERSION,
			definitionVersion: BUSINESS_METRIC_DEFINITION_VERSION,
			timezone: BUSINESS_METRIC_TIMEZONE,
			asOf: now.toISOString(),
			...window,
		},
	};
}

export async function getBusinessMetricAttendance(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricAttendanceResult> {
	assertTeachingAccess(scope.role);
	const { window, repositoryScope, base } = envelope(scope, input, now);
	const [record, comparisonRecord] = await Promise.all([
		getBusinessMetricAttendanceRecord({
			scope: repositoryScope,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
		}),
		getBusinessMetricAttendanceRecord({
			scope: repositoryScope,
			from: new Date(window.comparisonRange.from),
			to: new Date(window.comparisonRange.to),
		}),
	]);
	const denominator =
		record.present + record.late + record.absent + record.leave;
	const makeupDenominator =
		record.fulfilledMakeup +
		record.pendingMakeup +
		record.needsRescheduleMakeup;
	const comparisonDenominator =
		comparisonRecord.present +
		comparisonRecord.late +
		comparisonRecord.absent +
		comparisonRecord.leave;
	return {
		...base,
		dataQuality: emptyDataQuality(),
		data: {
			attendanceRate: ratio(record.present + record.late, denominator),
			comparisonAttendanceRate: ratio(
				comparisonRecord.present + comparisonRecord.late,
				comparisonDenominator,
			),
			lateRate: ratio(record.late, denominator),
			leaveRate: ratio(record.leave, denominator),
			absenceRate: ratio(record.absent, denominator),
			makeupCompletionRate: ratio(record.fulfilledMakeup, makeupDenominator),
			pendingMakeupCount: record.pendingMakeup,
			needsRescheduleMakeupCount: record.needsRescheduleMakeup,
		},
	};
}

export async function getBusinessMetricConsumption(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricConsumptionResult> {
	assertTeachingAccess(scope.role);
	const { window, repositoryScope, base } = envelope(scope, input, now);
	const [record, comparisonRecord] = await Promise.all([
		getBusinessMetricConsumptionRecord({
			scope: repositoryScope,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			granularity: window.granularity,
		}),
		getBusinessMetricConsumptionRecord({
			scope: repositoryScope,
			from: new Date(window.comparisonRange.from),
			to: new Date(window.comparisonRange.to),
			granularity: window.granularity,
		}),
	]);
	return {
		...base,
		dataQuality: {
			...emptyDataQuality(),
			lateConsumptionCount: record.lateConsumptionCount,
		},
		data: {
			consumedLessonCount: record.consumedLessonCount,
			comparisonConsumedLessonCount: comparisonRecord.consumedLessonCount,
			trend: record.trend.map((point) => ({
				bucketStart: new Date(point.bucketStart).toISOString(),
				value: point.value,
			})),
		},
	};
}

export async function getBusinessMetricRenewal(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricRenewalResult> {
	assertRenewalAccess(scope.role);
	const { window, base } = envelope(scope, input, now);
	const [record, comparisonRecord] = await Promise.all([
		getBusinessMetricRenewalRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			asOf: now,
		}),
		getBusinessMetricRenewalRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			from: new Date(window.comparisonRange.from),
			to: new Date(window.comparisonRange.to),
			asOf: now,
		}),
	]);
	const matureCount =
		record.succeededOpportunityCount + record.unsucceededOpportunityCount;
	const comparisonMatureCount =
		comparisonRecord.succeededOpportunityCount +
		comparisonRecord.unsucceededOpportunityCount;
	return {
		...base,
		dataQuality: {
			...emptyDataQuality(),
			missingPurchaseCycleCount: record.missingPurchaseCycleCount,
			immatureCohortCount: record.immatureOpportunityCount,
		},
		data: {
			renewalRate: ratio(record.succeededOpportunityCount, matureCount),
			comparisonRenewalRate:
				comparisonRecord.immatureOpportunityCount > 0
					? immatureCohortRatio(
							comparisonRecord.succeededOpportunityCount,
							comparisonMatureCount,
						)
					: ratio(
							comparisonRecord.succeededOpportunityCount,
							comparisonMatureCount,
						),
			opportunityCount: record.opportunityCount,
			succeededOpportunityCount: record.succeededOpportunityCount,
			unsucceededOpportunityCount: record.unsucceededOpportunityCount,
			immatureOpportunityCount: record.immatureOpportunityCount,
			minimumRemainingObservationDays: record.minimumRemainingObservationDays,
			earlyRenewalCount: record.earlyRenewalCount,
			renewalAmountInCents: record.renewalAmountInCents,
			renewalLessonCount: record.renewalLessonCount,
		},
	};
}

export async function getBusinessMetricDrilldown(
	scope: BusinessMetricScope,
	input: BusinessMetricDrilldownInput,
	now = new Date(),
): Promise<BusinessMetricDrilldownResult> {
	if (input.kind === "salesCycles") assertSalesAccess(scope.role);
	if (
		input.kind === "attendanceLessons" ||
		input.kind === "consumptionLessons"
	) {
		assertTeachingAccess(scope.role);
	}
	if (input.kind === "renewalOpportunities") assertRenewalAccess(scope.role);
	const { window, base } = envelope(scope, input, now);
	try {
		const result = await getBusinessMetricDrilldownRecords({
			kind: input.kind,
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			consultantUserId: scope.role === "consultant" ? scope.userId : undefined,
			teacherUserId: scope.role === "teacher" ? scope.userId : undefined,
			includeAttributionNames:
				scope.role === "owner" ||
				scope.role === "admin" ||
				scope.role === "campus_manager",
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			asOf: now,
			limit: input.limit,
			cursor: input.cursor
				? {
						occurredAt: new Date(input.cursor.occurredAt),
						id: input.cursor.id,
					}
				: undefined,
		});
		return {
			...base,
			dataQuality: emptyDataQuality(),
			items: result.items.map((item) => ({
				...item,
				occurredAt: new Date(item.occurredAt).toISOString(),
			})),
			nextCursor: result.nextCursor
				? {
						occurredAt: new Date(result.nextCursor.occurredAt).toISOString(),
						id: result.nextCursor.id,
					}
				: null,
		};
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载经营指标明细，请稍后重试。",
		});
	}
}
