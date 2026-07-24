import { inArray, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { db } from "../index";
import type { CampusAccess } from "./organization";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function isCampusAccessible(
	access: CampusAccess,
	campusId: string | null,
): boolean {
	if (access.kind === "all") return true;
	return (
		campusId !== null &&
		access.kind === "selected" &&
		access.campusIds.includes(campusId)
	);
}

export function campusAccessCondition(
	column: AnyPgColumn,
	access: CampusAccess,
): SQL {
	if (access.kind === "none") return sql`false`;
	return access.kind === "selected"
		? inArray(column, access.campusIds)
		: sql`true`;
}

function sqlList(values: string[]): SQL {
	return sql.join(
		values.map((value) => sql`${value}`),
		sql`, `,
	);
}

export function campusAccessSqlCondition(
	expression: SQL,
	access: CampusAccess,
): SQL {
	if (access.kind === "none") return sql`false`;
	if (access.kind === "all") return sql`true`;
	return access.campusIds.length > 0
		? sql`${expression} in (${sqlList(access.campusIds)})`
		: sql`false`;
}

export function escapedContains(value: string): string {
	return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}
