import { db } from "../index";
import { invoiceMetricFact } from "../schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
		source:
			| "lead_conversion"
			| "independent_enrollment"
			| "renewal"
			| "manual";
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
			input.course.kind === "linked"
				? input.course.courseNameSnapshot
				: null,
		source: input.source,
		provenance: "native",
		occurredAt: input.occurredAt,
	});
}
