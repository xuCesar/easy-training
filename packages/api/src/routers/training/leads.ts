import {
	addLeadFollowUpInputSchema,
	confirmLeadImportInputSchema,
	confirmLeadImportResultSchema,
	convertLeadInputSchema,
	convertLeadResultSchema,
	createLeadInputSchema,
	createLeadResultSchema,
	exportLeadsInputSchema,
	exportLeadsResultSchema,
	leadConversionOptionsInputSchema,
	leadConversionOptionsSchema,
	leadDetailInputSchema,
	leadFilterOptionsSchema,
	leadHistoryInputSchema,
	leadHistoryResultSchema,
	leadListInputSchema,
	leadListResultSchema,
	leadRecordSchema,
	previewLeadImportInputSchema,
	previewLeadImportResultSchema,
	updateLeadInputSchema,
} from "../../contracts/training";
import { leadExportProcedure, leadProcedure } from "../../index";
import {
	convertLead,
	getLeadConversionOptions,
} from "../../repositories/enrollment-conversion";
import {
	addLeadFollowUp,
	createLead,
	exportLeads,
	getLead,
	getLeadFilterOptions,
	getLeadHistory,
	listLeads,
	updateLead,
} from "../../repositories/leads";
import {
	confirmLeadImport,
	previewLeadImport,
} from "../../repositories/operations";

export const leadsRouter = {
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
};
