export function formatCurrency(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "currency",
		currency: "CNY",
		maximumFractionDigits: 0,
	}).format(value);
}

export function formatPercent(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "percent",
		maximumFractionDigits: 1,
	}).format(value);
}

export function formatDateTime(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

export function formatDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(value));
}
