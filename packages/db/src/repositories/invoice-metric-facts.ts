import { sql } from "drizzle-orm";

import { db } from "../index";
import { invoiceMetricFact } from "../schema";
import type { Transaction } from "./campus-access";

type NativeCourseAttribution =
	| { kind: "linked"; courseId: string; courseNameSnapshot: string }
	| { kind: "not_applicable" };

/**
 * 将新账单的发生时归属与原账单放在同一事务中保存。调用方必须已经锁定并
 * 验证校区、课程属于同一机构；这里仅集中维护不可变事实的写入形状。
 */
export async function createNativeInvoiceMetricFact(
	tx: Transaction,
	input: {
		organizationId: string;
		invoiceId: string;
		campusId: string;
		campusNameSnapshot: string;
		course: NativeCourseAttribution;
		source: "lead_conversion" | "independent_enrollment" | "renewal" | "manual";
		occurredAt: Date;
	},
): Promise<void> {
	await tx.insert(invoiceMetricFact).values({
		organizationId: input.organizationId,
		invoiceId: input.invoiceId,
		campusId: input.campusId,
		campusAttributionKind: "linked",
		campusNameSnapshot: input.campusNameSnapshot,
		courseId: input.course.kind === "linked" ? input.course.courseId : null,
		courseAttributionKind: input.course.kind,
		courseNameSnapshot:
			input.course.kind === "linked" ? input.course.courseNameSnapshot : null,
		source: input.source,
		provenance: "native",
		occurredAt: input.occurredAt,
	});
}

/**
 * 为指定机构的既有账单补齐可由不可变业务事实证明的归属。所有语句均以
 * invoice_id 冲突忽略，因此可以在高水位后反复 catch-up，且绝不覆盖
 * 新版 writer 已写入的 native 事实。历史名称没有不可变快照时保持为空。
 */
export async function backfillInvoiceMetricFacts(input: {
	organizationId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(sql`
			insert into invoice_metric_fact (
				invoice_id, organization_id, campus_id, campus_attribution_kind,
				campus_name_snapshot, course_id, course_attribution_kind,
				course_name_snapshot, source, provenance, occurred_at
			)
			select i.id, i.organization_id, r.campus_id, 'linked', null,
				e.course_id, 'linked', null, 'independent_enrollment', 'derived', i.issued_at
			from invoice i
			inner join enrollment_registration r
				on r.invoice_id = i.id and r.organization_id = i.organization_id
			inner join enrollment e
				on e.id = r.enrollment_id and e.organization_id = i.organization_id
			where i.organization_id = ${input.organizationId}
			on conflict (invoice_id) do nothing
		`);

		await tx.execute(sql`
			insert into invoice_metric_fact (
				invoice_id, organization_id, campus_id, campus_attribution_kind,
				campus_name_snapshot, course_id, course_attribution_kind,
				course_name_snapshot, source, provenance, occurred_at
			)
			select i.id, i.organization_id, pc.campus_id,
				(case when pc.campus_id is null then 'unknown' else 'linked' end)::invoice_metric_campus_attribution_kind,
				null, e.course_id, 'linked', null, 'renewal', 'derived', i.issued_at
			from invoice i
			inner join enrollment_renewal r
				on r.invoice_id = i.id and r.organization_id = i.organization_id
			inner join enrollment e
				on e.id = r.enrollment_id and e.organization_id = i.organization_id
			left join enrollment_purchase_cycle pc
				on pc.source_renewal_id = r.id and pc.organization_id = i.organization_id
			where i.organization_id = ${input.organizationId}
			on conflict (invoice_id) do nothing
		`);

		await tx.execute(sql`
			insert into invoice_metric_fact (
				invoice_id, organization_id, campus_id, campus_attribution_kind,
				campus_name_snapshot, course_id, course_attribution_kind,
				course_name_snapshot, source, provenance, occurred_at
			)
			select i.id, i.organization_id, m.campus_id, 'linked', null,
				e.course_id,
				(case when e.id is null then 'not_applicable' else 'linked' end)::invoice_metric_course_attribution_kind,
				null, 'manual', 'derived', i.issued_at
			from invoice i
			inner join manual_invoice_creation m
				on m.invoice_id = i.id and m.organization_id = i.organization_id
			left join enrollment e
				on e.id = m.enrollment_id and e.organization_id = i.organization_id
			where i.organization_id = ${input.organizationId}
			on conflict (invoice_id) do nothing
		`);

		await tx.execute(sql`
			insert into invoice_metric_fact (
				invoice_id, organization_id, campus_id, campus_attribution_kind,
				campus_name_snapshot, course_id, course_attribution_kind,
				course_name_snapshot, source, provenance, occurred_at
			)
			select i.id, i.organization_id, pc.campus_id,
				(case when pc.campus_id is null then 'unknown' else 'linked' end)::invoice_metric_campus_attribution_kind,
				null, e.course_id, 'linked', null, 'lead_conversion', 'derived', i.issued_at
			from invoice i
			inner join enrollment e
				on e.id = i.enrollment_id
				and e.organization_id = i.organization_id
				and e.lead_id is not null
			left join enrollment_purchase_cycle pc
				on pc.enrollment_id = e.id
				and pc.organization_id = i.organization_id
				and pc.source = 'initial'
			where i.organization_id = ${input.organizationId}
			on conflict (invoice_id) do nothing
		`);

		await tx.execute(sql`
			insert into invoice_metric_fact (
				invoice_id, organization_id, campus_id, campus_attribution_kind,
				campus_name_snapshot, course_id, course_attribution_kind,
				course_name_snapshot, source, provenance, occurred_at
			)
			select i.id, i.organization_id, null, 'unknown', null,
				null, 'unknown', null,
				(case
					when i.source = 'renewal' then 'renewal'
					when i.source = 'manual' then 'manual'
					else 'independent_enrollment'
				end)::invoice_metric_source,
				'derived', i.issued_at
			from invoice i
			where i.organization_id = ${input.organizationId}
				and not exists (
					select 1 from invoice_metric_fact f where f.invoice_id = i.id
				)
		`);
	});
}
