import {
	commitEnrollmentBulkOperationInputSchema,
	commitEnrollmentBulkOperationResultSchema,
	commitStudentBulkOperationInputSchema,
	commitStudentBulkOperationResultSchema,
	confirmStudentImportInputSchema,
	confirmStudentImportResultSchema,
	createStudentInputSchema,
	createStudentTagInputSchema,
	duplicateStudentCandidatesInputSchema,
	duplicateStudentCandidatesResultSchema,
	exportStudentsInputSchema,
	exportStudentsResultSchema,
	mergeStudentsInputSchema,
	mergeStudentsResultSchema,
	previewEnrollmentBulkOperationInputSchema,
	previewEnrollmentBulkOperationResultSchema,
	previewStudentBulkOperationInputSchema,
	previewStudentBulkOperationResultSchema,
	previewStudentImportInputSchema,
	previewStudentImportResultSchema,
	setStudentTagActiveInputSchema,
	studentActiveEnrollmentOptionsInputSchema,
	studentActiveEnrollmentOptionsResultSchema,
	studentDetailInputSchema,
	studentDetailSchema,
	studentImportTemplateResultSchema,
	studentListInputSchema,
	studentListResultSchema,
	studentMergePreviewInputSchema,
	studentMergePreviewResultSchema,
	studentOwnerCandidateListInputSchema,
	studentOwnerCandidateListResultSchema,
	studentTagListInputSchema,
	studentTagListResultSchema,
	studentTimelineInputSchema,
	studentTimelineResultSchema,
	updateStudentInputSchema,
	updateStudentTagInputSchema,
} from "../../contracts/training";
import {
	organizationManagementProcedure,
	studentBulkProcedure,
	studentExportProcedure,
	studentProcedure,
} from "../../index";
import {
	getStudentMergePreview,
	mergeStudents,
} from "../../repositories/student-merge";
import {
	commitEnrollmentBulkOperation,
	commitStudentBulkOperation,
	confirmStudentImport,
	createStudent,
	createStudentTag,
	exportStudents,
	getDuplicateStudentCandidates,
	getStudent,
	getStudentActiveEnrollmentOptions,
	getStudentImportTemplate,
	getStudentTimeline,
	listStudentOwnerCandidates,
	listStudents,
	listStudentTags,
	previewEnrollmentBulkOperation,
	previewStudentBulkOperation,
	previewStudentImport,
	setStudentTagActive,
	updateStudent,
	updateStudentTag,
} from "../../repositories/students";

export const studentsRouter = {
	importTemplate: studentProcedure
		.output(studentImportTemplateResultSchema)
		.handler(() => getStudentImportTemplate()),
	previewImport: studentProcedure
		.input(previewStudentImportInputSchema)
		.output(previewStudentImportResultSchema)
		.handler(({ context, input }) =>
			previewStudentImport(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	confirmImport: studentProcedure
		.input(confirmStudentImportInputSchema)
		.output(confirmStudentImportResultSchema)
		.handler(({ context, input }) =>
			confirmStudentImport(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	export: studentExportProcedure
		.input(exportStudentsInputSchema)
		.output(exportStudentsResultSchema)
		.handler(({ context, input }) =>
			exportStudents(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	previewBulk: studentBulkProcedure
		.input(previewStudentBulkOperationInputSchema)
		.output(previewStudentBulkOperationResultSchema)
		.handler(({ context, input }) =>
			previewStudentBulkOperation(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	commitBulk: studentBulkProcedure
		.input(commitStudentBulkOperationInputSchema)
		.output(commitStudentBulkOperationResultSchema)
		.handler(({ context, input }) =>
			commitStudentBulkOperation(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	activeEnrollmentOptions: studentBulkProcedure
		.input(studentActiveEnrollmentOptionsInputSchema)
		.output(studentActiveEnrollmentOptionsResultSchema)
		.handler(({ context, input }) =>
			getStudentActiveEnrollmentOptions(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	previewEnrollmentBulk: studentBulkProcedure
		.input(previewEnrollmentBulkOperationInputSchema)
		.output(previewEnrollmentBulkOperationResultSchema)
		.handler(({ context, input }) =>
			previewEnrollmentBulkOperation(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	commitEnrollmentBulk: studentBulkProcedure
		.input(commitEnrollmentBulkOperationInputSchema)
		.output(commitEnrollmentBulkOperationResultSchema)
		.handler(({ context, input }) =>
			commitEnrollmentBulkOperation(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	ownerCandidates: studentProcedure
		.input(studentOwnerCandidateListInputSchema)
		.output(studentOwnerCandidateListResultSchema)
		.handler(({ context, input }) =>
			listStudentOwnerCandidates(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	timeline: studentProcedure
		.input(studentTimelineInputSchema)
		.output(studentTimelineResultSchema)
		.handler(({ context, input }) =>
			getStudentTimeline(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
					role: context.role,
				},
				input,
			),
		),
	mergePreview: organizationManagementProcedure
		.input(studentMergePreviewInputSchema)
		.output(studentMergePreviewResultSchema)
		.handler(({ context, input }) =>
			getStudentMergePreview(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
				},
				input,
			),
		),
	merge: organizationManagementProcedure
		.input(mergeStudentsInputSchema)
		.output(mergeStudentsResultSchema)
		.handler(({ context, input }) =>
			mergeStudents(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
				},
				input,
			),
		),
	duplicateCandidates: studentProcedure
		.input(duplicateStudentCandidatesInputSchema)
		.output(duplicateStudentCandidatesResultSchema)
		.handler(({ context, input }) =>
			getDuplicateStudentCandidates(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	list: studentProcedure
		.input(studentListInputSchema)
		.output(studentListResultSchema)
		.handler(({ context, input }) =>
			listStudents(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	get: studentProcedure
		.input(studentDetailInputSchema)
		.output(studentDetailSchema)
		.handler(({ context, input }) =>
			getStudent(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input.id,
			),
		),
	create: studentProcedure
		.input(createStudentInputSchema)
		.output(studentDetailSchema)
		.handler(({ context, input }) =>
			createStudent(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	update: studentProcedure
		.input(updateStudentInputSchema)
		.output(studentDetailSchema)
		.handler(({ context, input }) =>
			updateStudent(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	tags: {
		list: studentProcedure
			.input(studentTagListInputSchema)
			.output(studentTagListResultSchema)
			.handler(({ context, input }) =>
				listStudentTags(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		create: organizationManagementProcedure
			.input(createStudentTagInputSchema)
			.output(studentTagListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				createStudentTag(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		update: organizationManagementProcedure
			.input(updateStudentTagInputSchema)
			.output(studentTagListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				updateStudentTag(
					{
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					},
					input,
				),
			),
		setActive: organizationManagementProcedure
			.input(setStudentTagActiveInputSchema)
			.output(studentTagListResultSchema.shape.items.element)
			.handler(({ context, input }) =>
				setStudentTagActive(
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
