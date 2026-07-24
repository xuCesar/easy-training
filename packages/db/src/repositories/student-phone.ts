import { sql } from "drizzle-orm";

import type { Transaction } from "./campus-access";

/**
 * 仅规范化用于同机构查重的展示差异，不推断姓名、地区或号码归属。
 */
export function normalizeStudentPhone(phone: string): string {
	return phone
		.trim()
		.replace(/[\s()（）-]/gu, "")
		.replace(/^\+?86/u, "");
}

export async function lockStudentPhonesInTransaction(
	tx: Transaction,
	input: { organizationId: string; normalizedPhones: string[] },
): Promise<void> {
	const phones = [...new Set(input.normalizedPhones.filter(Boolean))].sort();
	for (const phone of phones) {
		// 全部创建入口采用相同排序，避免多个手机号批量导入时发生锁序反转。
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${phone}))`,
		);
	}
}
