import { z } from "zod";

import { invoiceSourceSchema } from "./finance";

const dashboardFollowUpSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	stage: z.enum(["new", "contacted", "trialBooked"]),
	interestedCourse: z.string().nullable(),
	nextFollowAt: z.iso.datetime({ offset: true }).nullable(),
});

const dashboardTaskSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	module: z.enum(["enrollment", "academic", "finance", "student_service"]),
	owner: z.string().nullable(),
	dueAt: z.iso.datetime({ offset: true }),
	priority: z.enum(["high", "medium", "low"]),
});

const dashboardLessonSchema = z.object({
	id: z.uuid(),
	className: z.string(),
	courseName: z.string(),
	campusName: z.string(),
	teacherName: z.string(),
	room: z.string(),
	startsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
});

const dashboardReceivableSchema = z.object({
	id: z.uuid(),
	studentName: z.string(),
	courseName: z.string().nullable(),
	source: invoiceSourceSchema,
	summary: z.string(),
	outstandingAmountInCents: z.number().int().nonnegative(),
	status: z.enum(["pending", "overdue"]),
	dueDate: z.iso.date(),
});

export const dashboardSnapshotSchema = z.object({
	asOf: z.iso.datetime({ offset: true }),
	permissions: z.object({
		canViewLeads: z.boolean(),
		canViewFinance: z.boolean(),
	}),
	metrics: z.object({
		followUpCount: z.number().int().nonnegative().nullable(),
		studentCount: z.number().int().nonnegative(),
		enrollmentCount: z.number().int().nonnegative(),
		activeClassCount: z.number().int().nonnegative(),
		dueTaskCount: z.number().int().nonnegative(),
		upcomingLessonCount: z.number().int().nonnegative(),
		pendingInvoiceCount: z.number().int().nonnegative().nullable(),
		outstandingAmountInCents: z.number().int().nonnegative().nullable(),
	}),
	followUps: z.array(dashboardFollowUpSchema),
	tasks: z.array(dashboardTaskSchema),
	upcomingLessons: z.array(dashboardLessonSchema),
	receivables: z.array(dashboardReceivableSchema),
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
