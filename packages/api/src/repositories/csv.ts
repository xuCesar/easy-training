export function quoteCsv(value: string | number | null): string {
	const raw = value == null ? "" : String(value);
	// 防止用户用表格软件打开 CSV 时执行公式。
	const text = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
	return `"${text.replaceAll('"', '""')}"`;
}
