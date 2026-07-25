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
} from "../../contracts/business-metrics";
import { organizationProcedure } from "../../index";
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
} from "../../repositories/business-metrics";

export const analyticsRouter = {
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
};
