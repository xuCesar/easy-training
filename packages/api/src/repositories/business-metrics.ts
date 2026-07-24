import {
	createAnalyticsSavedFilter,
	deleteAnalyticsSavedFilter,
	listAnalyticsSavedFilters,
	recordAnalyticsExport,
	updateAnalyticsSavedFilter,
} from "@easy-training/db/repositories/analytics-saved-filters";
import {
	type BusinessComparisonDimension,
	type BusinessComparisonResult,
	getBusinessComparisonRecords,
} from "@easy-training/db/repositories/business-comparison";
import {
	getBusinessMetricAttendanceRecord,
	getBusinessMetricConsumptionRecord,
	getBusinessMetricDrilldownRecords,
	getBusinessMetricRenewalRecord,
	getBusinessMetricSalesRecord,
} from "@easy-training/db/repositories/business-metrics";
import {
	getFinancialAgingInvoicePage,
	getFinancialAgingRecord,
	getFinancialCohortRecord,
	getFinancialMetricQuality,
	getFinancialReceiptEventPage,
	getFinancialReceiptRecord,
} from "@easy-training/db/repositories/financial-metrics";
import { getResourceUtilizationRecord } from "@easy-training/db/repositories/resource-metrics";
import { ORPCError } from "@orpc/server";
import {
	financeManagementRoles,
	type OrganizationRole,
} from "../authorization/training";
import {
	type AnalyticsReportConfig,
	type AnalyticsSavedFilterCreateInput,
	type AnalyticsSavedFilterUpdateInput,
	BUSINESS_METRIC_CONTRACT_VERSION,
	BUSINESS_METRIC_DEFINITION_VERSION,
	BUSINESS_METRIC_TIMEZONE,
	type BusinessMetricAttendanceResult,
	type BusinessMetricComparisonInput,
	type BusinessMetricComparisonResult,
	type BusinessMetricConsumptionResult,
	type BusinessMetricDataQuality,
	type BusinessMetricDrilldownInput,
	type BusinessMetricDrilldownResult,
	type BusinessMetricFinancialAgingDrilldownInput,
	type BusinessMetricFinancialAgingDrilldownResult,
	type BusinessMetricFinancialDrilldownInput,
	type BusinessMetricFinancialDrilldownResult,
	type BusinessMetricFinancialReceiptResult,
	type BusinessMetricFinancialResult,
	type BusinessMetricQueryInput,
	type BusinessMetricRatio,
	type BusinessMetricRenewalResult,
	type BusinessMetricResourceResult,
	type BusinessMetricSalesResult,
	FINANCIAL_METRIC_DEFINITION_VERSION,
} from "../contracts/business-metrics";
import {
	BusinessMetricRangeError,
	resolveBusinessMetricWindow,
} from "./business-metrics-time";
import { quoteCsv } from "./csv";

type BusinessMetricScope = {
	organizationId: string;
	userId: string;
	role: OrganizationRole;
	campusAccess: Parameters<
		typeof getBusinessMetricSalesRecord
	>[0]["scope"]["campusAccess"];
};

function toSavedFilter(
	item: Awaited<ReturnType<typeof listAnalyticsSavedFilters>>[number],
) {
	return {
		id: item.id,
		name: item.name,
		config: item.config as AnalyticsSavedFilterCreateInput["config"],
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
	};
}

function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	if ("code" in error && error.code === "23505") return true;
	return "cause" in error && isUniqueViolation(error.cause);
}

export async function listBusinessMetricSavedFilters(
	scope: BusinessMetricScope,
) {
	const items = await listAnalyticsSavedFilters({
		organizationId: scope.organizationId,
		userId: scope.userId,
	});
	return { items: items.map(toSavedFilter) };
}

export async function createBusinessMetricSavedFilter(
	scope: BusinessMetricScope,
	input: AnalyticsSavedFilterCreateInput,
) {
	assertReportConfigAccess(scope.role, input.config);
	try {
		return toSavedFilter(
			await createAnalyticsSavedFilter({
				...input,
				organizationId: scope.organizationId,
				userId: scope.userId,
			}),
		);
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new ORPCError("CONFLICT", {
				message: "同一分析视图下已存在该筛选名称。",
				cause: error,
			});
		}
		throw error;
	}
}

export async function updateBusinessMetricSavedFilter(
	scope: BusinessMetricScope,
	input: AnalyticsSavedFilterUpdateInput,
) {
	assertReportConfigAccess(scope.role, input.config);
	const updated = await updateAnalyticsSavedFilter({
		...input,
		organizationId: scope.organizationId,
		userId: scope.userId,
	});
	if (!updated)
		throw new ORPCError("NOT_FOUND", {
			message: "保存的筛选不存在或已无权访问。",
		});
	return toSavedFilter(updated);
}

export async function deleteBusinessMetricSavedFilter(
	scope: BusinessMetricScope,
	id: string,
) {
	const deleted = await deleteAnalyticsSavedFilter({
		id,
		organizationId: scope.organizationId,
		userId: scope.userId,
	});
	if (!deleted)
		throw new ORPCError("NOT_FOUND", {
			message: "保存的筛选不存在或已无权访问。",
		});
	return { id: deleted.id };
}

export async function exportBusinessMetrics(
	scope: BusinessMetricScope,
	config: AnalyticsReportConfig,
) {
	assertReportConfigAccess(scope.role, config);
	if (config.range.preset === "custom") {
		const durationInDays =
			(Date.parse(`${config.range.to}T00:00:00.000Z`) -
				Date.parse(`${config.range.from}T00:00:00.000Z`)) /
			(24 * 60 * 60 * 1000);
		if (durationInDays > 366) {
			throw new ORPCError("BAD_REQUEST", {
				message: "即时导出的自定义时间范围不能超过 366 天。",
			});
		}
	}
	const input = { range: config.range };
	const createCsv = (
		metadata: string[][],
		header: string[],
		row: Array<string | number | null>,
	) =>
		`\uFEFF${[...metadata, header, row].map((values) => values.map(quoteCsv).join(",")).join("\n")}`;
	const assertWithinLimit = (csv: string) => {
		if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) {
			throw new ORPCError("BAD_REQUEST", {
				message: "导出结果超过同步限制，请缩小筛选范围。",
			});
		}
	};
	const metadataFor = (result: {
		asOf: string;
		timezone: string;
		definitionVersion: string;
		range: { from: string; to: string };
	}) => [
		["生成时间", result.asOf],
		["时区", result.timezone],
		["指标版本", result.definitionVersion],
		["报告类型", config.reportKind],
		["查询开始", result.range.from],
		["查询结束（不含）", result.range.to],
	];
	const ratioValue = (value: BusinessMetricRatio) =>
		value.status === "available" ? value.value : "不适用";
	const recordExport = async (rowCount: number) => {
		await recordAnalyticsExport({
			organizationId: scope.organizationId,
			userId: scope.userId,
			reportKind: config.reportKind,
			rowCount,
		});
	};
	if (config.reportKind === "comparison") {
		const result = await getBusinessMetricComparison(scope, {
			...input,
			dimension: config.dimension,
			sortBy: config.sortBy,
			sortDirection: config.sortDirection,
		});
		const header = [
			"名称",
			"报名数",
			"课次数",
			"消课数",
			"到课率",
			"教师利用率",
			"课次上座率",
			"净回款",
		];
		const includeFinancial = financeManagementRoles.has(scope.role);
		const lines = [
			...metadataFor(result).map((row) => row.map(quoteCsv).join(",")),
			header
				.slice(0, includeFinancial ? undefined : -1)
				.map(quoteCsv)
				.join(","),
			...result.rows.map((row) =>
				[
					quoteCsv(row.label),
					quoteCsv(row.current.enrollmentCount),
					quoteCsv(row.current.lessonCount),
					quoteCsv(row.current.consumedLessonCount),
					quoteCsv(row.current.attendanceRate.value),
					quoteCsv(row.current.utilizationRate.value),
					quoteCsv(row.current.occupancyRate.value),
					...(includeFinancial
						? [quoteCsv(row.current.netReceiptsInCents)]
						: []),
				].join(","),
			),
		];
		const csv = `\uFEFF${lines.join("\n")}`;
		if (
			result.rows.length > 1000 ||
			Buffer.byteLength(csv, "utf8") > 1024 * 1024
		)
			throw new ORPCError("BAD_REQUEST", {
				message: "导出结果超过同步限制，请缩小筛选范围。",
			});
		await recordExport(result.rows.length);
		return { fileName: "经营对比.csv", csv, rowCount: result.rows.length };
	}
	if (config.reportKind === "overview") {
		if (scope.role === "finance")
			throw new ORPCError("FORBIDDEN", {
				message: "当前角色无权导出经营概览。",
			});
		const [sales, attendance, consumption, renewal] = await Promise.all([
			scope.role === "teacher" ? null : getBusinessMetricSales(scope, input),
			scope.role === "consultant"
				? null
				: getBusinessMetricAttendance(scope, input),
			scope.role === "consultant"
				? null
				: getBusinessMetricConsumption(scope, input),
			["owner", "admin", "campus_manager"].includes(scope.role)
				? getBusinessMetricRenewal(scope, input)
				: null,
		]);
		const base = sales ?? attendance ?? consumption ?? renewal;
		if (!base)
			throw new ORPCError("FORBIDDEN", {
				message: "当前角色无权导出经营概览。",
			});
		const csv = createCsv(
			metadataFor(base),
			["转化率", "已结案线索", "到课率", "消课课次", "续费率", "续费机会数"],
			[
				sales ? ratioValue(sales.data.conversionRate) : "不适用",
				sales?.data.closedCycleCount ?? "不适用",
				attendance ? ratioValue(attendance.data.attendanceRate) : "不适用",
				consumption?.data.consumedLessonCount ?? "不适用",
				renewal ? ratioValue(renewal.data.renewalRate) : "不适用",
				renewal?.data.opportunityCount ?? "不适用",
			],
		);
		assertWithinLimit(csv);
		await recordExport(1);
		return { fileName: "经营概览.csv", csv, rowCount: 1 };
	}
	if (scope.role === "consultant")
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权导出资源与财务分析。",
		});
	const [resource, financial] = await Promise.all([
		scope.role === "finance" ? null : getBusinessMetricResource(scope, input),
		scope.role === "teacher" ? null : getBusinessMetricFinancial(scope, input),
	]);
	const base = resource ?? financial;
	if (!base)
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权导出资源与财务分析。",
		});
	const csv = createCsv(
		metadataFor(base),
		[
			"实际教师利用率",
			"课次上座率",
			"已完成分钟",
			"净回款（分）",
			"回款率",
			"账龄应收（分）",
		],
		[
			resource ? ratioValue(resource.data.actualUtilizationRate) : "不适用",
			resource ? ratioValue(resource.data.lessonOccupancyRate) : "不适用",
			resource?.data.completedMinutes ?? "不适用",
			financial?.data.netReceiptsInCents ?? "不适用",
			financial ? ratioValue(financial.data.cohortCollectionRate) : "不适用",
			financial?.data.agingTotalInCents ?? "不适用",
		],
	);
	assertWithinLimit(csv);
	await recordExport(1);
	return { fileName: "资源与财务.csv", csv, rowCount: 1 };
}

function assertReportConfigAccess(
	role: OrganizationRole,
	config: AnalyticsReportConfig,
): void {
	if (config.reportKind === "overview") {
		if (role === "finance") {
			throw new ORPCError("FORBIDDEN", {
				message: "当前角色无权访问经营概览。",
			});
		}
		return;
	}
	if (config.reportKind === "comparison") {
		assertComparisonAccess(role, config.dimension);
		return;
	}
	if (role === "consultant") {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权访问资源与财务分析。",
		});
	}
}

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

function assertFinancialAccess(role: OrganizationRole): void {
	if (!financeManagementRoles.has(role)) {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权读取财务经营指标。",
		});
	}
}

async function withFinancialQueryErrors<T>(
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载财务经营指标，请稍后重试。",
		});
	}
}

export async function getBusinessMetricFinancialReceipts(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricFinancialReceiptResult> {
	assertFinancialAccess(scope.role);
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

export async function getBusinessMetricFinancial(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricFinancialResult> {
	assertFinancialAccess(scope.role);
	const { window, base } = envelope(scope, input, now);
	const repositoryScope = {
		organizationId: scope.organizationId,
		campusAccess: scope.campusAccess,
	};
	const range = {
		from: new Date(window.range.from),
		to: new Date(window.range.to),
	};
	const comparisonRange = {
		from: new Date(window.comparisonRange.from),
		to: new Date(window.comparisonRange.to),
	};
	const agingSnapshotAt = new Date(Math.min(range.to.getTime(), now.getTime()));
	const [
		receipt,
		comparisonReceipt,
		cohort,
		comparisonCohort,
		aging,
		quality,
		comparisonQuality,
	] = await withFinancialQueryErrors(() =>
		Promise.all([
			getFinancialReceiptRecord({
				scope: repositoryScope,
				...range,
				granularity: window.granularity,
			}),
			getFinancialReceiptRecord({
				scope: repositoryScope,
				...comparisonRange,
				granularity: window.granularity,
			}),
			getFinancialCohortRecord({
				scope: repositoryScope,
				...range,
				asOf: now,
			}),
			getFinancialCohortRecord({
				scope: repositoryScope,
				...comparisonRange,
				asOf: now,
			}),
			getFinancialAgingRecord({
				scope: repositoryScope,
				snapshotAt: agingSnapshotAt,
			}),
			getFinancialMetricQuality({
				scope: repositoryScope,
				...range,
			}),
			getFinancialMetricQuality({
				scope: repositoryScope,
				...comparisonRange,
			}),
		]),
	);
	const missingAttributionCount = Math.max(
		receipt.missingAttributionCount,
		quality.missingAttributionCount,
		comparisonQuality.missingAttributionCount,
		cohort.factCoverageMissingCount,
		comparisonCohort.factCoverageMissingCount,
		aging.missingFactCount,
	);
	return {
		...base,
		definitionVersion: FINANCIAL_METRIC_DEFINITION_VERSION,
		dataQuality: {
			missingAttributionCount:
				scope.campusAccess.kind === "all" ? missingAttributionCount : 0,
			missingNameSnapshotCount:
				scope.campusAccess.kind === "all"
					? quality.missingNameSnapshotCount +
						comparisonQuality.missingNameSnapshotCount
					: 0,
			missingFinancialFactCount:
				scope.campusAccess.kind === "all"
					? quality.missingFinancialFactCount +
						comparisonQuality.missingFinancialFactCount +
						cohort.factCoverageMissingCount +
						comparisonCohort.factCoverageMissingCount
					: 0,
			adjustmentChainAnomalyCount:
				cohort.adjustmentChainAnomalyCount +
				comparisonCohort.adjustmentChainAnomalyCount +
				aging.adjustmentChainAnomalyCount,
			chronologyAnomalyCount:
				cohort.chronologyAnomalyCount + comparisonCohort.chronologyAnomalyCount,
			settlementAnomalyCount:
				cohort.settlementAnomalyCount +
				comparisonCohort.settlementAnomalyCount +
				aging.negativeBalanceAnomalyCount,
			scopeCoverageIncomplete:
				scope.campusAccess.kind !== "all" &&
				(missingAttributionCount > 0 ||
					quality.missingFinancialFactCount > 0 ||
					comparisonQuality.missingFinancialFactCount > 0),
		},
		data: {
			paymentsInCents: receipt.paymentsInCents,
			reversalsInCents: receipt.reversalsInCents,
			refundsInCents: receipt.refundsInCents,
			netReceiptsInCents: receipt.netReceiptsInCents,
			comparisonNetReceiptsInCents: comparisonReceipt.netReceiptsInCents,
			trend: receipt.trend.map((point) => ({
				...point,
				bucketStart: new Date(point.bucketStart).toISOString(),
			})),
			cohortCollectionRate: ratio(
				cohort.numeratorInCents,
				cohort.denominatorInCents,
			),
			comparisonCohortCollectionRate: ratio(
				comparisonCohort.numeratorInCents,
				comparisonCohort.denominatorInCents,
			),
			matureCohortInvoiceCount: cohort.matureInvoiceCount,
			immatureCohortInvoiceCount: cohort.immatureInvoiceCount,
			zeroAmountCohortInvoiceCount: cohort.zeroAmountInvoiceCount,
			minimumRemainingObservationDays: cohort.minimumRemainingObservationDays,
			agingSnapshotAt: aging.snapshotAt.toISOString(),
			agingBuckets: aging.buckets,
			agingTotalInCents: aging.totalInCents,
		},
	};
}

export async function getBusinessMetricFinancialDrilldown(
	scope: BusinessMetricScope,
	input: BusinessMetricFinancialDrilldownInput,
	now = new Date(),
): Promise<BusinessMetricFinancialDrilldownResult> {
	assertFinancialAccess(scope.role);
	const { window, base } = envelope(scope, input, now);
	const [result, quality] = await withFinancialQueryErrors(() =>
		Promise.all([
			getFinancialReceiptEventPage({
				scope: {
					organizationId: scope.organizationId,
					campusAccess: scope.campusAccess,
				},
				from: new Date(window.range.from),
				to: new Date(window.range.to),
				limit: input.limit,
				cursor: input.cursor
					? {
							occurredAt: new Date(input.cursor.occurredAt),
							id: input.cursor.id,
						}
					: undefined,
			}),
			getFinancialMetricQuality({
				scope: {
					organizationId: scope.organizationId,
					campusAccess: scope.campusAccess,
				},
				from: new Date(window.range.from),
				to: new Date(window.range.to),
			}),
		]),
	);
	const isOrganizationWide = scope.campusAccess.kind === "all";
	return {
		...base,
		definitionVersion: FINANCIAL_METRIC_DEFINITION_VERSION,
		dataQuality: {
			missingAttributionCount: isOrganizationWide
				? quality.missingAttributionCount
				: 0,
			scopeCoverageIncomplete:
				!isOrganizationWide &&
				(quality.missingAttributionCount > 0 ||
					quality.missingFinancialFactCount > 0),
		},
		items: result.events.map((event) => ({
			kind: "financialEvent" as const,
			id: event.id,
			invoiceId: event.invoiceId,
			eventType: event.kind,
			amountInCents: event.amountInCents,
			signedAmountInCents:
				event.kind === "payment" ? event.amountInCents : -event.amountInCents,
			occurredAt: new Date(event.occurredAt).toISOString(),
			detailPath: `/finance/invoices/${event.invoiceId}`,
		})),
		nextCursor: result.nextCursor
			? {
					occurredAt: new Date(result.nextCursor.occurredAt).toISOString(),
					id: result.nextCursor.id,
				}
			: null,
	};
}

export async function getBusinessMetricFinancialAgingDrilldown(
	scope: BusinessMetricScope,
	input: BusinessMetricFinancialAgingDrilldownInput,
	now = new Date(),
): Promise<BusinessMetricFinancialAgingDrilldownResult> {
	assertFinancialAccess(scope.role);
	const { window, base } = envelope(scope, input, now);
	const snapshotAt = new Date(
		Math.min(new Date(window.range.to).getTime(), now.getTime()),
	);
	const [result, quality] = await withFinancialQueryErrors(() =>
		Promise.all([
			getFinancialAgingInvoicePage({
				scope: {
					organizationId: scope.organizationId,
					campusAccess: scope.campusAccess,
				},
				snapshotAt,
				limit: input.limit,
				cursor: input.cursor
					? {
							occurredAt: new Date(input.cursor.occurredAt),
							id: input.cursor.id,
						}
					: undefined,
			}),
			getFinancialMetricQuality({
				scope: {
					organizationId: scope.organizationId,
					campusAccess: scope.campusAccess,
				},
				from: new Date(window.range.from),
				to: new Date(window.range.to),
			}),
		]),
	);
	const isOrganizationWide = scope.campusAccess.kind === "all";
	return {
		...base,
		definitionVersion: FINANCIAL_METRIC_DEFINITION_VERSION,
		dataQuality: {
			missingAttributionCount: isOrganizationWide
				? quality.missingAttributionCount
				: 0,
			scopeCoverageIncomplete:
				!isOrganizationWide &&
				(quality.missingAttributionCount > 0 ||
					quality.missingFinancialFactCount > 0),
		},
		items: result.items.map((item) => ({
			kind: "financialAgingInvoice" as const,
			invoiceId: item.invoiceId,
			occurredAt: new Date(item.occurredAt).toISOString(),
			amountInCents: item.amountInCents,
			outstandingInCents: item.outstandingInCents,
			agingBucket: item.agingBucket,
			detailPath: `/finance/invoices/${item.invoiceId}`,
		})),
		nextCursor: result.nextCursor
			? {
					occurredAt: new Date(result.nextCursor.occurredAt).toISOString(),
					id: result.nextCursor.id,
				}
			: null,
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

function assertComparisonAccess(
	role: OrganizationRole,
	dimension: BusinessComparisonDimension,
): void {
	if (role === "finance") {
		throw new ORPCError("FORBIDDEN", {
			message: "当前角色无权查看该维度对比。",
		});
	}
	if (role === "consultant" && dimension !== "campus") {
		throw new ORPCError("FORBIDDEN", { message: "顾问仅可查看脱敏校区基准。" });
	}
	if (role === "teacher" && !["teacher", "class"].includes(dimension)) {
		throw new ORPCError("FORBIDDEN", { message: "教师仅可查看本人教学维度。" });
	}
}

function comparisonSortValue(
	row: BusinessComparisonResult["rows"][number],
	sortBy: BusinessMetricComparisonInput["sortBy"],
): number {
	const value = row.current;
	if (sortBy === "attendanceRate") return value.attendanceRate.value ?? -1;
	if (sortBy === "utilizationRate") return value.utilizationRate.value ?? -1;
	if (sortBy === "occupancyRate") return value.occupancyRate.value ?? -1;
	return value[sortBy];
}

function anonymizeConsultantRows(
	rows: BusinessComparisonResult["rows"],
): BusinessComparisonResult["rows"] {
	if (rows.length === 0) return [];
	const mergeValues = (
		items: BusinessComparisonResult["rows"],
		selector: (
			row: BusinessComparisonResult["rows"][number],
		) => BusinessComparisonResult["rows"][number]["current"],
	) => {
		const values = items.map(selector);
		const numerator = (
			key: "attendanceRate" | "utilizationRate" | "occupancyRate",
		) => values.reduce((sum, value) => sum + value[key].numerator, 0);
		const denominator = (
			key: "attendanceRate" | "utilizationRate" | "occupancyRate",
		) => values.reduce((sum, value) => sum + value[key].denominator, 0);
		const first = values[0];
		if (!first) return null;
		const merged = { ...first };
		for (const key of [
			"enrollmentCount",
			"enrollmentAmountInCents",
			"lessonCount",
			"completedLessonCount",
			"consumedLessonCount",
			"completedMinutes",
			"plannedMinutes",
			"netReceiptsInCents",
			"activeSeatCount",
			"capacity",
		] as const) {
			merged[key] = values.reduce((sum, value) => sum + value[key], 0);
		}
		for (const key of [
			"attendanceRate",
			"utilizationRate",
			"occupancyRate",
		] as const) {
			const n = numerator(key);
			const d = denominator(key);
			merged[key] =
				d > 0
					? { status: "available", value: n / d, numerator: n, denominator: d }
					: {
							status: "notApplicable",
							value: null,
							numerator: n,
							denominator: d,
							reason: "noDenominator",
						};
		}
		merged.capacityConfigured = values.some(
			(value) => value.capacityConfigured,
		);
		merged.dataCoverageIncomplete = values.some(
			(value) => value.dataCoverageIncomplete,
		);
		return merged;
	};
	const current = mergeValues(rows, (row) => row.current);
	const comparison = mergeValues(rows, (row) => row.comparison);
	if (!current || !comparison) return [];
	return [
		{
			id: "consultant-campus-benchmark",
			label: "授权校区脱敏基准",
			campusId: null,
			sampleSmall: current.enrollmentCount > 0 && current.enrollmentCount < 5,
			detailPath: null,
			current,
			comparison,
		},
	];
}

export async function getBusinessMetricComparison(
	scope: BusinessMetricScope,
	input: BusinessMetricComparisonInput,
	now = new Date(),
): Promise<BusinessMetricComparisonResult> {
	assertComparisonAccess(scope.role, input.dimension);
	const { window, base } = envelope(scope, input, now);
	try {
		const result = await getBusinessComparisonRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			dimension: input.dimension,
			teacherUserId: scope.role === "teacher" ? scope.userId : undefined,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			comparisonFrom: new Date(window.comparisonRange.from),
			comparisonTo: new Date(window.comparisonRange.to),
		});
		const rows =
			scope.role === "consultant"
				? anonymizeConsultantRows(result.rows)
				: [...result.rows].sort((a, b) => {
						const difference =
							comparisonSortValue(a, input.sortBy) -
							comparisonSortValue(b, input.sortBy);
						return input.sortDirection === "asc" ? difference : -difference;
					});
		const visibleRows = financeManagementRoles.has(scope.role)
			? rows
			: rows.map((row) => ({
					...row,
					current: {
						...row.current,
						enrollmentAmountInCents: 0,
						netReceiptsInCents: 0,
					},
					comparison: {
						...row.comparison,
						enrollmentAmountInCents: 0,
						netReceiptsInCents: 0,
					},
				}));
		return {
			...base,
			dimension: input.dimension,
			dataQuality: {
				missingFinancialFactCount: result.missingFinancialFactCount,
				unlinkedDimensionCount: result.unlinkedDimensionCount,
				scopeCoverageIncomplete: result.scopeCoverageIncomplete,
			},
			rows: visibleRows,
		};
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载经营对比，请稍后重试。",
		});
	}
}

export const businessMetricDefinitionRegistry = {
	sales: getBusinessMetricSales,
	attendance: getBusinessMetricAttendance,
	consumption: getBusinessMetricConsumption,
	renewal: getBusinessMetricRenewal,
	resource: getBusinessMetricResource,
	financial: getBusinessMetricFinancial,
	comparison: getBusinessMetricComparison,
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

export async function getBusinessMetricResource(
	scope: BusinessMetricScope,
	input: BusinessMetricQueryInput,
	now = new Date(),
): Promise<BusinessMetricResourceResult> {
	assertTeachingAccess(scope.role);
	const { window, repositoryScope, base } = envelope(scope, input, now);
	try {
		const record = await getResourceUtilizationRecord({
			scope: repositoryScope,
			from: new Date(window.range.from),
			to: new Date(window.range.to),
			asOf: now,
		});
		return {
			...base,
			dataQuality: {
				missingTeacherCapacityCount: record.capacityCoverageMissingTeacherCount,
				partialTeacherCapacityCount: record.capacityCoveragePartialTeacherCount,
				missingLessonCapacityCount: record.capacityCoverageMissingLessonCount,
			},
			data: {
				actualUtilizationRate: ratio(
					record.completedMinutes,
					record.actualCapacityMinutes,
				),
				plannedUtilizationRate: ratio(
					record.plannedMinutes,
					record.plannedCapacityMinutes,
				),
				classCapacityUtilizationRate: ratio(
					record.activeSeatCount,
					record.classCapacity,
				),
				lessonOccupancyRate: ratio(
					record.lessonOccupancyNumerator,
					record.lessonOccupancyDenominator,
				),
				completedMinutes: record.completedMinutes,
				plannedMinutes: record.plannedMinutes,
				cancelledMinutes: record.cancelledMinutes,
				actualCapacityMinutes: record.actualCapacityMinutes,
				plannedCapacityMinutes: record.plannedCapacityMinutes,
				activeSeatCount: record.activeSeatCount,
				classCapacity: record.classCapacity,
				fullClassCount: record.fullClassCount,
				nearFullClassCount: record.nearFullClassCount,
				eligibleClassCount: record.eligibleClassCount,
			},
		};
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载资源利用指标，请稍后重试。",
		});
	}
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
