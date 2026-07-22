import { Buffer } from "node:buffer";

export const MAX_IMPORT_CONTENT_BYTES = 500_000;
export const MAX_IMPORT_ROWS = 1_000;

export type CsvRow = { cells: string[]; row: number };

export class CsvRepositoryError extends Error {
	constructor(public readonly code: "INVALID_CSV" | "LIMIT_EXCEEDED") {
		super(code);
		this.name = "CsvRepositoryError";
	}
}

export function hasCsvFormulaPrefix(value: string): boolean {
	return /^[=+\-@]/u.test(value.trimStart());
}

export function parseCsvRecords(content: string): CsvRow[] {
	if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_CONTENT_BYTES) {
		throw new CsvRepositoryError("LIMIT_EXCEEDED");
	}

	const rows: CsvRow[] = [];
	let row: string[] = [];
	let value = "";
	let quoted = false;
	let line = 1;
	let rowStart = 1;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index] ?? "";
		if (char === '"') {
			if (quoted && content[index + 1] === '"') {
				value += '"';
				index += 1;
			} else quoted = !quoted;
		} else if (char === "," && !quoted) {
			row.push(value.trim());
			value = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && content[index + 1] === "\n") index += 1;
			line += 1;
			if (quoted) {
				value += "\n";
				continue;
			}
			row.push(value.trim());
			if (row.some(Boolean)) rows.push({ cells: row, row: rowStart });
			row = [];
			value = "";
			rowStart = line;
		} else value += char;
	}
	if (quoted) throw new CsvRepositoryError("INVALID_CSV");
	row.push(value.trim());
	if (row.some(Boolean)) rows.push({ cells: row, row: rowStart });
	return rows;
}
