import type { LeadFilterStage } from "./leads-types";
import { stageOptions } from "./leads-types";

export function getStageLabel(stage: LeadFilterStage | "enrolled") {
	if (stage === "enrolled") return "已转报名";
	return stageOptions.find((item) => item.value === stage)?.label ?? stage;
}

export function formatFollowAt(value: string | null) {
	return value ? formatDateTime(value) : "未安排";
}

export function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

export function toLocalInputValue(value: string | null) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

export function toApiDateTime(value: string | null) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toFieldErrors<T extends Record<string, unknown>>(
	issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
	values: T,
): Partial<Record<keyof T, string>> {
	const errors: Partial<Record<keyof T, string>> = {};
	for (const issue of issues) {
		const field = issue.path[0];
		if (typeof field === "string" && field in values)
			errors[field as keyof T] ??= issue.message;
	}
	return errors;
}
