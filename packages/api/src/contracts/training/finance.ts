import { z } from "zod";

const invoiceSettlementStatusSchema = z.enum([
	"pending",
	"partial",
	"paid",
	"refunded",
]);
export const invoiceSourceSchema = z.enum(["enrollment", "renewal", "manual"]);
export const invoiceBusinessActivityTypeSchema = z.enum([
	"course_enrollment",
	"course_renewal",
	"material_fee",
	"exam_fee",
	"price_difference",
	"other",
]);
export const manualInvoiceBusinessActivityTypeSchema = z.enum([
	"material_fee",
	"exam_fee",
	"price_difference",
	"other",
]);
const paymentMethodSchema = z.enum([
	"cash",
	"wechat",
	"alipay",
	"bankTransfer",
	"pos",
	"other",
]);

export const invoiceListInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	status: z
		.enum(["all", "open", "pending", "partial", "paid", "refunded"])
		.default("open"),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

const invoiceSummarySchema = z.object({
	id: z.uuid(),
	enrollmentId: z.uuid().nullable(),
	studentId: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	businessActivityType: invoiceBusinessActivityTypeSchema,
	summary: z.string(),
	amountInCents: z.number().int().nonnegative(),
	paidAmountInCents: z.number().int().nonnegative(),
	outstandingAmountInCents: z.number().int().nonnegative(),
	status: invoiceSettlementStatusSchema,
	isOverdue: z.boolean(),
	dueDate: z.iso.date(),
	issuedAt: z.iso.datetime({ offset: true }),
	createdByName: z.string().nullable(),
	version: z.number().int().positive(),
});

export const receiptSummarySchema = z.object({
	id: z.uuid(),
	number: z.string(),
	status: z.enum(["active", "voided"]),
	generatedAt: z.iso.datetime({ offset: true }),
});

const paymentRecordSchema = z.object({
	id: z.uuid(),
	amountInCents: z.number().int().positive(),
	reversedAmountInCents: z.number().int().nonnegative(),
	effectiveAmountInCents: z.number().int().nonnegative(),
	receivedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	referenceNo: z.string().nullable(),
	note: z.string().nullable(),
	operatorName: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
	reversals: z.array(
		z.object({
			id: z.uuid(),
			amountInCents: z.number().int().positive(),
			reason: z.string(),
			reversedAt: z.iso.datetime({ offset: true }),
			operatorName: z.string(),
			createdAt: z.iso.datetime({ offset: true }),
		}),
	),
	receipt: receiptSummarySchema.nullable(),
});

const receiptDocumentSchema = z.object({
	id: z.uuid(),
	number: z.string().regex(/^RCP-\d{6}-\d{6}$/),
	status: z.enum(["active", "voided"]),
	snapshotVersion: z.number().int().positive(),
	organizationName: z.string(),
	campusName: z.string(),
	studentId: z.uuid(),
	studentName: z.string(),
	invoiceId: z.uuid(),
	invoiceSummary: z.string(),
	invoiceAmountInCents: z.number().int().nonnegative(),
	title: z.string(),
	note: z.string().nullable(),
	replacesReceiptId: z.uuid().nullable(),
	generatedByName: z.string(),
	generatedAt: z.iso.datetime({ offset: true }),
	voidReason: z.string().nullable(),
	voidedByName: z.string().nullable(),
	voidedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const receiptDocumentViewSchema = z.object({
	document: receiptDocumentSchema,
	payments: z.array(
		z.object({
			paymentId: z.uuid(),
			amountInCents: z.number().int().positive(),
			receivedAt: z.iso.datetime({ offset: true }),
			method: paymentMethodSchema,
			referenceNo: z.string().nullable(),
		}),
	),
	currentFinancialStatus: z.object({
		payments: z.array(
			z.object({
				paymentId: z.uuid(),
				reversedAmountInCents: z.number().int().nonnegative(),
				effectiveAmountInCents: z.number().int().nonnegative(),
			}),
		),
		invoiceRefundedAmountInCents: z.number().int().nonnegative(),
		queriedAt: z.iso.datetime({ offset: true }),
	}),
});

export const generateReceiptDocumentInputSchema = z.object({
	paymentIds: z.array(z.uuid()).length(1),
	title: z.string().trim().min(1).max(100),
	note: z.string().trim().max(500).nullable().default(null),
	requestId: z.uuid(),
});
export const receiptDocumentMutationResultSchema = z.object({
	receiptId: z.uuid(),
	replayed: z.boolean(),
});
export const getReceiptDocumentInputSchema = z.object({ receiptId: z.uuid() });
export const getReceiptByPaymentInputSchema = z.object({ paymentId: z.uuid() });
export const getReceiptByPaymentResultSchema = z.object({
	receipt: receiptSummarySchema.nullable(),
});
export const voidReceiptDocumentInputSchema = z.object({
	receiptId: z.uuid(),
	reason: z.string().trim().min(1).max(500),
	requestId: z.uuid(),
});
export const reissueReceiptDocumentInputSchema = z.object({
	replacesReceiptId: z.uuid(),
	title: z.string().trim().min(1).max(100),
	note: z.string().trim().max(500).nullable().default(null),
	requestId: z.uuid(),
});

const refundRecordSchema = z.object({
	id: z.uuid(),
	amountInCents: z.number().int().positive(),
	refundedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	reason: z.string(),
	operatorName: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const invoiceListResultSchema = z.object({
	items: z.array(invoiceSummarySchema),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

export const invoiceDetailInputSchema = z.object({ id: z.uuid() });

export const invoiceDetailSchema = z.object({
	invoice: invoiceSummarySchema,
	payments: z.array(paymentRecordSchema),
	refunds: z.array(refundRecordSchema),
	adjustments: z.array(
		z.object({
			id: z.uuid(),
			beforeVersion: z.number().int().positive(),
			afterVersion: z.number().int().positive(),
			before: z.object({
				amountInCents: z.number().int().nonnegative(),
				dueDate: z.iso.date(),
				summary: z.string(),
			}),
			after: z.object({
				amountInCents: z.number().int().nonnegative(),
				dueDate: z.iso.date(),
				summary: z.string(),
			}),
			reason: z.string(),
			operatorName: z.string(),
			createdAt: z.iso.datetime({ offset: true }),
		}),
	),
	capabilities: z.object({
		canAdjustAmount: z.boolean(),
		canAdjustDueDate: z.boolean(),
		canAdjustSummary: z.boolean(),
	}),
	historicalPaidAmountInCents: z.number().int().nonnegative(),
});

export const manualInvoiceOptionsInputSchema = z.object({
	query: z.string().trim().min(1).max(100).optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

export const manualInvoiceOptionsSchema = z.object({
	students: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			campusId: z.uuid(),
			campusName: z.string(),
			enrollments: z.array(
				z.object({
					id: z.uuid(),
					courseId: z.uuid(),
					courseName: z.string(),
					status: z.enum(["active", "frozen"]),
				}),
			),
		}),
	),
	nextCursor: z.string().nullable(),
});

export const createManualInvoiceInputSchema = z.object({
	studentId: z.uuid(),
	enrollmentId: z.uuid().nullable().default(null),
	businessActivityType: manualInvoiceBusinessActivityTypeSchema,
	summary: z.string().trim().min(1).max(200),
	amountInCents: z.number().int().min(1).max(100_000_000),
	dueDate: z.iso.date(),
	requestId: z.uuid(),
});

export const createManualInvoiceResultSchema = z.object({
	invoiceId: z.uuid(),
	replayed: z.boolean(),
});

export const adjustInvoiceInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000).optional(),
		dueDate: z.iso.date().optional(),
		summary: z.string().trim().min(1).max(200).optional(),
		reason: z.string().trim().min(1).max(500),
		expectedVersion: z.number().int().positive(),
		requestId: z.uuid(),
	})
	.refine(
		(input) =>
			input.amountInCents !== undefined ||
			input.dueDate !== undefined ||
			input.summary !== undefined,
		{ message: "请至少修改一个账单字段" },
	);

const invoiceAdjustmentResultRecordSchema = z.object({
	id: z.uuid(),
	invoiceId: z.uuid(),
	beforeVersion: z.number().int().positive(),
	afterVersion: z.number().int().positive(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const adjustInvoiceResultSchema = z.object({
	adjustment: invoiceAdjustmentResultRecordSchema,
	replayed: z.boolean(),
});

export const createPaymentInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000),
		receivedAt: z.iso.datetime({ offset: true }),
		method: paymentMethodSchema,
		referenceNo: z.string().trim().max(100).nullable().default(null),
		note: z.string().trim().max(500).nullable().default(null),
		requestId: z.uuid(),
	})
	.refine((data) => data.method !== "other" || Boolean(data.note), {
		message: "选择其他收款方式时请填写备注",
		path: ["note"],
	});

export const createPaymentResultSchema = z.object({
	payment: paymentRecordSchema,
});

export const createPaymentReversalInputSchema = z.object({
	paymentId: z.uuid(),
	amountInCents: z.number().int().min(1).max(100_000_000),
	reason: z.string().trim().min(1, "请填写冲正原因").max(500),
	reversedAt: z.iso.datetime({ offset: true }),
	requestId: z.uuid(),
});

export const createPaymentReversalResultSchema = z.object({
	reversal: z.object({
		id: z.uuid(),
		invoiceId: z.uuid(),
		paymentId: z.uuid(),
		amountInCents: z.number().int().positive(),
		reason: z.string(),
		reversedAt: z.iso.datetime({ offset: true }),
		operatorName: z.string(),
		createdAt: z.iso.datetime({ offset: true }),
	}),
	payment: z.object({
		id: z.uuid(),
		originalAmountInCents: z.number().int().positive(),
		reversedAmountInCents: z.number().int().nonnegative(),
		effectiveAmountInCents: z.number().int().nonnegative(),
	}),
	invoice: z.object({
		id: z.uuid(),
		paidAmountInCents: z.number().int().nonnegative(),
		status: invoiceSettlementStatusSchema,
		paidAt: z.iso.datetime({ offset: true }).nullable(),
	}),
	replayed: z.boolean(),
});

const enrollmentAdjustmentSchema = z.object({
	id: z.uuid(),
	studentId: z.uuid(),
	studentName: z.string(),
	campusId: z.uuid(),
	campusName: z.string(),
	courseId: z.uuid(),
	courseName: z.string(),
	purchasedLessons: z.number().int().nonnegative(),
	remainingLessons: z.number().int().nonnegative(),
	status: z.enum(["active", "frozen", "transferred"]),
});

export const enrollmentAdjustmentListResultSchema = z.object({
	items: z.array(enrollmentAdjustmentSchema),
	courses: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export const renewEnrollmentInputSchema = z.object({
	enrollmentId: z.uuid(),
	addedLessons: z.number().int().min(1).max(10_000),
	amountInCents: z.number().int().min(0).max(100_000_000),
	dueDate: z.iso.date(),
	requestId: z.uuid(),
});

export const renewEnrollmentResultSchema = z.object({
	enrollmentId: z.uuid(),
	invoiceId: z.uuid(),
	addedLessons: z.number().int().positive(),
});

export const transferEnrollmentInputSchema = z.object({
	sourceEnrollmentId: z.uuid(),
	targetCourseId: z.uuid(),
	requestId: z.uuid(),
});

export const transferEnrollmentResultSchema = z.object({
	sourceEnrollmentId: z.uuid(),
	targetEnrollmentId: z.uuid(),
	transferredLessons: z.number().int().positive(),
});

export const createRefundInputSchema = z
	.object({
		invoiceId: z.uuid(),
		amountInCents: z.number().int().min(1).max(100_000_000),
		refundedAt: z.iso.datetime({ offset: true }),
		method: paymentMethodSchema,
		reason: z.string().trim().min(1).max(500),
		requestId: z.uuid(),
	})
	.refine((data) => data.method !== "other" || Boolean(data.reason), {
		message: "选择其他退款方式时请填写退款原因",
		path: ["reason"],
	});

export const createRefundResultSchema = z.object({
	refund: refundRecordSchema,
});

export const refundRequestStatusSchema = z.enum([
	"pending",
	"approved",
	"rejected",
	"cancelled",
]);

const refundRequestEventSchema = z.object({
	id: z.uuid(),
	action: z.enum(["submitted", "approved", "rejected", "cancelled"]),
	fromStatus: refundRequestStatusSchema.nullable(),
	toStatus: refundRequestStatusSchema,
	comment: z.string().nullable(),
	operatorUserId: z.string(),
	operatorName: z.string(),
	requestId: z.uuid(),
	createdAt: z.iso.datetime({ offset: true }),
});

export const refundRequestSchema = z.object({
	id: z.uuid(),
	invoiceId: z.uuid(),
	campusId: z.uuid(),
	amountInCents: z.number().int().positive(),
	refundedAt: z.iso.datetime({ offset: true }),
	method: paymentMethodSchema,
	reason: z.string(),
	applicantUserId: z.string(),
	applicantName: z.string(),
	status: refundRequestStatusSchema,
	version: z.number().int().positive(),
	refundId: z.uuid().nullable(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
	events: z.array(refundRequestEventSchema),
});

export const refundRequestListInputSchema = z.object({ invoiceId: z.uuid() });
export const refundRequestListResultSchema = z.object({
	items: z.array(refundRequestSchema),
});

export const createRefundRequestInputSchema = createRefundInputSchema;
export const createRefundRequestResultSchema = z.object({
	request: refundRequestSchema,
	replayed: z.boolean(),
});

export const decideRefundRequestInputSchema = z
	.object({
		refundRequestId: z.uuid(),
		action: z.enum(["approved", "rejected"]),
		comment: z.string().trim().max(500).nullable().default(null),
		expectedVersion: z.number().int().positive(),
		requestId: z.uuid(),
	})
	.refine(
		(input) => input.action !== "rejected" || Boolean(input.comment?.trim()),
		{ message: "拒绝退款申请时必须填写原因", path: ["comment"] },
	);

export const decideRefundRequestResultSchema = createRefundRequestResultSchema;

export const cancelRefundRequestInputSchema = z.object({
	refundRequestId: z.uuid(),
	reason: z.string().trim().max(500).nullable().default(null),
	expectedVersion: z.number().int().positive(),
	requestId: z.uuid(),
});

export const cancelRefundRequestResultSchema = createRefundRequestResultSchema;

export const arrearsStatusSchema = z.enum([
	"pending",
	"following_up",
	"promised",
	"paused",
	"resolved",
]);

const arrearsCycleSchema = z.object({
	id: z.uuid(),
	cycleNumber: z.number().int().positive(),
	status: arrearsStatusSchema,
	version: z.number().int().positive(),
	promisedPaymentDate: z.iso.date().nullable(),
	resumeDate: z.iso.date().nullable(),
});

const arrearsEventSchema = z.object({
	id: z.uuid(),
	eventType: z.enum([
		"cycle_started",
		"status_changed",
		"note_added",
		"auto_resolved",
	]),
	fromStatus: arrearsStatusSchema.nullable(),
	toStatus: arrearsStatusSchema.nullable(),
	promisedPaymentDate: z.iso.date().nullable(),
	resumeDate: z.iso.date().nullable(),
	reason: z.string().nullable(),
	note: z.string().nullable(),
	operatorName: z.string().nullable(),
	sourceType: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
});

const arrearsRecordSchema = z.object({
	invoiceId: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	summary: z.string(),
	amountInCents: z.number().int().nonnegative(),
	paidAmountInCents: z.number().int().nonnegative(),
	outstandingAmountInCents: z.number().int().positive(),
	dueDate: z.iso.date(),
	isOverdue: z.boolean(),
	cycle: arrearsCycleSchema.pick({
		id: true,
		cycleNumber: true,
		status: true,
		version: true,
		promisedPaymentDate: true,
		resumeDate: true,
	}),
	latestEvent: z
		.object({
			eventType: arrearsEventSchema.shape.eventType,
			operatorName: z.string().nullable(),
			createdAt: z.iso.datetime({ offset: true }),
		})
		.nullable(),
});

export const arrearsListInputSchema = z.object({
	status: arrearsStatusSchema.exclude(["resolved"]).optional(),
	pausedWithoutResumeOnly: z.boolean().optional(),
	cursor: z.string().min(1).max(256).optional(),
	pageSize: z.number().int().min(1).max(50).default(20),
});

export const arrearsListResultSchema = z.object({
	items: z.array(arrearsRecordSchema),
	nextCursor: z.string().nullable(),
});

export const arrearsDetailInputSchema = z.object({
	invoiceId: z.uuid(),
});

export const arrearsDetailResultSchema = z.object({
	invoiceId: z.uuid(),
	cycles: z.array(
		arrearsCycleSchema.extend({
			startedAt: z.iso.datetime({ offset: true }),
			resolvedAt: z.iso.datetime({ offset: true }).nullable(),
			createdAt: z.iso.datetime({ offset: true }),
			updatedAt: z.iso.datetime({ offset: true }),
			events: z.array(arrearsEventSchema),
		}),
	),
});

export const transitionArrearsInputSchema = z
	.object({
		invoiceId: z.uuid(),
		toStatus: z.enum(["following_up", "promised", "paused"]),
		promisedPaymentDate: z.iso.date().nullable().default(null),
		resumeDate: z.iso.date().nullable().default(null),
		reason: z.string().trim().max(500).nullable().default(null),
		note: z.string().trim().max(500).nullable().default(null),
		expectedVersion: z.number().int().positive(),
		requestId: z.uuid(),
	})
	.superRefine((input, context) => {
		if (input.toStatus === "promised" && !input.promisedPaymentDate) {
			context.addIssue({
				code: "custom",
				message: "承诺付款日期不能为空。",
				path: ["promisedPaymentDate"],
			});
		}
		if (input.toStatus === "paused" && !input.reason?.trim()) {
			context.addIssue({
				code: "custom",
				message: "暂停追缴时必须填写原因。",
				path: ["reason"],
			});
		}
		if (
			input.toStatus === "following_up" &&
			(input.promisedPaymentDate || input.resumeDate || input.reason)
		) {
			context.addIssue({
				code: "custom",
				message: "跟进中不接受承诺日期、恢复日期或暂停原因。",
				path: ["toStatus"],
			});
		}
	});

export const addArrearsNoteInputSchema = z.object({
	invoiceId: z.uuid(),
	note: z.string().trim().min(1).max(500),
	expectedVersion: z.number().int().positive(),
	requestId: z.uuid(),
});

export const arrearsMutationResultSchema = z.object({
	cycle: arrearsCycleSchema,
	replayed: z.boolean(),
});

export type InvoiceListInput = z.infer<typeof invoiceListInputSchema>;
export type InvoiceListResult = z.infer<typeof invoiceListResultSchema>;
export type InvoiceDetailInput = z.infer<typeof invoiceDetailInputSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type ReceiptDocumentView = z.infer<typeof receiptDocumentViewSchema>;
export type GenerateReceiptDocumentInput = z.infer<
	typeof generateReceiptDocumentInputSchema
>;
export type GetReceiptDocumentInput = z.infer<
	typeof getReceiptDocumentInputSchema
>;
export type GetReceiptByPaymentInput = z.infer<
	typeof getReceiptByPaymentInputSchema
>;
export type GetReceiptByPaymentResult = z.infer<
	typeof getReceiptByPaymentResultSchema
>;
export type VoidReceiptDocumentInput = z.infer<
	typeof voidReceiptDocumentInputSchema
>;
export type ReissueReceiptDocumentInput = z.infer<
	typeof reissueReceiptDocumentInputSchema
>;
export type ReceiptDocumentMutationResult = z.infer<
	typeof receiptDocumentMutationResultSchema
>;
export type ManualInvoiceOptionsInput = z.infer<
	typeof manualInvoiceOptionsInputSchema
>;
export type ManualInvoiceOptions = z.infer<typeof manualInvoiceOptionsSchema>;
export type CreateManualInvoiceInput = z.infer<
	typeof createManualInvoiceInputSchema
>;
export type CreateManualInvoiceResult = z.infer<
	typeof createManualInvoiceResultSchema
>;
export type AdjustInvoiceInput = z.infer<typeof adjustInvoiceInputSchema>;
export type AdjustInvoiceResult = z.infer<typeof adjustInvoiceResultSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
export type CreatePaymentResult = z.infer<typeof createPaymentResultSchema>;
export type CreatePaymentReversalInput = z.infer<
	typeof createPaymentReversalInputSchema
>;
export type CreatePaymentReversalResult = z.infer<
	typeof createPaymentReversalResultSchema
>;
export type EnrollmentAdjustmentListResult = z.infer<
	typeof enrollmentAdjustmentListResultSchema
>;
export type RenewEnrollmentInput = z.infer<typeof renewEnrollmentInputSchema>;
export type RenewEnrollmentResult = z.infer<typeof renewEnrollmentResultSchema>;
export type TransferEnrollmentInput = z.infer<
	typeof transferEnrollmentInputSchema
>;
export type TransferEnrollmentResult = z.infer<
	typeof transferEnrollmentResultSchema
>;
export type CreateRefundInput = z.infer<typeof createRefundInputSchema>;
export type CreateRefundResult = z.infer<typeof createRefundResultSchema>;
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type RefundRequestListInput = z.infer<
	typeof refundRequestListInputSchema
>;
export type RefundRequestListResult = z.infer<
	typeof refundRequestListResultSchema
>;
export type CreateRefundRequestInput = z.infer<
	typeof createRefundRequestInputSchema
>;
export type CreateRefundRequestResult = z.infer<
	typeof createRefundRequestResultSchema
>;
export type DecideRefundRequestInput = z.infer<
	typeof decideRefundRequestInputSchema
>;
export type DecideRefundRequestResult = z.infer<
	typeof decideRefundRequestResultSchema
>;
export type CancelRefundRequestInput = z.infer<
	typeof cancelRefundRequestInputSchema
>;
export type CancelRefundRequestResult = z.infer<
	typeof cancelRefundRequestResultSchema
>;
export type ArrearsListResult = z.infer<typeof arrearsListResultSchema>;
export type ArrearsListInput = z.infer<typeof arrearsListInputSchema>;
export type ArrearsDetailInput = z.infer<typeof arrearsDetailInputSchema>;
export type ArrearsDetailResult = z.infer<typeof arrearsDetailResultSchema>;
export type TransitionArrearsInput = z.infer<
	typeof transitionArrearsInputSchema
>;
export type AddArrearsNoteInput = z.infer<typeof addArrearsNoteInputSchema>;
export type ArrearsMutationResult = z.infer<typeof arrearsMutationResultSchema>;
