import { env } from "@easy-training/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export function createDb() {
	return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

export * from "./repositories/enrollment-conversion";
export * from "./repositories/leads";
export * from "./repositories/organization";
