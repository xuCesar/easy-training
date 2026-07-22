import type {
	BusinessMetricGranularity,
	BusinessMetricRangeInput,
	ResolvedBusinessMetricRange,
} from "../contracts/business-metrics";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_IN_MS = 8 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_IN_MS = 2 * 366 * DAY_IN_MS;

export type ResolvedBusinessMetricWindow = {
	range: ResolvedBusinessMetricRange;
	comparisonRange: ResolvedBusinessMetricRange;
	granularity: BusinessMetricGranularity;
};

export class BusinessMetricRangeError extends Error {
	constructor(
		readonly code: "INVALID_RANGE" | "RANGE_TOO_LARGE",
		message: string,
	) {
		super(message);
		this.name = "BusinessMetricRangeError";
	}
}

function toShanghaiShiftedDate(value: Date): Date {
	return new Date(value.getTime() + SHANGHAI_OFFSET_IN_MS);
}

function fromShanghaiShiftedTimestamp(timestamp: number): Date {
	return new Date(timestamp - SHANGHAI_OFFSET_IN_MS);
}

function startOfShanghaiDay(value: Date): Date {
	const shifted = toShanghaiShiftedDate(value);
	return fromShanghaiShiftedTimestamp(
		Date.UTC(
			shifted.getUTCFullYear(),
			shifted.getUTCMonth(),
			shifted.getUTCDate(),
		),
	);
}

function startOfShanghaiMonth(value: Date): Date {
	const shifted = toShanghaiShiftedDate(value);
	return fromShanghaiShiftedTimestamp(
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1),
	);
}

function startOfShanghaiQuarter(value: Date): Date {
	const shifted = toShanghaiShiftedDate(value);
	const quarterMonth = Math.floor(shifted.getUTCMonth() / 3) * 3;
	return fromShanghaiShiftedTimestamp(
		Date.UTC(shifted.getUTCFullYear(), quarterMonth, 1),
	);
}

function startOfShanghaiYear(value: Date): Date {
	const shifted = toShanghaiShiftedDate(value);
	return fromShanghaiShiftedTimestamp(Date.UTC(shifted.getUTCFullYear(), 0, 1));
}

function shiftShanghaiMonths(value: Date, months: number): Date {
	const shifted = toShanghaiShiftedDate(value);
	return fromShanghaiShiftedTimestamp(
		Date.UTC(
			shifted.getUTCFullYear(),
			shifted.getUTCMonth() + months,
			shifted.getUTCDate(),
			shifted.getUTCHours(),
			shifted.getUTCMinutes(),
			shifted.getUTCSeconds(),
			shifted.getUTCMilliseconds(),
		),
	);
}

function parseShanghaiDate(value: string): Date {
	const [yearValue, monthValue, dayValue] = value.split("-");
	const year = Number(yearValue);
	const month = Number(monthValue);
	const day = Number(dayValue);
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day)
	) {
		throw new BusinessMetricRangeError("INVALID_RANGE", "日期范围无效。");
	}

	const timestamp = Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_IN_MS;
	const result = new Date(timestamp);
	const shifted = toShanghaiShiftedDate(result);
	if (
		shifted.getUTCFullYear() !== year ||
		shifted.getUTCMonth() !== month - 1 ||
		shifted.getUTCDate() !== day
	) {
		throw new BusinessMetricRangeError("INVALID_RANGE", "日期范围无效。");
	}
	return result;
}

function toResolvedRange(from: Date, to: Date): ResolvedBusinessMetricRange {
	return { from: from.toISOString(), to: to.toISOString() };
}

function getGranularity(durationInMs: number): BusinessMetricGranularity {
	if (durationInMs <= 90 * DAY_IN_MS) return "day";
	if (durationInMs <= 365 * DAY_IN_MS) return "week";
	return "month";
}

function calendarComparison(
	from: Date,
	to: Date,
	monthOffset: number,
): ResolvedBusinessMetricRange {
	const comparisonFrom = shiftShanghaiMonths(from, monthOffset);
	const elapsed = to.getTime() - from.getTime();
	const comparisonPeriodEnd = from;
	const comparisonTo = new Date(
		Math.min(comparisonFrom.getTime() + elapsed, comparisonPeriodEnd.getTime()),
	);
	return toResolvedRange(comparisonFrom, comparisonTo);
}

export function resolveBusinessMetricWindow(
	input: BusinessMetricRangeInput,
	now = new Date(),
): ResolvedBusinessMetricWindow {
	if (!Number.isFinite(now.getTime())) {
		throw new BusinessMetricRangeError("INVALID_RANGE", "当前时间无效。");
	}

	let from: Date;
	let to: Date;
	let comparisonRange: ResolvedBusinessMetricRange;

	switch (input.preset) {
		case "last7Days":
		case "last30Days":
		case "last90Days": {
			const days =
				input.preset === "last7Days"
					? 7
					: input.preset === "last30Days"
						? 30
						: 90;
			to = now;
			from = new Date(
				startOfShanghaiDay(now).getTime() - (days - 1) * DAY_IN_MS,
			);
			const duration = to.getTime() - from.getTime();
			comparisonRange = toResolvedRange(
				new Date(from.getTime() - duration),
				from,
			);
			break;
		}
		case "month":
			from = startOfShanghaiMonth(now);
			to = now;
			comparisonRange = calendarComparison(from, to, -1);
			break;
		case "quarter":
			from = startOfShanghaiQuarter(now);
			to = now;
			comparisonRange = calendarComparison(from, to, -3);
			break;
		case "year":
			from = startOfShanghaiYear(now);
			to = now;
			comparisonRange = calendarComparison(from, to, -12);
			break;
		case "custom": {
			from = parseShanghaiDate(input.from);
			to = parseShanghaiDate(input.to);
			const duration = to.getTime() - from.getTime();
			if (duration <= 0) {
				throw new BusinessMetricRangeError(
					"INVALID_RANGE",
					"结束日期必须晚于开始日期。",
				);
			}
			if (duration > MAX_CUSTOM_RANGE_IN_MS) {
				throw new BusinessMetricRangeError(
					"RANGE_TOO_LARGE",
					"自定义日期范围不能超过两年。",
				);
			}
			comparisonRange = toResolvedRange(
				new Date(from.getTime() - duration),
				from,
			);
			break;
		}
	}

	const duration = to.getTime() - from.getTime();
	return {
		range: toResolvedRange(from, to),
		comparisonRange,
		granularity: getGranularity(duration),
	};
}
