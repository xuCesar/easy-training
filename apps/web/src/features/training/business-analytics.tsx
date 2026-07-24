import type {
	AnalyticsReportConfig,
	BusinessMetricAttendanceResult,
	BusinessMetricComparisonDimension,
	BusinessMetricComparisonInput,
	BusinessMetricComparisonResult,
	BusinessMetricConsumptionResult,
	BusinessMetricDrilldownInput,
	BusinessMetricDrilldownKind,
	BusinessMetricDrilldownResult,
	BusinessMetricFinancialResult,
	BusinessMetricQueryInput,
	BusinessMetricRatio,
	BusinessMetricRenewalResult,
	BusinessMetricResourceResult,
	BusinessMetricSalesResult,
} from "@easy-training/api/contracts/business-metrics";
import { Button } from "@easy-training/ui/components/button";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/utils/orpc";
import { formatCentsToCurrency, formatDateTime } from "./format";
import { useOrganization } from "./organization-context";

type Preset = Exclude<BusinessMetricQueryInput["range"]["preset"], "custom">;
type RangeMode = Preset | "custom";
type AnalyticsTab = "overview" | "comparison" | "resource-finance";

const presetLabels: Record<Preset, string> = {
	last7Days: "最近 7 天",
	last30Days: "最近 30 天",
	last90Days: "最近 90 天",
	month: "本月",
	quarter: "本季度",
	year: "本年度",
};
const rangeOptions: Array<{ value: RangeMode; label: string }> = [
	...Object.entries(presetLabels).map(([value, label]) => ({
		value: value as Preset,
		label,
	})),
	{ value: "custom", label: "自定义" },
];
const savedFilterPlaceholderValue = "__empty_saved_filter__";

const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
const defaultCustomFrom = `${shanghaiNow.getUTCFullYear()}-${String(shanghaiNow.getUTCMonth() + 1).padStart(2, "0")}-01`;
const defaultCustomTo = new Date(shanghaiNow.getTime() + 24 * 60 * 60 * 1000)
	.toISOString()
	.slice(0, 10);

export function BusinessAnalytics() {
	const { organization } = useOrganization();
	const queryClient = useQueryClient();
	const [filterName, setFilterName] = useState("");
	const [selectedFilterId, setSelectedFilterId] = useState("");
	const [rangeMode, setRangeMode] = useState<RangeMode>("month");
	const [activeTab, setActiveTab] = useState<AnalyticsTab>(
		organization.role === "finance" ? "resource-finance" : "overview",
	);
	const [comparisonDimension, setComparisonDimension] =
		useState<BusinessMetricComparisonDimension>(
			organization.role === "teacher" ? "teacher" : "campus",
		);
	const [comparisonSortBy, setComparisonSortBy] =
		useState<BusinessMetricComparisonInput["sortBy"]>("enrollmentCount");
	const [customFrom, setCustomFrom] = useState(defaultCustomFrom);
	const [customTo, setCustomTo] = useState(defaultCustomTo);
	const customRangeValid = customFrom.length > 0 && customTo > customFrom;
	const input: BusinessMetricQueryInput = {
		range:
			rangeMode === "custom"
				? { preset: "custom", from: customFrom, to: customTo }
				: { preset: rangeMode },
	};
	const rangeEnabled = rangeMode !== "custom" || customRangeValid;
	const canViewSales = [
		"owner",
		"admin",
		"campus_manager",
		"consultant",
	].includes(organization.role);
	const canViewTeaching = [
		"owner",
		"admin",
		"campus_manager",
		"teacher",
	].includes(organization.role);
	const canViewRenewal = ["owner", "admin", "campus_manager"].includes(
		organization.role,
	);
	const canViewFinancial = [
		"owner",
		"admin",
		"campus_manager",
		"finance",
	].includes(organization.role);
	const canViewResource = [
		"owner",
		"admin",
		"campus_manager",
		"teacher",
	].includes(organization.role);
	const canViewComparison = [
		"owner",
		"admin",
		"campus_manager",
		"consultant",
		"teacher",
	].includes(organization.role);
	const comparisonDimensions: BusinessMetricComparisonDimension[] =
		organization.role === "consultant"
			? ["campus"]
			: organization.role === "teacher"
				? ["teacher", "class"]
				: ["campus", "course", "teacher", "class"];
	const effectiveComparisonDimension = comparisonDimensions.includes(
		comparisonDimension,
	)
		? comparisonDimension
		: (comparisonDimensions[0] ?? "campus");
	const visibleTabs: AnalyticsTab[] =
		organization.role === "finance"
			? ["resource-finance"]
			: [
					"overview",
					...(canViewComparison ? ["comparison" as const] : []),
					...(canViewFinancial || canViewResource
						? ["resource-finance" as const]
						: []),
				];
	const comparisonInput: BusinessMetricComparisonInput = {
		range: input.range,
		dimension: effectiveComparisonDimension,
		sortBy: comparisonSortBy,
		sortDirection: "desc",
	};
	const reportConfig: AnalyticsReportConfig =
		activeTab === "comparison"
			? {
					reportKind: "comparison",
					range: input.range,
					dimension: effectiveComparisonDimension,
					sortBy: comparisonSortBy,
					sortDirection: "desc",
				}
			: {
					reportKind: activeTab === "overview" ? "overview" : "resourceFinance",
					range: input.range,
				};
	const savedFilters = useQuery({
		...orpc.training.analytics.savedFilters.list.queryOptions(),
	});
	const invalidateSavedFilters = () =>
		void queryClient.invalidateQueries({
			queryKey: orpc.training.analytics.savedFilters.list.queryKey(),
		});
	const saveFilter = useMutation({
		...orpc.training.analytics.savedFilters.create.mutationOptions(),
		onSuccess: () => {
			setFilterName("");
			invalidateSavedFilters();
		},
	});
	const deleteFilter = useMutation({
		...orpc.training.analytics.savedFilters.delete.mutationOptions(),
		onSuccess: () => {
			setSelectedFilterId("");
			invalidateSavedFilters();
		},
	});
	const renameFilter = useMutation({
		...orpc.training.analytics.savedFilters.update.mutationOptions(),
		onSuccess: () => {
			setFilterName("");
			invalidateSavedFilters();
		},
	});
	const exportCsv = useMutation({
		...orpc.training.analytics.export.mutationOptions(),
		onSuccess: ({ csv, fileName }) => {
			const url = URL.createObjectURL(
				new Blob([csv], { type: "text/csv;charset=utf-8" }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			anchor.click();
			URL.revokeObjectURL(url);
		},
	});
	function applySavedFilter(id: string) {
		const saved = savedFilters.data?.items.find((item) => item.id === id);
		if (!saved) return;
		setSelectedFilterId(id);
		if (saved.config.reportKind === "comparison") {
			setActiveTab("comparison");
			setComparisonDimension(saved.config.dimension);
			setComparisonSortBy(saved.config.sortBy);
		} else
			setActiveTab(
				saved.config.reportKind === "overview"
					? "overview"
					: "resource-finance",
			);
		if (saved.config.range.preset === "custom") {
			setRangeMode("custom");
			setCustomFrom(saved.config.range.from);
			setCustomTo(saved.config.range.to);
		} else setRangeMode(saved.config.range.preset);
	}
	const sales = useQuery({
		...orpc.training.analytics.sales.queryOptions({ input }),
		enabled: canViewSales && activeTab === "overview" && rangeEnabled,
	});
	const attendance = useQuery({
		...orpc.training.analytics.attendance.queryOptions({ input }),
		enabled: canViewTeaching && activeTab === "overview" && rangeEnabled,
	});
	const consumption = useQuery({
		...orpc.training.analytics.consumption.queryOptions({ input }),
		enabled: canViewTeaching && activeTab === "overview" && rangeEnabled,
	});
	const renewal = useQuery({
		...orpc.training.analytics.renewal.queryOptions({ input }),
		enabled: canViewRenewal && activeTab === "overview" && rangeEnabled,
	});
	const comparison = useQuery({
		...orpc.training.analytics.comparison.queryOptions({
			input: comparisonInput,
		}),
		enabled: canViewComparison && activeTab === "comparison" && rangeEnabled,
	});
	const resource = useQuery({
		...orpc.training.analytics.resource.queryOptions({ input }),
		enabled:
			canViewResource && activeTab === "resource-finance" && rangeEnabled,
	});
	const financial = useQuery({
		...orpc.training.analytics.financial.queryOptions({ input }),
		enabled:
			canViewFinancial && activeTab === "resource-finance" && rangeEnabled,
	});
	const visibleQueries = [
		activeTab === "overview" && canViewSales ? sales : null,
		activeTab === "overview" && canViewTeaching ? attendance : null,
		activeTab === "overview" && canViewTeaching ? consumption : null,
		activeTab === "overview" && canViewRenewal ? renewal : null,
		activeTab === "comparison" && canViewComparison ? comparison : null,
		activeTab === "resource-finance" && canViewResource ? resource : null,
		activeTab === "resource-finance" && canViewFinancial ? financial : null,
	].filter((query) => query !== null);
	const pending = visibleQueries.some((query) => query.isPending);
	const failed = visibleQueries.find((query) => query.isError);
	const asOf =
		sales.data?.asOf ??
		attendance.data?.asOf ??
		consumption.data?.asOf ??
		renewal.data?.asOf ??
		comparison.data?.asOf ??
		resource.data?.asOf ??
		financial.data?.asOf;
	const definitionVersion =
		sales.data?.definitionVersion ??
		attendance.data?.definitionVersion ??
		consumption.data?.definitionVersion ??
		renewal.data?.definitionVersion ??
		comparison.data?.definitionVersion ??
		resource.data?.definitionVersion ??
		financial.data?.definitionVersion;

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-muted-foreground text-sm">经营分析</p>
					<h1 className="mt-1 font-semibold text-2xl">核心经营指标</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						统一查看招生、教学消耗与续费机会，不再人工汇总。
					</p>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<label className="grid gap-1 text-sm" htmlFor="analytics-range">
						<span className="text-muted-foreground">统计范围</span>
						<FilterSelect
							id="analytics-range"
							value={rangeMode}
							onValueChange={(value) => setRangeMode(value as RangeMode)}
							items={rangeOptions}
						/>
					</label>
					{rangeMode === "custom" ? (
						<>
							<label className="grid gap-1 text-sm" htmlFor="analytics-from">
								<span className="text-muted-foreground">开始日期</span>
								<Input
									id="analytics-from"
									type="date"
									className="min-w-40"
									value={customFrom}
									onChange={(event) => setCustomFrom(event.target.value)}
								/>
							</label>
							<label className="grid gap-1 text-sm" htmlFor="analytics-to">
								<span className="text-muted-foreground">结束日期（不含）</span>
								<Input
									id="analytics-to"
									type="date"
									className="min-w-40"
									value={customTo}
									onChange={(event) => setCustomTo(event.target.value)}
								/>
							</label>
						</>
					) : null}
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<label className="grid gap-1 text-sm" htmlFor="analytics-filter-name">
						<span className="text-muted-foreground">保存筛选</span>
						<Input
							id="analytics-filter-name"
							className="min-w-48"
							value={filterName}
							onChange={(event) => setFilterName(event.target.value)}
							placeholder="筛选名称"
						/>
					</label>
					<Button
						disabled={!filterName.trim() || saveFilter.isPending}
						onClick={() =>
							saveFilter.mutate({ name: filterName, config: reportConfig })
						}
					>
						保存
					</Button>
					<Button
						variant="outline"
						disabled={exportCsv.isPending || !rangeEnabled}
						onClick={() => exportCsv.mutate({ config: reportConfig })}
					>
						导出 CSV
					</Button>
				</div>
			</header>
			<div className="flex flex-wrap items-center gap-2 border p-3 text-sm">
				<FilterSelect
					ariaLabel="应用已保存筛选"
					value={selectedFilterId || savedFilterPlaceholderValue}
					onValueChange={(value) =>
						applySavedFilter(value === savedFilterPlaceholderValue ? "" : value)
					}
					items={[
						{
							value: savedFilterPlaceholderValue,
							label: "应用已保存筛选",
						},
						...(savedFilters.data?.items ?? []).map((item) => ({
							value: item.id,
							label: item.name,
						})),
					]}
				/>
				<Button
					variant="outline"
					disabled={!selectedFilterId || deleteFilter.isPending}
					onClick={() => deleteFilter.mutate({ id: selectedFilterId })}
				>
					删除
				</Button>
				<Button
					variant="outline"
					disabled={
						!selectedFilterId || !filterName.trim() || renameFilter.isPending
					}
					onClick={() =>
						renameFilter.mutate({
							id: selectedFilterId,
							name: filterName,
							config: reportConfig,
						})
					}
				>
					重命名并更新
				</Button>
				{saveFilter.isError ||
				deleteFilter.isError ||
				renameFilter.isError ||
				exportCsv.isError ? (
					<span className="text-destructive">
						操作失败，请检查当前权限或缩小范围后重试。
					</span>
				) : null}
			</div>
			<nav
				className="flex min-w-0 flex-wrap gap-2 border-b pb-2"
				aria-label="经营分析视图"
			>
				{visibleTabs.map((tab) => (
					<button
						key={tab}
						type="button"
						className={`border px-3 py-2 text-sm ${activeTab === tab ? "border-primary font-medium text-primary" : "border-border text-muted-foreground"}`}
						onClick={() => setActiveTab(tab)}
						aria-current={activeTab === tab ? "page" : undefined}
					>
						{tab === "overview"
							? "经营概览"
							: tab === "comparison"
								? "经营对比"
								: "资源与财务"}
					</button>
				))}
			</nav>

			{pending ? <AnalyticsSkeleton /> : null}
			{rangeMode === "custom" && !customRangeValid ? (
				<p className="border border-destructive/40 p-3 text-destructive text-sm">
					结束日期必须晚于开始日期。
				</p>
			) : null}
			{failed ? (
				<section className="grid min-h-48 place-items-center border p-6 text-center">
					<div>
						<h2 className="font-semibold">经营指标加载失败</h2>
						<p className="mt-2 text-muted-foreground text-sm">
							{failed.error.message}
						</p>
						<Button className="mt-4" onClick={() => void failed.refetch()}>
							重试
						</Button>
					</div>
				</section>
			) : null}
			{!pending && !failed && activeTab === "overview" ? (
				<>
					{sales.data ? (
						<SalesSection
							result={sales.data}
							consultant={organization.role === "consultant"}
							input={input}
						/>
					) : null}
					{attendance.data ? (
						<AttendanceSection result={attendance.data} input={input} />
					) : null}
					{consumption.data ? (
						<ConsumptionSection result={consumption.data} input={input} />
					) : null}
					{renewal.data ? (
						<RenewalSection result={renewal.data} input={input} />
					) : null}
				</>
			) : null}
			{!pending && !failed && activeTab === "comparison" && comparison.data ? (
				<ComparisonSection
					result={comparison.data}
					dimension={effectiveComparisonDimension}
					dimensions={comparisonDimensions}
					sortBy={comparisonSortBy}
					onDimensionChange={setComparisonDimension}
					onSortChange={setComparisonSortBy}
					showFinancial={["owner", "admin", "campus_manager"].includes(
						organization.role,
					)}
				/>
			) : null}
			{!pending && !failed && activeTab === "resource-finance" ? (
				<div className="grid gap-6">
					{resource.data ? <ResourceSection result={resource.data} /> : null}
					{financial.data ? <FinancialSection result={financial.data} /> : null}
					{!resource.data && !financial.data ? (
						<p className="border p-5 text-muted-foreground text-sm">
							当前角色暂无可展示的资源或财务指标。
						</p>
					) : null}
				</div>
			) : null}
			{asOf ? (
				<p className="text-muted-foreground text-xs">
					数据截至 {formatDateTime(asOf)} · Asia/Shanghai · 定义版本{" "}
					{definitionVersion}
				</p>
			) : null}
		</div>
	);
}

function FilterSelect({
	id,
	ariaLabel,
	label,
	value,
	onValueChange,
	items,
}: {
	id?: string;
	ariaLabel?: string;
	label?: string;
	value: string;
	onValueChange: (value: string) => void;
	items: Array<{ value: string; label: string }>;
}) {
	return (
		<div className={label ? "w-full sm:w-[200px]" : undefined}>
			{label ? (
				<span className="mb-1 block text-muted-foreground text-xs">
					{label}
				</span>
			) : null}
			<Select
				value={value}
				onValueChange={(next) => next && onValueChange(next)}
			>
				<SelectTrigger
					id={id}
					className={label ? "h-10 w-full" : "h-9 w-full min-w-48"}
					aria-label={ariaLabel ?? label}
				>
					<SelectValue>
						{() =>
							items.find((item) => item.value === value)?.label ??
							ariaLabel ??
							label
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}

function SalesSection({
	result,
	consultant,
	input,
}: {
	result: BusinessMetricSalesResult;
	consultant: boolean;
	input: BusinessMetricQueryInput;
}) {
	return (
		<AnalyticsSection title="招生与转化" quality={qualityMessages(result)}>
			<MetricGrid>
				<Metric
					label="顾问转化率"
					value={formatRatio(result.data.conversionRate)}
					helper={`${result.data.conversionRate.numerator}/${result.data.conversionRate.denominator} 个结案周期`}
					comparison={`对比期 ${formatRatio(result.data.comparisonConversionRate)}`}
				/>
				{consultant ? (
					<Metric
						label="校区脱敏基准"
						value={formatRatio(result.data.campusBenchmarkConversionRate)}
						helper="至少 5 个有效结案周期后展示"
					/>
				) : null}
				<Metric
					label="新建线索"
					value={`${result.data.createdLeadCount}`}
					helper="按创建 cohort"
				/>
				<Metric
					label="30 天内转化"
					value={`${result.data.convertedLeadCount}`}
					helper={`已联系 ${result.data.contactedLeadCount} · 试听 ${result.data.trialBookedLeadCount}`}
				/>
				<Metric
					label="开放线索"
					value={`${result.data.openCycleCount}`}
					helper="当前仍在跟进"
				/>
				<Metric
					label="直接报名"
					value={`${result.data.directEnrollmentCount}`}
					helper={formatCentsToCurrency(
						result.data.directEnrollmentAmountInCents,
					)}
				/>
			</MetricGrid>
			<MetricDrilldown kind="salesCycles" input={input} />
		</AnalyticsSection>
	);
}

function AttendanceSection({
	result,
	input,
}: {
	result: BusinessMetricAttendanceResult;
	input: BusinessMetricQueryInput;
}) {
	return (
		<AnalyticsSection title="到课与补课" quality={qualityMessages(result)}>
			<MetricGrid>
				<Metric
					label="主到课率"
					value={formatRatio(result.data.attendanceRate)}
					helper={`${result.data.attendanceRate.numerator}/${result.data.attendanceRate.denominator} 人次`}
					comparison={`对比期 ${formatRatio(result.data.comparisonAttendanceRate)}`}
				/>
				<Metric
					label="迟到率"
					value={formatRatio(result.data.lateRate)}
					helper="已计入到课"
				/>
				<Metric
					label="请假率"
					value={formatRatio(result.data.leaveRate)}
					helper="不计入到课"
				/>
				<Metric
					label="缺勤率"
					value={formatRatio(result.data.absenceRate)}
					helper="不计入到课"
				/>
				<Metric
					label="补课完成率"
					value={formatRatio(result.data.makeupCompletionRate)}
					helper={`未完成 ${result.data.pendingMakeupCount}`}
				/>
				<Metric
					label="待重排补课"
					value={`${result.data.needsRescheduleMakeupCount}`}
					helper="需要重新安排课次"
				/>
			</MetricGrid>
			<MetricDrilldown kind="attendanceLessons" input={input} />
		</AnalyticsSection>
	);
}

function ConsumptionSection({
	result,
	input,
}: {
	result: BusinessMetricConsumptionResult;
	input: BusinessMetricQueryInput;
}) {
	const max = Math.max(1, ...result.data.trend.map((point) => point.value));
	return (
		<AnalyticsSection title="课时消耗" quality={qualityMessages(result)}>
			<MetricGrid>
				<Metric
					label="实际消课"
					value={`${result.data.consumedLessonCount}`}
					helper="按课次发生日期归属"
					comparison={`对比期 ${result.data.comparisonConsumedLessonCount}`}
				/>
			</MetricGrid>
			<div className="mt-4 border p-4">
				<div
					className="flex h-36 items-end gap-1"
					role="img"
					aria-label={`共消耗 ${result.data.consumedLessonCount} 课时`}
				>
					{result.data.trend.length === 0 ? (
						<p className="m-auto text-muted-foreground text-sm">
							当前范围暂无消课记录
						</p>
					) : (
						result.data.trend.map((point) => (
							<div
								key={point.bucketStart}
								className="min-w-0 flex-1 bg-primary/80"
								style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
								title={`${point.bucketStart}: ${point.value}`}
							/>
						))
					)}
				</div>
			</div>
			<MetricDrilldown kind="consumptionLessons" input={input} />
		</AnalyticsSection>
	);
}

function RenewalSection({
	result,
	input,
}: {
	result: BusinessMetricRenewalResult;
	input: BusinessMetricQueryInput;
}) {
	return (
		<AnalyticsSection title="续费机会" quality={qualityMessages(result)}>
			<MetricGrid>
				<Metric
					label="续费转化率"
					value={formatRatio(result.data.renewalRate)}
					helper={`${result.data.succeededOpportunityCount}/${result.data.succeededOpportunityCount + result.data.unsucceededOpportunityCount} 个成熟机会`}
					comparison={`对比期 ${formatRatio(result.data.comparisonRenewalRate)}`}
				/>
				<Metric
					label="续费机会"
					value={`${result.data.opportunityCount}`}
					helper={
						result.data.minimumRemainingObservationDays === null
							? `未成熟 ${result.data.immatureOpportunityCount}`
							: `未成熟 ${result.data.immatureOpportunityCount} · 最近 ${result.data.minimumRemainingObservationDays} 天后成熟`
					}
				/>
				<Metric
					label="续费成交额"
					value={formatCentsToCurrency(result.data.renewalAmountInCents)}
					helper={`${result.data.renewalLessonCount} 课时`}
				/>
				<Metric
					label="提前续费"
					value={`${result.data.earlyRenewalCount}`}
					helper="不进入机会分母"
				/>
			</MetricGrid>
			<MetricDrilldown kind="renewalOpportunities" input={input} />
		</AnalyticsSection>
	);
}

const drilldownLabels: Record<BusinessMetricDrilldownKind, string> = {
	salesCycles: "查看结案周期",
	attendanceLessons: "查看课次考勤",
	consumptionLessons: "查看课消明细",
	renewalOpportunities: "查看续费机会",
};

function MetricDrilldown({
	kind,
	input,
}: {
	kind: BusinessMetricDrilldownKind;
	input: BusinessMetricQueryInput;
}) {
	const [open, setOpen] = useState(false);
	const rangeKey = JSON.stringify(input.range);
	const [cursorState, setCursorState] = useState<{
		rangeKey: string;
		cursor: NonNullable<BusinessMetricDrilldownInput["cursor"]>;
	}>();
	const cursor =
		cursorState?.rangeKey === rangeKey ? cursorState.cursor : undefined;
	const query = useQuery({
		...orpc.training.analytics.drilldown.queryOptions({
			input: { ...input, kind, limit: 20, cursor },
		}),
		enabled: open,
	});
	return (
		<div className="mt-4 border-t pt-3">
			<Button
				type="button"
				variant="outline"
				onClick={() => setOpen((value) => !value)}
			>
				{open ? "收起明细" : drilldownLabels[kind]}
			</Button>
			{open ? (
				<div className="mt-3" aria-live="polite">
					{query.isPending ? <Skeleton className="h-24" /> : null}
					{query.isError ? (
						<p className="text-destructive text-sm">
							明细加载失败：{query.error.message}
						</p>
					) : null}
					{query.data ? (
						<DrilldownItems
							result={query.data}
							hasPreviousPage={Boolean(cursor)}
							onFirstPage={() => setCursorState(undefined)}
							onNextPage={(nextCursor) =>
								setCursorState({ rangeKey, cursor: nextCursor })
							}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function DrilldownItems({
	result,
	hasPreviousPage,
	onFirstPage,
	onNextPage,
}: {
	result: BusinessMetricDrilldownResult;
	hasPreviousPage: boolean;
	onFirstPage: () => void;
	onNextPage: (
		cursor: NonNullable<BusinessMetricDrilldownInput["cursor"]>,
	) => void;
}) {
	if (result.items.length === 0) {
		return (
			<div className="grid gap-3">
				<p className="text-muted-foreground text-sm">当前范围暂无明细</p>
				{hasPreviousPage ? (
					<Button type="button" variant="outline" onClick={onFirstPage}>
						返回首批
					</Button>
				) : null}
			</div>
		);
	}
	const nextCursor = result.nextCursor;
	return (
		<div className="grid gap-3">
			<ul className="grid gap-2">
				{result.items.map((item) => (
					<li key={item.id} className="min-w-0 border p-3 text-sm">
						<p className="text-muted-foreground text-xs">
							{formatDateTime(item.occurredAt)}
						</p>
						<p className="mt-1 break-words">{formatDrilldownItem(item)}</p>
					</li>
				))}
			</ul>
			<div className="flex flex-wrap gap-2">
				{hasPreviousPage ? (
					<Button type="button" variant="outline" onClick={onFirstPage}>
						返回首批
					</Button>
				) : null}
				{nextCursor ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => onNextPage(nextCursor)}
					>
						下一批
					</Button>
				) : null}
			</div>
		</div>
	);
}

function formatDrilldownItem(
	item: BusinessMetricDrilldownResult["items"][number],
) {
	if (item.kind === "salesCycle") {
		return `${item.outcome === "converted" ? "成交" : "流失"} · 归属 ${item.attributionLabel}`;
	}
	if (item.kind === "attendanceLesson") {
		return `到课 ${item.present} · 迟到 ${item.late} · 请假 ${item.leave} · 缺勤 ${item.absent}`;
	}
	if (item.kind === "consumptionLesson") {
		return `消课 ${item.consumedLessonCount} · 晚录 ${item.lateConsumptionCount}`;
	}
	const status =
		item.status === "succeeded"
			? "续费成功"
			: item.status === "unsucceeded"
				? "观察期内未续费"
				: `尚未成熟，剩余 ${item.remainingObservationDays ?? 0} 天`;
	return `${status} · ${formatCentsToCurrency(item.renewalAmountInCents)} · ${item.renewalLessonCount} 课时`;
}

const comparisonDimensionLabels: Record<
	BusinessMetricComparisonDimension,
	string
> = {
	campus: "校区",
	course: "课程",
	teacher: "教师",
	class: "班级",
};

const comparisonSortLabels: Record<
	BusinessMetricComparisonInput["sortBy"],
	string
> = {
	enrollmentCount: "报名数",
	lessonCount: "课次数",
	consumedLessonCount: "消课数",
	attendanceRate: "到课率",
	utilizationRate: "教师利用率",
	occupancyRate: "课次上座率",
	netReceiptsInCents: "净回款",
};

function ComparisonSection({
	result,
	dimension,
	dimensions,
	sortBy,
	onDimensionChange,
	onSortChange,
	showFinancial,
}: {
	result: BusinessMetricComparisonResult;
	dimension: BusinessMetricComparisonDimension;
	dimensions: BusinessMetricComparisonDimension[];
	sortBy: BusinessMetricComparisonInput["sortBy"];
	onDimensionChange: (value: BusinessMetricComparisonDimension) => void;
	onSortChange: (value: BusinessMetricComparisonInput["sortBy"]) => void;
	showFinancial: boolean;
}) {
	return (
		<AnalyticsSection
			title={`${comparisonDimensionLabels[dimension]}经营对比`}
			quality={[
				result.dataQuality.missingFinancialFactCount > 0
					? `${result.dataQuality.missingFinancialFactCount} 张账单缺少不可变财务事实`
					: null,
				result.dataQuality.unlinkedDimensionCount > 0
					? "存在未关联维度，已单列且不隐藏金额"
					: null,
				result.dataQuality.scopeCoverageIncomplete
					? "当前授权范围的财务事实覆盖不完整"
					: null,
			].filter((item): item is string => item !== null)}
		>
			<div className="flex flex-wrap gap-2 border-b pb-4">
				<FilterSelect
					label="对比维度"
					value={dimension}
					onValueChange={(value) =>
						onDimensionChange(value as BusinessMetricComparisonDimension)
					}
					items={dimensions.map((value) => ({
						value,
						label: comparisonDimensionLabels[value],
					}))}
				/>
				<FilterSelect
					label="排序指标"
					value={sortBy}
					onValueChange={(value) =>
						onSortChange(value as BusinessMetricComparisonInput["sortBy"])
					}
					items={Object.entries(comparisonSortLabels).map(
						([value, optionLabel]) => ({ value, label: optionLabel }),
					)}
				/>
			</div>
			{result.rows.length === 0 ? (
				<p className="mt-4 text-muted-foreground text-sm">
					当前范围暂无可比较数据。
				</p>
			) : (
				<div className="mt-4 grid gap-3">
					{result.rows.map((row) => (
						<article key={row.id} className="min-w-0 border p-4">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div>
									<h3 className="font-medium">{row.label}</h3>
									{row.sampleSmall ? (
										<p className="mt-1 text-amber-700 text-xs">
											样本较少，比例不参与 Top/Bottom 判断
										</p>
									) : null}
								</div>
								{row.detailPath ? (
									<a
										className="text-primary text-sm underline"
										href={row.detailPath}
									>
										受控下钻
									</a>
								) : null}
							</div>
							<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
								<ComparisonValue
									label="报名数"
									value={`${row.current.enrollmentCount}`}
									comparison={`${row.comparison.enrollmentCount}`}
								/>
								<ComparisonValue
									label="课次数"
									value={`${row.current.lessonCount}`}
									comparison={`${row.comparison.lessonCount}`}
								/>
								<ComparisonValue
									label="消课数"
									value={`${row.current.consumedLessonCount}`}
									comparison={`${row.comparison.consumedLessonCount}`}
								/>
								<ComparisonValue
									label="到课率"
									value={formatComparisonRatio(row.current.attendanceRate)}
									comparison={formatComparisonRatio(
										row.comparison.attendanceRate,
									)}
								/>
								{dimension === "teacher" ? (
									<ComparisonValue
										label="实际利用率"
										value={formatComparisonRatio(row.current.utilizationRate)}
										comparison={formatComparisonRatio(
											row.comparison.utilizationRate,
										)}
									/>
								) : null}
								{dimension === "class" ? (
									<ComparisonValue
										label="课次上座率"
										value={formatComparisonRatio(row.current.occupancyRate)}
										comparison={formatComparisonRatio(
											row.comparison.occupancyRate,
										)}
									/>
								) : null}
								{showFinancial ? (
									<ComparisonValue
										label="净回款"
										value={formatCentsToCurrency(
											row.current.netReceiptsInCents,
										)}
										comparison={formatCentsToCurrency(
											row.comparison.netReceiptsInCents,
										)}
									/>
								) : null}
							</div>
						</article>
					))}
				</div>
			)}
		</AnalyticsSection>
	);
}

function ComparisonValue({
	label,
	value,
	comparison,
}: {
	label: string;
	value: string;
	comparison: string;
}) {
	return (
		<div className="min-w-0 bg-muted/30 p-3">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="mt-1 break-words font-medium">{value}</p>
			<p className="mt-1 text-muted-foreground text-xs">对比期 {comparison}</p>
		</div>
	);
}

function formatComparisonRatio(
	value: BusinessMetricComparisonResult["rows"][number]["current"]["attendanceRate"],
): string {
	if (value.status === "available") return `${(value.value * 100).toFixed(1)}%`;
	if (value.reason === "insufficientSample") return "样本不足";
	if (value.reason === "factCoverageMissing") return "事实缺口";
	return "-";
}

function ResourceSection({ result }: { result: BusinessMetricResourceResult }) {
	return (
		<AnalyticsSection
			title="资源利用"
			quality={resourceQualityMessages(result)}
		>
			<MetricGrid>
				<Metric
					label="实际教师利用率"
					value={formatRatio(result.data.actualUtilizationRate)}
					helper={`${result.data.completedMinutes} / ${result.data.actualCapacityMinutes} 分钟`}
				/>
				<Metric
					label="计划教师利用率"
					value={formatRatio(result.data.plannedUtilizationRate)}
					helper={`${result.data.plannedMinutes} / ${result.data.plannedCapacityMinutes} 分钟`}
				/>
				<Metric
					label="班级容量利用率"
					value={formatRatio(result.data.classCapacityUtilizationRate)}
					helper={`${result.data.activeSeatCount} / ${result.data.classCapacity} 席`}
				/>
				<Metric
					label="课次上座率"
					value={formatRatio(result.data.lessonOccupancyRate)}
					helper="已完成课次的实际到场人数 / 当时容量"
				/>
				<Metric
					label="满班班级"
					value={`${result.data.fullClassCount}`}
					helper={`有效班级 ${result.data.eligibleClassCount}`}
				/>
				<Metric
					label="接近满班"
					value={`${result.data.nearFullClassCount}`}
					helper="达到 90% 但未满班"
				/>
			</MetricGrid>
		</AnalyticsSection>
	);
}

function FinancialSection({
	result,
}: {
	result: BusinessMetricFinancialResult;
}) {
	return (
		<AnalyticsSection
			title="回款与应收"
			quality={[
				result.dataQuality.scopeCoverageIncomplete
					? "当前授权范围的财务事实覆盖不完整"
					: null,
				result.dataQuality.missingFinancialFactCount > 0
					? `${result.dataQuality.missingFinancialFactCount} 张账单缺少财务事实`
					: null,
			].filter((item): item is string => item !== null)}
		>
			<MetricGrid>
				<Metric
					label="净回款"
					value={formatCentsToCurrency(result.data.netReceiptsInCents)}
					helper={`收款 ${formatCentsToCurrency(result.data.paymentsInCents)} · 冲正 ${formatCentsToCurrency(result.data.reversalsInCents)} · 退款 ${formatCentsToCurrency(result.data.refundsInCents)}`}
					comparison={`对比期 ${formatCentsToCurrency(result.data.comparisonNetReceiptsInCents)}`}
				/>
				<Metric
					label="30 日 cohort 回款率"
					value={formatRatio(result.data.cohortCollectionRate)}
					helper={`${result.data.matureCohortInvoiceCount} 张成熟账单 · 未成熟 ${result.data.immatureCohortInvoiceCount}`}
				/>
				<Metric
					label="应收账龄总额"
					value={formatCentsToCurrency(result.data.agingTotalInCents)}
					helper={`快照 ${formatDateTime(result.data.agingSnapshotAt)}`}
				/>
			</MetricGrid>
		</AnalyticsSection>
	);
}

function resourceQualityMessages(
	result: BusinessMetricResourceResult,
): string[] {
	return [
		result.dataQuality.missingTeacherCapacityCount > 0
			? `${result.dataQuality.missingTeacherCapacityCount} 名教师未配置容量`
			: null,
		result.dataQuality.partialTeacherCapacityCount > 0
			? `${result.dataQuality.partialTeacherCapacityCount} 名教师容量历史覆盖不完整`
			: null,
		result.dataQuality.missingLessonCapacityCount > 0
			? `${result.dataQuality.missingLessonCapacityCount} 个历史课次缺少班级容量`
			: null,
	].filter((item): item is string => item !== null);
}

function AnalyticsSection({
	title,
	quality,
	children,
}: {
	title: string;
	quality: string[];
	children: React.ReactNode;
}) {
	return (
		<section className="min-w-0 border p-4 sm:p-5">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<h2 className="font-semibold text-lg">{title}</h2>
				<span className="text-muted-foreground text-xs">
					口径与下钻使用同一服务端定义
				</span>
			</div>
			{children}
			{quality.length > 0 ? (
				<ul className="mt-4 border-t pt-3 text-amber-700 text-xs">
					{quality.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

function MetricGrid({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
			{children}
		</div>
	);
}
function Metric({
	label,
	value,
	helper,
	comparison,
}: {
	label: string;
	value: string;
	helper: string;
	comparison?: string;
}) {
	return (
		<div className="min-w-0 border bg-background p-4">
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-2 break-words font-semibold text-2xl">{value}</p>
			<p className="mt-1 text-muted-foreground text-xs">{helper}</p>
			{comparison ? (
				<p className="mt-2 font-medium text-xs">{comparison}</p>
			) : null}
		</div>
	);
}
function formatRatio(value: BusinessMetricRatio) {
	if (value.status === "available") return `${(value.value * 100).toFixed(1)}%`;
	return value.reason === "insufficientSample"
		? "样本不足"
		: value.reason === "immatureCohort"
			? "尚未成熟"
			: "-";
}
function qualityMessages(result: {
	dataQuality: BusinessMetricSalesResult["dataQuality"];
}) {
	const q = result.dataQuality;
	return [
		q.missingAttributionCount > 0
			? `${q.missingAttributionCount} 条历史归属缺失`
			: null,
		q.missingMilestoneHistoryCount > 0
			? `${q.missingMilestoneHistoryCount} 条线索缺少历史里程碑`
			: null,
		q.missingPurchaseCycleCount > 0
			? `${q.missingPurchaseCycleCount} 条报名缺少购买周期`
			: null,
		q.immatureCohortCount > 0
			? `${q.immatureCohortCount} 个 cohort 尚未成熟`
			: null,
		q.lateConsumptionCount > 0
			? `${q.lateConsumptionCount} 条课消晚于课次结束 24 小时录入`
			: null,
	].filter((item): item is string => item !== null);
}
function AnalyticsSkeleton() {
	return (
		<div className="grid gap-6">
			<Skeleton className="h-56" />
			<Skeleton className="h-56" />
		</div>
	);
}
