import { relations } from "drizzle-orm";
import { user } from "../auth";
import { course, teacher } from "./catalog";
import {
	classGroup,
	classroom,
	classStatusEvent,
	lessonScheduleRule,
} from "./classes";
import { enrollmentRenewal } from "./enrollment-transactions";
import { enrollment } from "./enrollments";
import {
	invoice,
	invoiceAdjustment,
	invoiceArrearsCycle,
	invoiceArrearsEvent,
	invoiceFollowUp,
	manualInvoiceCreation,
	payment,
	paymentReversal,
	receiptDocument,
	receiptDocumentPayment,
	refund,
	refundRequest,
	refundRequestEvent,
} from "./finance";
import { lead, leadActivity } from "./leads";
import { attendance, lesson, lessonConsumption, makeupLesson } from "./lessons";
import { campus, organization, organizationMember } from "./organization";
import {
	student,
	studentContact,
	studentTag,
	studentTagAssignment,
} from "./students";

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(organizationMember),
	campuses: many(campus),
	courses: many(course),
	students: many(student),
	studentTags: many(studentTag),
	leadActivities: many(leadActivity),
}));

export const leadRelations = relations(lead, ({ many }) => ({
	activities: many(leadActivity),
}));

export const leadActivityRelations = relations(leadActivity, ({ one }) => ({
	lead: one(lead, {
		fields: [leadActivity.leadId],
		references: [lead.id],
	}),
}));

export const campusRelations = relations(campus, ({ one, many }) => ({
	organization: one(organization, {
		fields: [campus.organizationId],
		references: [organization.id],
	}),
	students: many(student),
	classes: many(classGroup),
	classrooms: many(classroom),
}));

export const classroomRelations = relations(classroom, ({ one, many }) => ({
	campus: one(campus, {
		fields: [classroom.campusId],
		references: [campus.id],
	}),
	lessons: many(lesson),
}));

export const studentRelations = relations(student, ({ one, many }) => ({
	campus: one(campus, { fields: [student.campusId], references: [campus.id] }),
	contacts: many(studentContact),
	tagAssignments: many(studentTagAssignment),
	enrollments: many(enrollment),
	attendances: many(attendance),
	lessonConsumptions: many(lessonConsumption),
	invoices: many(invoice),
}));

export const studentContactRelations = relations(studentContact, ({ one }) => ({
	student: one(student, {
		fields: [studentContact.studentId],
		references: [student.id],
	}),
}));

export const studentTagRelations = relations(studentTag, ({ one, many }) => ({
	organization: one(organization, {
		fields: [studentTag.organizationId],
		references: [organization.id],
	}),
	assignments: many(studentTagAssignment),
}));

export const studentTagAssignmentRelations = relations(
	studentTagAssignment,
	({ one }) => ({
		student: one(student, {
			fields: [studentTagAssignment.studentId],
			references: [student.id],
		}),
		tag: one(studentTag, {
			fields: [studentTagAssignment.studentTagId],
			references: [studentTag.id],
		}),
	}),
);

export const invoiceRelations = relations(invoice, ({ many }) => ({
	payments: many(payment),
	paymentReversals: many(paymentReversal),
	refunds: many(refund),
	refundRequests: many(refundRequest),
	followUps: many(invoiceFollowUp),
	arrearsCycles: many(invoiceArrearsCycle),
	manualCreations: many(manualInvoiceCreation),
	adjustments: many(invoiceAdjustment),
	receipts: many(receiptDocument),
}));

export const manualInvoiceCreationRelations = relations(
	manualInvoiceCreation,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [manualInvoiceCreation.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const invoiceAdjustmentRelations = relations(
	invoiceAdjustment,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [invoiceAdjustment.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const paymentRelations = relations(payment, ({ one, many }) => ({
	invoice: one(invoice, {
		fields: [payment.invoiceId],
		references: [invoice.id],
	}),
	reversals: many(paymentReversal),
	receiptLinks: many(receiptDocumentPayment),
}));

export const receiptDocumentRelations = relations(
	receiptDocument,
	({ one, many }) => ({
		invoice: one(invoice, {
			fields: [receiptDocument.invoiceId],
			references: [invoice.id],
		}),
		payments: many(receiptDocumentPayment),
		replaces: one(receiptDocument, {
			fields: [receiptDocument.replacesReceiptId],
			references: [receiptDocument.id],
			relationName: "receiptReplacement",
		}),
	}),
);

export const receiptDocumentPaymentRelations = relations(
	receiptDocumentPayment,
	({ one }) => ({
		receipt: one(receiptDocument, {
			fields: [receiptDocumentPayment.receiptId],
			references: [receiptDocument.id],
		}),
		payment: one(payment, {
			fields: [receiptDocumentPayment.paymentId],
			references: [payment.id],
		}),
	}),
);

export const paymentReversalRelations = relations(
	paymentReversal,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [paymentReversal.invoiceId],
			references: [invoice.id],
		}),
		payment: one(payment, {
			fields: [paymentReversal.paymentId],
			references: [payment.id],
		}),
	}),
);

export const refundRelations = relations(refund, ({ one }) => ({
	invoice: one(invoice, {
		fields: [refund.invoiceId],
		references: [invoice.id],
	}),
}));

export const refundRequestRelations = relations(
	refundRequest,
	({ one, many }) => ({
		invoice: one(invoice, {
			fields: [refundRequest.invoiceId],
			references: [invoice.id],
		}),
		refund: one(refund, {
			fields: [refundRequest.refundId],
			references: [refund.id],
		}),
		events: many(refundRequestEvent),
	}),
);

export const refundRequestEventRelations = relations(
	refundRequestEvent,
	({ one }) => ({
		request: one(refundRequest, {
			fields: [refundRequestEvent.refundRequestId],
			references: [refundRequest.id],
		}),
	}),
);

export const invoiceFollowUpRelations = relations(
	invoiceFollowUp,
	({ one }) => ({
		invoice: one(invoice, {
			fields: [invoiceFollowUp.invoiceId],
			references: [invoice.id],
		}),
	}),
);

export const invoiceArrearsCycleRelations = relations(
	invoiceArrearsCycle,
	({ one, many }) => ({
		invoice: one(invoice, {
			fields: [invoiceArrearsCycle.invoiceId],
			references: [invoice.id],
		}),
		events: many(invoiceArrearsEvent),
	}),
);

export const invoiceArrearsEventRelations = relations(
	invoiceArrearsEvent,
	({ one }) => ({
		cycle: one(invoiceArrearsCycle, {
			fields: [invoiceArrearsEvent.cycleId],
			references: [invoiceArrearsCycle.id],
		}),
	}),
);

export const classGroupRelations = relations(classGroup, ({ one, many }) => ({
	campus: one(campus, {
		fields: [classGroup.campusId],
		references: [campus.id],
	}),
	course: one(course, {
		fields: [classGroup.courseId],
		references: [course.id],
	}),
	teacher: one(teacher, {
		fields: [classGroup.teacherId],
		references: [teacher.id],
	}),
	lessons: many(lesson),
	scheduleRules: many(lessonScheduleRule),
	enrollments: many(enrollment),
	statusEvents: many(classStatusEvent),
}));

export const classStatusEventRelations = relations(
	classStatusEvent,
	({ one }) => ({
		classGroup: one(classGroup, {
			fields: [classStatusEvent.classGroupId],
			references: [classGroup.id],
		}),
	}),
);

export const enrollmentRelations = relations(enrollment, ({ many }) => ({
	lessonConsumptions: many(lessonConsumption),
	renewals: many(enrollmentRenewal),
}));

export const lessonScheduleRuleRelations = relations(
	lessonScheduleRule,
	({ one, many }) => ({
		classGroup: one(classGroup, {
			fields: [lessonScheduleRule.classGroupId],
			references: [classGroup.id],
		}),
		lessons: many(lesson),
	}),
);

export const lessonRelations = relations(lesson, ({ one, many }) => ({
	classroom: one(classroom, {
		fields: [lesson.roomId],
		references: [classroom.id],
	}),
	scheduleRule: one(lessonScheduleRule, {
		fields: [lesson.scheduleRuleId],
		references: [lessonScheduleRule.id],
	}),
	attendances: many(attendance),
	consumptions: many(lessonConsumption),
	makeupSources: many(makeupLesson, { relationName: "sourceLesson" }),
	makeupTargets: many(makeupLesson, { relationName: "targetLesson" }),
}));

export const makeupLessonRelations = relations(makeupLesson, ({ one }) => ({
	sourceLesson: one(lesson, {
		fields: [makeupLesson.sourceLessonId],
		references: [lesson.id],
		relationName: "sourceLesson",
	}),
	targetLesson: one(lesson, {
		fields: [makeupLesson.targetLessonId],
		references: [lesson.id],
		relationName: "targetLesson",
	}),
	sourceEnrollment: one(enrollment, {
		fields: [makeupLesson.sourceEnrollmentId],
		references: [enrollment.id],
	}),
}));

export const lessonConsumptionRelations = relations(
	lessonConsumption,
	({ one }) => ({
		enrollment: one(enrollment, {
			fields: [lessonConsumption.enrollmentId],
			references: [enrollment.id],
		}),
		lesson: one(lesson, {
			fields: [lessonConsumption.lessonId],
			references: [lesson.id],
		}),
		consumedByUser: one(user, {
			fields: [lessonConsumption.consumedByUserId],
			references: [user.id],
		}),
	}),
);
