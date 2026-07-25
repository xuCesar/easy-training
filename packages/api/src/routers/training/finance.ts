import {
	addArrearsNoteInputSchema,
	adjustInvoiceInputSchema,
	adjustInvoiceResultSchema,
	arrearsDetailInputSchema,
	arrearsDetailResultSchema,
	arrearsListInputSchema,
	arrearsListResultSchema,
	arrearsMutationResultSchema,
	cancelRefundRequestInputSchema,
	cancelRefundRequestResultSchema,
	createManualInvoiceInputSchema,
	createManualInvoiceResultSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	createPaymentReversalInputSchema,
	createPaymentReversalResultSchema,
	createRefundRequestInputSchema,
	createRefundRequestResultSchema,
	decideRefundRequestInputSchema,
	decideRefundRequestResultSchema,
	enrollmentAdjustmentListResultSchema,
	generateReceiptDocumentInputSchema,
	getReceiptByPaymentInputSchema,
	getReceiptByPaymentResultSchema,
	getReceiptDocumentInputSchema,
	invoiceDetailInputSchema,
	invoiceDetailSchema,
	invoiceListInputSchema,
	invoiceListResultSchema,
	manualInvoiceOptionsInputSchema,
	manualInvoiceOptionsSchema,
	receiptDocumentMutationResultSchema,
	receiptDocumentViewSchema,
	refundRequestListInputSchema,
	refundRequestListResultSchema,
	reissueReceiptDocumentInputSchema,
	renewEnrollmentInputSchema,
	renewEnrollmentResultSchema,
	transferEnrollmentInputSchema,
	transferEnrollmentResultSchema,
	transitionArrearsInputSchema,
	voidReceiptDocumentInputSchema,
} from "../../contracts/training";
import { financeProcedure } from "../../index";
import {
	addArrearsNote,
	getArrearsDetail,
	listArrears,
	listEnrollmentAdjustments,
	renewEnrollment,
	transferEnrollment,
	transitionArrears,
} from "../../repositories/enrollment-finance-adjustments";
import {
	adjustInvoice,
	createManualInvoice,
	createPayment,
	getInvoiceDetail,
	getManualInvoiceOptions,
	listInvoices,
} from "../../repositories/finance";
import { createPaymentReversal } from "../../repositories/payment-reversals";
import {
	generateReceiptDocument,
	getReceiptByPayment,
	getReceiptDocument,
	reissueReceiptDocument,
	voidReceiptDocument,
} from "../../repositories/receipt-documents";
import {
	cancelRefundRequest,
	createRefundRequest,
	decideRefundRequest,
	listRefundRequests,
} from "../../repositories/refund-approval";

export const financeRouter = {
	invoices: {
		list: financeProcedure
			.input(invoiceListInputSchema)
			.output(invoiceListResultSchema)
			.handler(({ context, input }) =>
				listInvoices(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		detail: financeProcedure
			.input(invoiceDetailInputSchema)
			.output(invoiceDetailSchema)
			.handler(({ context, input }) =>
				getInvoiceDetail(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		manualOptions: financeProcedure
			.input(manualInvoiceOptionsInputSchema)
			.output(manualInvoiceOptionsSchema)
			.handler(({ context, input }) =>
				getManualInvoiceOptions(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		createManual: financeProcedure
			.input(createManualInvoiceInputSchema)
			.output(createManualInvoiceResultSchema)
			.handler(({ context, input }) =>
				createManualInvoice(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		adjust: financeProcedure
			.input(adjustInvoiceInputSchema)
			.output(adjustInvoiceResultSchema)
			.handler(({ context, input }) =>
				adjustInvoice(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	payments: {
		create: financeProcedure
			.input(createPaymentInputSchema)
			.output(createPaymentResultSchema)
			.handler(({ context, input }) =>
				createPayment(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	paymentReversals: {
		create: financeProcedure
			.input(createPaymentReversalInputSchema)
			.output(createPaymentReversalResultSchema)
			.handler(({ context, input }) =>
				createPaymentReversal(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
					},
					input,
				),
			),
	},
	receipts: {
		getByPayment: financeProcedure
			.input(getReceiptByPaymentInputSchema)
			.output(getReceiptByPaymentResultSchema)
			.handler(({ context, input }) =>
				getReceiptByPayment(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		get: financeProcedure
			.input(getReceiptDocumentInputSchema)
			.output(receiptDocumentViewSchema)
			.handler(({ context, input }) =>
				getReceiptDocument(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		generate: financeProcedure
			.input(generateReceiptDocumentInputSchema)
			.output(receiptDocumentMutationResultSchema)
			.handler(({ context, input }) =>
				generateReceiptDocument(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		void: financeProcedure
			.input(voidReceiptDocumentInputSchema)
			.output(receiptDocumentMutationResultSchema)
			.handler(({ context, input }) =>
				voidReceiptDocument(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		reissue: financeProcedure
			.input(reissueReceiptDocumentInputSchema)
			.output(receiptDocumentMutationResultSchema)
			.handler(({ context, input }) =>
				reissueReceiptDocument(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	adjustments: {
		list: financeProcedure
			.output(enrollmentAdjustmentListResultSchema)
			.handler(({ context }) =>
				listEnrollmentAdjustments({
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				}),
			),
		renew: financeProcedure
			.input(renewEnrollmentInputSchema)
			.output(renewEnrollmentResultSchema)
			.handler(({ context, input }) =>
				renewEnrollment(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		transfer: financeProcedure
			.input(transferEnrollmentInputSchema)
			.output(transferEnrollmentResultSchema)
			.handler(({ context, input }) =>
				transferEnrollment(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	refundRequests: {
		list: financeProcedure
			.input(refundRequestListInputSchema)
			.output(refundRequestListResultSchema)
			.handler(({ context, input }) =>
				listRefundRequests(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: financeProcedure
			.input(createRefundRequestInputSchema)
			.output(createRefundRequestResultSchema)
			.handler(({ context, input }) =>
				createRefundRequest(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		decide: financeProcedure
			.input(decideRefundRequestInputSchema)
			.output(decideRefundRequestResultSchema)
			.handler(({ context, input }) =>
				decideRefundRequest(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		cancel: financeProcedure
			.input(cancelRefundRequestInputSchema)
			.output(cancelRefundRequestResultSchema)
			.handler(({ context, input }) =>
				cancelRefundRequest(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
	arrears: {
		list: financeProcedure
			.input(arrearsListInputSchema)
			.output(arrearsListResultSchema)
			.handler(({ context, input }) =>
				listArrears(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		detail: financeProcedure
			.input(arrearsDetailInputSchema)
			.output(arrearsDetailResultSchema)
			.handler(({ context, input }) =>
				getArrearsDetail(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		transition: financeProcedure
			.input(transitionArrearsInputSchema)
			.output(arrearsMutationResultSchema)
			.handler(({ context, input }) =>
				transitionArrears(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		addNote: financeProcedure
			.input(addArrearsNoteInputSchema)
			.output(arrearsMutationResultSchema)
			.handler(({ context, input }) =>
				addArrearsNote(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
	},
};
