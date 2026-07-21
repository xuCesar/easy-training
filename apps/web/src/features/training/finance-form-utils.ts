import type { InvoiceListResult } from "@easy-training/api/contracts/training";

type InvoiceSummary = InvoiceListResult["items"][number];

const activityTypeLabels: Record<
	InvoiceSummary["businessActivityType"],
	string
> = {
	course_enrollment: "课程报名",
	course_renewal: "课程续费",
	material_fee: "材料费",
	exam_fee: "考试费",
	price_difference: "补差价",
	other: "其他",
};

const invoiceSourceLabels: Record<InvoiceSummary["source"], string> = {
	enrollment: "报名开单",
	renewal: "续费开单",
	manual: "手工开单",
};

export function getActivityTypeLabel(
	type: InvoiceSummary["businessActivityType"],
): string {
	return activityTypeLabels[type];
}

export function getInvoiceSourceLabel(
	source: InvoiceSummary["source"],
): string {
	return invoiceSourceLabels[source];
}

export function formatCentsAsYuan(value: number): string {
	const yuan = Math.floor(value / 100);
	const cents = String(value % 100).padStart(2, "0");
	return `${yuan}.${cents}`;
}

export function parseYuanToCents(value: string): number | null {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!match) return null;
	const yuan = Number(match[1]);
	const cents = Number((match[2] ?? "").padEnd(2, "0"));
	const result = yuan * 100 + cents;
	return Number.isSafeInteger(result) && result > 0 && result <= 100_000_000
		? result
		: null;
}

export function getShanghaiToday(now = new Date()): string {
	return new Date(now.getTime() + 8 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}
