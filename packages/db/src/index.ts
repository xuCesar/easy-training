import { env } from "@easy-training/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

let pool: Pool | undefined;

export function createDbPool() {
	return new Pool({
		connectionString: env.DATABASE_URL,
		max: env.DATABASE_POOL_MAX,
		idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
		connectionTimeoutMillis: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
		options: `-c statement_timeout=${env.DATABASE_STATEMENT_TIMEOUT_MS}`,
	});
}

export function createDb() {
	pool ??= createDbPool();
	return drizzle(pool, { schema });
}

export async function closeDb() {
	if (!pool) return;
	await pool.end();
	pool = undefined;
}

export const db = createDb();

export * from "./repositories/analytics-saved-filters";
export * from "./repositories/arrears-workflow";
export * from "./repositories/classrooms";
export * from "./repositories/enrollment-conversion";
export * from "./repositories/enrollment-finance-adjustments";
export * from "./repositories/enrollment-lifecycle";
export * from "./repositories/enrollment-registration";
export * from "./repositories/finance";
export * from "./repositories/global-search";
export * from "./repositories/leads";
export * from "./repositories/operation-task-access";
export * from "./repositories/operation-tasks";
export * from "./repositories/operations";
export * from "./repositories/organization";
export * from "./repositories/organization-management";
export * from "./repositories/payment-reversals";
export * from "./repositories/receipt-documents";
export * from "./repositories/refund-approval";
export * from "./repositories/scheduling";
export * from "./repositories/student-bulk-operations";
export * from "./repositories/student-enrollment-bulk";
export * from "./repositories/student-import-export";
export * from "./repositories/student-merge";
export * from "./repositories/student-ownership";
export * from "./repositories/student-timeline";
export * from "./repositories/students";
export * from "./repositories/teaching";
