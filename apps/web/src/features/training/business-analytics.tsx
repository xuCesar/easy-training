import type {
	BusinessMetricAttendanceResult,
	BusinessMetricConsumptionResult,
	BusinessMetricDrilldownInput,
	BusinessMetricDrilldownKind,
	BusinessMetricDrilldownResult,
	BusinessMetricQueryInput,
	BusinessMetricRatio,
	BusinessMetricRenewalResult,
	BusinessMetricSalesResult,
} from "@easy-training/api/contracts/business-metrics";
import { Button } from "@easy-training/ui/components/button";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/utils/orpc";
import { formatCentsToCurrency, formatDateTime } from "./format";
import { useOrganization } from "./organization-context";

type Preset = Exclude<BusinessMetricQueryInput["range"]["preset"], "custom">;
type RangeMode = Preset | "custom";

const presetLabels: Record<Preset, string> = {
	last7Days: "最近 7 天",
	last30Days: "最近 30 天",
	last90Days: "最近 90 天",
	month: "本月",
	quarter: "本季度",
	year: "本年度",
};

const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
const defaultCustomFrom = `${shanghaiNow.getUTCFullYear()}-${String(shanghaiNow.getUTCMonth() + 1).padStart(2, "0")}-01`;
const defaultCustomTo = new Date(shanghaiNow.getTime() + 24 * 60 * 60 * 1000)
	.toISOString()
	.slice(0, 10);

export function BusinessAnalytics() {
	const { organization } = useOrganization();
	const [rangeMode, setRangeMode] = useState<RangeMode>("month");
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
	const sales = useQuery({
		...orpc.training.analytics.sales.queryOptions({ input }),
		enabled: canViewSales && rangeEnabled,
	});
	const attendance = useQuery({
		...orpc.training.analytics.attendance.queryOptions({ input }),
		enabled: canViewTeaching && rangeEnabled,
	});
	const consumption = useQuery({
		...orpc.training.analytics.consumption.queryOptions({ input }),
		enabled: canViewTeaching && rangeEnabled,
	});
	const renewal = useQuery({
		...orpc.training.analytics.renewal.queryOptions({ input }),
		enabled: canViewRenewal && rangeEnabled,
	});
	const visibleQueries = [
		canViewSales ? sales : null,
		canViewTeaching ? attendance : null,
		canViewTeaching ? consumption : null,
		canViewRenewal ? renewal : null,
	].filter((query) => query !== null);
	const pending = visibleQueries.some((query) => query.isPending);
	const failed = visibleQueries.find((query) => query.isError);
	const asOf =
		sales.data?.asOf ??
		attendance.data?.asOf ??
		consumption.data?.asOf ??
		renewal.data?.asOf;
	const definitionVersion =
		sales.data?.definitionVersion ??
		attendance.data?.definitionVersion ??
		consumption.data?.definitionVersion ??
		renewal.data?.definitionVersion;

	if (organization.role === "finance") {
		return <Unavailable />;
	}

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
						<select
							id="analytics-range"
							className="h-9 min-w-36 border bg-background px-3"
							value={rangeMode}
							onChange={(event) =>
								setRangeMode(event.target.value as RangeMode)
							}
						>
							{Object.entries(presetLabels).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
							<option value="custom">自定义</option>
						</select>
					</label>
					{rangeMode === "custom" ? (
						<>
							<label className="grid gap-1 text-sm">
								<span className="text-muted-foreground">开始日期</span>
								<input
									className="h-9 border bg-background px-2"
									type="date"
									value={customFrom}
									onChange={(event) => setCustomFrom(event.target.value)}
								/>
							</label>
							<label className="grid gap-1 text-sm">
								<span className="text-muted-foreground">结束日期（不含）</span>
								<input
									className="h-9 border bg-background px-2"
									type="date"
									value={customTo}
									onChange={(event) => setCustomTo(event.target.value)}
								/>
							</label>
						</>
					) : null}
				</div>
			</header>

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
			{!pending && !failed ? (
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
			{asOf ? (
				<p className="text-muted-foreground text-xs">
					数据截至 {formatDateTime(asOf)} · Asia/Shanghai · 定义版本{" "}
					{definitionVersion}
				</p>
			) : null}
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
			: "暂不可计算";
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
function Unavailable() {
	return (
		<section className="grid min-h-72 place-items-center border p-6 text-center">
			<div>
				<h1 className="font-semibold text-lg">当前角色无权访问经营分析</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					财务回款与应收分析将在经营对比阶段单独提供。
				</p>
			</div>
		</section>
	);
}
