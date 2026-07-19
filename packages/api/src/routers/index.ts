import type { RouterClient } from "@orpc/server";

import {
	addLeadFollowUpInputSchema,
	arrearsListResultSchema,
	assignEnrollmentClassInputSchema,
	assignEnrollmentClassResultSchema,
	auditEventListInputSchema,
	auditEventListResultSchema,
	campusListInputSchema,
	campusListResultSchema,
	cancelLessonInputSchema,
	claimInvitationInputSchema,
	claimInvitationResultSchema,
	classEnrollmentListInputSchema,
	classEnrollmentListResultSchema,
	classGroupListInputSchema,
	classGroupListResultSchema,
	completeLessonInputSchema,
	confirmLeadImportInputSchema,
	confirmLeadImportResultSchema,
	convertLeadInputSchema,
	convertLeadResultSchema,
	courseListInputSchema,
	courseListResultSchema,
	createCampusInputSchema,
	createClassGroupInputSchema,
	createCourseInputSchema,
	createInvitationInputSchema,
	createInvitationResultSchema,
	createInvoiceFollowUpInputSchema,
	createInvoiceFollowUpResultSchema,
	createLeadInputSchema,
	createLeadResultSchema,
	createLessonInputSchema,
	createPaymentInputSchema,
	createPaymentResultSchema,
	createRefundInputSchema,
	createRefundResultSchema,
	createStudentInputSchema,
	createStudentTagInputSchema,
	createTeacherInputSchema,
	currentOrganizationSchema,
	dashboardSnapshotSchema,
	enrollmentAdjustmentListResultSchema,
	exportLeadsInputSchema,
	exportLeadsResultSchema,
	invitationListResultSchema,
	invoiceDetailInputSchema,
	invoiceDetailSchema,
	invoiceListInputSchema,
	invoiceListResultSchema,
	leadConversionOptionsInputSchema,
	leadConversionOptionsSchema,
	leadFilterOptionsSchema,
	leadHistoryInputSchema,
	leadHistoryResultSchema,
	leadListInputSchema,
	leadListResultSchema,
	lessonAttendanceInputSchema,
	lessonAttendanceResultSchema,
	lessonListInputSchema,
	lessonListResultSchema,
	markNotificationReadInputSchema,
	markNotificationsReadResultSchema,
	memberListResultSchema,
	notificationListInputSchema,
	notificationListResultSchema,
	previewLeadImportInputSchema,
	previewLeadImportResultSchema,
	removeMemberInputSchema,
	renewEnrollmentInputSchema,
	renewEnrollmentResultSchema,
	resendInvitationInputSchema,
	revokeInvitationInputSchema,
	selectOrganizationInputSchema,
	setCampusActiveInputSchema,
	setCourseActiveInputSchema,
	setStudentTagActiveInputSchema,
	studentDetailInputSchema,
	studentDetailSchema,
	studentListInputSchema,
	studentListResultSchema,
	studentTagListInputSchema,
	studentTagListResultSchema,
	teacherListResultSchema,
	transferEnrollmentInputSchema,
	transferEnrollmentResultSchema,
	updateCampusInputSchema,
	updateClassGroupInputSchema,
	updateCourseInputSchema,
	updateLeadInputSchema,
	updateMemberInputSchema,
	updateStudentInputSchema,
	updateStudentTagInputSchema,
	updateTeacherInputSchema,
} from "../contracts/training";
import {
	academicManagementProcedure,
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
	convertLead,
	getLeadConversionOptions,
} from "../repositories/enrollment-conversion";
import {
	createInvoiceFollowUp,
	createRefund,
	listArrears,
	listEnrollmentAdjustments,
	renewEnrollment,
	transferEnrollment,
} from "../repositories/enrollment-finance-adjustments";
import {
	createPayment,
	getInvoiceDetail,
	listInvoices,
} from "../repositories/finance";
import {
	addLeadFollowUp,
	createLead,
	exportLeads,
	getLeadFilterOptions,
	getLeadHistory,
	listLeads,
	updateLead,
} from "../repositories/leads";
import {
	confirmLeadImport,
	getNotifications,
	listAuditEvents,
	previewLeadImport,
	readAllNotifications,
	readNotification,
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
	removeMember,
	resendInvitation,
	revokeInvitation,
	setCampusActive,
	updateCampus,
	updateMember,
} from "../repositories/organization-management";
import {
	createStudent,
	createStudentTag,
	getStudent,
	listStudents,
	listStudentTags,
	setStudentTagActive,
	updateStudent,
	updateStudentTag,
} from "../repositories/students";
import {
	assignEnrollmentClass,
	cancelLesson,
	completeLesson,
	createClassGroup,
	createCourse,
	createLesson,
	createTeacher,
	getLessonAttendance,
	listClassEnrollments,
	listClassGroups,
	listCourses,
	listLessons,
	listTeachers,
	setCourseActive,
	updateClassGroup,
	updateCourse,
	updateTeacher,
} from "../repositories/teaching";
import { getTrainingDashboardSnapshot } from "../repositories/training-dashboard";

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
						sessionId: context.session.session.id,
					}),
				),
		},
		notifications: {
			list: organizationProcedure
				.input(notificationListInputSchema)
				.output(notificationListResultSchema)
				.handler(({ context, input }) =>
					getNotifications(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
			read: organizationProcedure
				.input(markNotificationReadInputSchema)
				.output(markNotificationsReadResultSchema)
				.handler(async ({ context, input }) => {
					await readNotification(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input.id,
					);
					return { count: 1 };
				}),
			readAll: organizationProcedure
				.output(markNotificationsReadResultSchema)
				.handler(({ context }) =>
					readAllNotifications({
						organizationId: context.organization.id,
						userId: context.session.user.id,
						campusAccess: context.campusAccess,
					}),
				),
		},
		audit: {
			list: organizationManagementProcedure
				.input(auditEventListInputSchema)
				.output(auditEventListResultSchema)
				.handler(({ context, input }) =>
					listAuditEvents(
						{
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						},
						input,
					),
				),
		},
		students: {
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
		},
		teaching: {
			courses: {
				list: organizationProcedure
					.input(courseListInputSchema)
					.output(courseListResultSchema)
					.handler(({ context, input }) =>
						listCourses(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				create: academicManagementProcedure
					.input(createCourseInputSchema)
					.output(courseListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						createCourse(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				update: academicManagementProcedure
					.input(updateCourseInputSchema)
					.output(courseListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						updateCourse(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				setActive: academicManagementProcedure
					.input(setCourseActiveInputSchema)
					.output(courseListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						setCourseActive(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
			},
			teachers: {
				list: organizationProcedure
					.output(teacherListResultSchema)
					.handler(({ context }) =>
						listTeachers({
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						}),
					),
				create: academicManagementProcedure
					.input(createTeacherInputSchema)
					.output(teacherListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						createTeacher(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				update: academicManagementProcedure
					.input(updateTeacherInputSchema)
					.output(teacherListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						updateTeacher(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
			},
			classes: {
				list: academicManagementProcedure
					.input(classGroupListInputSchema)
					.output(classGroupListResultSchema)
					.handler(({ context, input }) =>
						listClassGroups(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				create: academicManagementProcedure
					.input(createClassGroupInputSchema)
					.output(classGroupListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						createClassGroup(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				update: academicManagementProcedure
					.input(updateClassGroupInputSchema)
					.output(classGroupListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						updateClassGroup(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				enrollments: academicManagementProcedure
					.input(classEnrollmentListInputSchema)
					.output(classEnrollmentListResultSchema)
					.handler(({ context, input }) =>
						listClassEnrollments(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				assignEnrollment: academicManagementProcedure
					.input(assignEnrollmentClassInputSchema)
					.output(assignEnrollmentClassResultSchema)
					.handler(({ context, input }) =>
						assignEnrollmentClass(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
			},
			lessons: {
				list: academicManagementProcedure
					.input(lessonListInputSchema)
					.output(lessonListResultSchema)
					.handler(({ context, input }) =>
						listLessons(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				create: academicManagementProcedure
					.input(createLessonInputSchema)
					.output(lessonListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						createLesson(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				attendance: academicManagementProcedure
					.input(lessonAttendanceInputSchema)
					.output(lessonAttendanceResultSchema)
					.handler(({ context, input }) =>
						getLessonAttendance(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				complete: academicManagementProcedure
					.input(completeLessonInputSchema)
					.output(lessonListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						completeLesson(
							{
								organizationId: context.organization.id,
								userId: context.session.user.id,
								campusAccess: context.campusAccess,
							},
							input,
						),
					),
				cancel: academicManagementProcedure
					.input(cancelLessonInputSchema)
					.output(lessonListResultSchema.shape.items.element)
					.handler(({ context, input }) =>
						cancelLesson(
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
		leads: {
			import: {
				preview: leadProcedure
					.input(previewLeadImportInputSchema)
					.output(previewLeadImportResultSchema)
					.handler(({ input }) => previewLeadImport(input)),
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
			refunds: {
				create: financeProcedure
					.input(createRefundInputSchema)
					.output(createRefundResultSchema)
					.handler(({ context, input }) =>
						createRefund(
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
					.output(arrearsListResultSchema)
					.handler(({ context }) =>
						listArrears({
							organizationId: context.organization.id,
							userId: context.session.user.id,
							campusAccess: context.campusAccess,
						}),
					),
				followUp: financeProcedure
					.input(createInvoiceFollowUpInputSchema)
					.output(createInvoiceFollowUpResultSchema)
					.handler(({ context, input }) =>
						createInvoiceFollowUp(
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
		snapshot: organizationProcedure
			.output(dashboardSnapshotSchema)
			.handler(({ context }) =>
				getTrainingDashboardSnapshot({
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				}),
			),
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
