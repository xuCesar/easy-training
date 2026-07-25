import type { RouterClient } from "@orpc/server";

import {
	analyticsExportInputSchema,
	analyticsExportResultSchema,
	analyticsSavedFilterCreateInputSchema,
	analyticsSavedFilterDeleteInputSchema,
	analyticsSavedFilterListResultSchema,
	analyticsSavedFilterSchema,
	analyticsSavedFilterUpdateInputSchema,
	businessMetricAttendanceResultSchema,
	businessMetricComparisonInputSchema,
	businessMetricComparisonResultSchema,
	businessMetricConsumptionResultSchema,
	businessMetricDrilldownInputSchema,
	businessMetricDrilldownResultSchema,
	businessMetricFinancialAgingDrilldownInputSchema,
	businessMetricFinancialAgingDrilldownResultSchema,
	businessMetricFinancialDrilldownInputSchema,
	businessMetricFinancialDrilldownResultSchema,
	businessMetricFinancialReceiptResultSchema,
	businessMetricFinancialResultSchema,
	businessMetricQueryInputSchema,
	businessMetricRenewalResultSchema,
	businessMetricResourceResultSchema,
	businessMetricSalesResultSchema,
} from "../contracts/business-metrics";

import {
	addArrearsNoteInputSchema,
	addLeadFollowUpInputSchema,
	adjustInvoiceInputSchema,
	adjustInvoiceResultSchema,
	arrearsDetailInputSchema,
	arrearsDetailResultSchema,
	arrearsListInputSchema,
	arrearsListResultSchema,
	arrearsMutationResultSchema,
	campusListInputSchema,
	campusListResultSchema,
	cancelRefundRequestInputSchema,
	cancelRefundRequestResultSchema,
	claimInvitationInputSchema,
	claimInvitationResultSchema,
	confirmLeadImportInputSchema,
	confirmLeadImportResultSchema,
	convertLeadInputSchema,
	convertLeadResultSchema,
	createCampusInputSchema,
	createIndependentEnrollmentInputSchema,
	createIndependentEnrollmentResultSchema,
	createInvitationInputSchema,
	createInvitationResultSchema,
	createLeadInputSchema,
	createLeadResultSchema,
	createManualInvoiceInputSchema,
	createManualInvoiceResultSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	createPaymentReversalInputSchema,
	createPaymentReversalResultSchema,
	createRefundRequestInputSchema,
	createRefundRequestResultSchema,
	currentOrganizationSchema,
	decideRefundRequestInputSchema,
	decideRefundRequestResultSchema,
	enrollmentAdjustmentListResultSchema,
	exportLeadsInputSchema,
	exportLeadsResultSchema,
	generateReceiptDocumentInputSchema,
	getReceiptByPaymentInputSchema,
	getReceiptByPaymentResultSchema,
	getReceiptDocumentInputSchema,
	independentEnrollmentOptionsInputSchema,
	independentEnrollmentOptionsSchema,
	invitationListResultSchema,
	invoiceDetailInputSchema,
	invoiceDetailSchema,
	invoiceListInputSchema,
	invoiceListResultSchema,
	leadConversionOptionsInputSchema,
	leadConversionOptionsSchema,
	leadDetailInputSchema,
	leadFilterOptionsSchema,
	leadHistoryInputSchema,
	leadHistoryResultSchema,
	leadListInputSchema,
	leadListResultSchema,
	leadRecordSchema,
	manualInvoiceOptionsInputSchema,
	manualInvoiceOptionsSchema,
	memberListResultSchema,
	memberOwnerImpactInputSchema,
	memberOwnerImpactResultSchema,
	previewLeadImportInputSchema,
	previewLeadImportResultSchema,
	receiptDocumentMutationResultSchema,
	receiptDocumentViewSchema,
	refundRequestListInputSchema,
	refundRequestListResultSchema,
	reissueReceiptDocumentInputSchema,
	removeMemberInputSchema,
	renewEnrollmentInputSchema,
	renewEnrollmentResultSchema,
	resendInvitationInputSchema,
	revokeInvitationInputSchema,
	selectOrganizationInputSchema,
	setCampusActiveInputSchema,
	transferEnrollmentInputSchema,
	transferEnrollmentResultSchema,
	transitionArrearsInputSchema,
	updateCampusInputSchema,
	updateEnrollmentLifecycleInputSchema,
	updateEnrollmentLifecycleResultSchema,
	updateLeadInputSchema,
	updateMemberInputSchema,
	voidReceiptDocumentInputSchema,
} from "../contracts/training";
import {
	currentOrganizationProcedure,
	financeProcedure,
	leadExportProcedure,
	leadProcedure,
	organizationManagementProcedure,
	organizationProcedure,
	protectedProcedure,
	publicProcedure,
	studentProcedure,
} from "../index";
import {
	createBusinessMetricSavedFilter,
	deleteBusinessMetricSavedFilter,
	exportBusinessMetrics,
	getBusinessMetricAttendance,
	getBusinessMetricComparison,
	getBusinessMetricConsumption,
	getBusinessMetricDrilldown,
	getBusinessMetricFinancial,
	getBusinessMetricFinancialAgingDrilldown,
	getBusinessMetricFinancialDrilldown,
	getBusinessMetricFinancialReceipts,
	getBusinessMetricRenewal,
	getBusinessMetricResource,
	getBusinessMetricSales,
	listBusinessMetricSavedFilters,
	updateBusinessMetricSavedFilter,
} from "../repositories/business-metrics";
import {
	convertLead,
	getLeadConversionOptions,
} from "../repositories/enrollment-conversion";
import {
	addArrearsNote,
	getArrearsDetail,
	listArrears,
	listEnrollmentAdjustments,
	renewEnrollment,
	transferEnrollment,
	transitionArrears,
} from "../repositories/enrollment-finance-adjustments";
import { updateEnrollmentLifecycle } from "../repositories/enrollment-lifecycle";
import {
	createIndependentEnrollment,
	getIndependentEnrollmentOptions,
} from "../repositories/enrollment-registration";
import {
	adjustInvoice,
	createManualInvoice,
	createPayment,
	getInvoiceDetail,
	getManualInvoiceOptions,
	listInvoices,
} from "../repositories/finance";
import {
	addLeadFollowUp,
	createLead,
	exportLeads,
	getLead,
	getLeadFilterOptions,
	getLeadHistory,
	listLeads,
	updateLead,
} from "../repositories/leads";
import {
	confirmLeadImport,
	previewLeadImport,
} from "../repositories/operations";
import {
	type CurrentOrganization as CurrentOrganizationContext,
	selectCurrentOrganization,
} from "../repositories/organization";
import {
	claimInvitation,
	createCampus,
	createInvitation,
	listCampuses,
	listInvitations,
	listMembers,
	previewMemberOwnerImpact,
	removeMember,
	resendInvitation,
	revokeInvitation,
	setCampusActive,
	updateCampus,
	updateMember,
} from "../repositories/organization-management";
import { createPaymentReversal } from "../repositories/payment-reversals";
import {
	generateReceiptDocument,
	getReceiptByPayment,
	getReceiptDocument,
	reissueReceiptDocument,
	voidReceiptDocument,
} from "../repositories/receipt-documents";
import {
	cancelRefundRequest,
	createRefundRequest,
	decideRefundRequest,
	listRefundRequests,
} from "../repositories/refund-approval";
import { auditRouter } from "./training/audit";
import { dashboardSnapshotProcedure } from "./training/dashboard";
import { notificationsRouter } from "./training/notifications";
import { operationTasksRouter } from "./training/operation-tasks";
import { searchRouter } from "./training/search";
import { studentsRouter } from "./training/students";
import { teachingRouter } from "./training/teaching";

function toCurrentOrganizationResponse(
	context: Pick<
		CurrentOrganizationContext,
		"organization" | "role" | "organizations"
	>,
) {
	return {
		id: context.organization.id,
		name: context.organization.name,
		role: context.role,
		organizations: context.organizations,
	};
}

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	training: {
		search: searchRouter,
		organization: {
			current: currentOrganizationProcedure
				.output(currentOrganizationSchema)
				.handler(({ context }) => toCurrentOrganizationResponse(context)),
			select: protectedProcedure
				.input(selectOrganizationInputSchema)
				.output(currentOrganizationSchema)
				.handler(async ({ context, input }) => {
					const currentOrganization = await selectCurrentOrganization({
						userId: context.session.user.id,
						sessionId: context.session.session.id,
						organizationId: input.organizationId,
					});

					return toCurrentOrganizationResponse(currentOrganization);
				}),
		},
		campuses: {
			list: organizationProcedure
				.input(campusListInputSchema)
				.output(campusListResultSchema)
				.handler(({ context, input }) =>
					listCampuses(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			create: organizationManagementProcedure
				.input(createCampusInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					createCampus(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			update: organizationManagementProcedure
				.input(updateCampusInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					updateCampus(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			setActive: organizationManagementProcedure
				.input(setCampusActiveInputSchema)
				.output(campusListResultSchema.shape.items.element)
				.handler(({ context, input }) =>
					setCampusActive(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		members: {
			list: organizationManagementProcedure
				.output(memberListResultSchema)
				.handler(({ context }) =>
					listMembers({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
			update: organizationManagementProcedure
				.input(updateMemberInputSchema)
				.handler(({ context, input }) =>
					updateMember(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			ownerImpact: organizationManagementProcedure
				.input(memberOwnerImpactInputSchema)
				.output(memberOwnerImpactResultSchema)
				.handler(({ context, input }) =>
					previewMemberOwnerImpact(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			remove: organizationManagementProcedure
				.input(removeMemberInputSchema)
				.handler(({ context, input }) =>
					removeMember(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		invitations: {
			list: organizationManagementProcedure
				.output(invitationListResultSchema)
				.handler(({ context }) =>
					listInvitations({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
			create: organizationManagementProcedure
				.input(createInvitationInputSchema)
				.output(createInvitationResultSchema)
				.handler(({ context, input }) =>
					createInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			revoke: organizationManagementProcedure
				.input(revokeInvitationInputSchema)
				.handler(({ context, input }) =>
					revokeInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			resend: organizationManagementProcedure
				.input(resendInvitationInputSchema)
				.output(createInvitationResultSchema)
				.handler(({ context, input }) =>
					resendInvitation(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			claim: protectedProcedure
				.input(claimInvitationInputSchema)
				.output(claimInvitationResultSchema)
				.handler(({ context, input }) =>
					claimInvitation(input, {
						userId: context.session.user.id,
						email: context.session.user.email,
						emailVerified: context.session.user.emailVerified,
						sessionId: context.session.session.id,
					}),
				),
		},
		notifications: notificationsRouter,
		audit: auditRouter,
		students: studentsRouter,
		teaching: teachingRouter,
		enrollments: {
			lifecycle: studentProcedure
				.input(updateEnrollmentLifecycleInputSchema)
				.output(updateEnrollmentLifecycleResultSchema)
				.handler(({ context, input }) =>
					updateEnrollmentLifecycle(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
						},
						input,
					),
				),
			independentOptions: studentProcedure
				.input(independentEnrollmentOptionsInputSchema)
				.output(independentEnrollmentOptionsSchema)
				.handler(({ context, input }) =>
					getIndependentEnrollmentOptions(
						{
							organizationId: context.organization.id,
							role: context.role,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			createIndependent: studentProcedure
				.input(createIndependentEnrollmentInputSchema)
				.output(createIndependentEnrollmentResultSchema)
				.handler(({ context, input }) =>
					createIndependentEnrollment(
						{
							organizationId: context.organization.id,
							role: context.role,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		leads: {
			get: leadProcedure
				.input(leadDetailInputSchema)
				.output(leadRecordSchema)
				.handler(({ context, input }) =>
					getLead(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			import: {
				preview: leadProcedure
					.input(previewLeadImportInputSchema)
					.output(previewLeadImportResultSchema)
					.handler(({ context, input }) =>
						previewLeadImport(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				confirm: leadProcedure
					.input(confirmLeadImportInputSchema)
					.output(confirmLeadImportResultSchema)
					.handler(({ context, input }) =>
						confirmLeadImport(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
			},
			filterOptions: leadProcedure
				.output(leadFilterOptionsSchema)
				.handler(({ context }) =>
					getLeadFilterOptions({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
			conversionOptions: leadProcedure
				.input(leadConversionOptionsInputSchema)
				.output(leadConversionOptionsSchema)
				.handler(({ context, input }) =>
					getLeadConversionOptions(
						{
							organizationId: context.organization.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			convert: leadProcedure
				.input(convertLeadInputSchema)
				.output(convertLeadResultSchema)
				.handler(({ context, input }) =>
					convertLead(
						{
							organizationId: context.organization.id,
							role: context.role,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			list: leadProcedure
				.input(leadListInputSchema)
				.output(leadListResultSchema)
				.handler(({ context, input }) =>
					listLeads(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			create: leadProcedure
				.input(createLeadInputSchema)
				.output(createLeadResultSchema)
				.handler(({ context, input }) =>
					createLead(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			update: leadProcedure
				.input(updateLeadInputSchema)
				.handler(({ context, input }) =>
					updateLead(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			followUp: leadProcedure
				.input(addLeadFollowUpInputSchema)
				.handler(({ context, input }) =>
					addLeadFollowUp(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			history: leadProcedure
				.input(leadHistoryInputSchema)
				.output(leadHistoryResultSchema)
				.handler(({ context, input }) =>
					getLeadHistory(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input.leadId,
					),
				),
			export: leadExportProcedure
				.input(exportLeadsInputSchema)
				.output(exportLeadsResultSchema)
				.handler(({ context, input }) =>
					exportLeads(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		finance: {
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
		},
		operations: {
			tasks: operationTasksRouter,
		},
		analytics: {
			export: organizationProcedure
				.input(analyticsExportInputSchema)
				.output(analyticsExportResultSchema)
				.handler(({ context, input }) =>
					exportBusinessMetrics(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input.config,
					),
				),
			savedFilters: {
				list: organizationProcedure
					.output(analyticsSavedFilterListResultSchema)
					.handler(({ context }) =>
						listBusinessMetricSavedFilters({
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						}),
					),
				create: organizationProcedure
					.input(analyticsSavedFilterCreateInputSchema)
					.output(analyticsSavedFilterSchema)
					.handler(({ context, input }) =>
						createBusinessMetricSavedFilter(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								role: context.role,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				update: organizationProcedure
					.input(analyticsSavedFilterUpdateInputSchema)
					.output(analyticsSavedFilterSchema)
					.handler(({ context, input }) =>
						updateBusinessMetricSavedFilter(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								role: context.role,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				delete: organizationProcedure
					.input(analyticsSavedFilterDeleteInputSchema)
					.output(analyticsSavedFilterDeleteInputSchema)
					.handler(({ context, input }) =>
						deleteBusinessMetricSavedFilter(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								role: context.role,
								campusAccess: context.campusAccess,
							},
							input.id,
						),
					),
			},
			comparison: organizationProcedure
				.input(businessMetricComparisonInputSchema)
				.output(businessMetricComparisonResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricComparison(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financial: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricFinancialResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancial(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialDrilldown: organizationProcedure
				.input(businessMetricFinancialDrilldownInputSchema)
				.output(businessMetricFinancialDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialAgingDrilldown: organizationProcedure
				.input(businessMetricFinancialAgingDrilldownInputSchema)
				.output(businessMetricFinancialAgingDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialAgingDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			drilldown: organizationProcedure
				.input(businessMetricDrilldownInputSchema)
				.output(businessMetricDrilldownResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricDrilldown(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			sales: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricSalesResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricSales(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			attendance: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricAttendanceResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricAttendance(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			consumption: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricConsumptionResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricConsumption(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			financialReceipts: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricFinancialReceiptResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricFinancialReceipts(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			resource: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricResourceResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricResource(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			renewal: organizationProcedure
				.input(businessMetricQueryInputSchema)
				.output(businessMetricRenewalResultSchema)
				.handler(({ context, input }) =>
					getBusinessMetricRenewal(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							role: context.role,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		snapshot: dashboardSnapshotProcedure,
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
