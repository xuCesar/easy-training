import { z } from "zod";

import {
	conversionCampusSchema,
	conversionClassSchema,
	conversionCourseSchema,
} from "./leads";

export const independentEnrollmentOptionsInputSchema = z.object({});

const independentStudentChoiceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("existing"),
		studentId: z.uuid(),
		expectedVersion: z.number().int().positive(),
	}),
	z.object({
		mode: z.literal("new"),
		name: z.string().trim().min(1).max(50),
		campusId: z.uuid(),
		primaryContact: z.object({
			name: z.string().trim().min(1).max(50),
			phone: z.string().trim().min(1).max(50),
			relationship: z.string().trim().max(30).nullable().default(null),
		}),
	}),
]);

export const independentEnrollmentOptionsSchema = z.object({
	permissions: z.object({
		canOverridePackageTerms: z.boolean(),
		canAdjustStudentOwner: z.boolean(),
	}),
	campuses: z.array(conversionCampusSchema),
	courses: z.array(conversionCourseSchema),
	classes: z.array(conversionClassSchema),
});

export const directEnrollmentSourceSchema = z.enum([
	"walk_in",
	"phone",
	"referral",
	"online",
	"other",
]);

export const createIndependentEnrollmentInputSchema = z.object({
	requestId: z.uuid(),
	student: independentStudentChoiceSchema,
	source: directEnrollmentSourceSchema,
	providerUserId: z.string().min(1).max(255).nullable().default(null),
	conversionOwnerUserId: z.string().min(1).max(255).nullable().default(null),
	adjustStudentOwner: z.boolean().default(false),
	courseId: z.uuid(),
	classGroupId: z.uuid().nullable().default(null),
	purchasedLessons: z.number().int().min(1).max(1000),
	amountInCents: z.number().int().min(0).max(100_000_000),
	invoiceDueDate: z.iso.date(),
});

export const createIndependentEnrollmentResultSchema = z.object({
	studentId: z.uuid(),
	enrollmentId: z.uuid(),
	invoiceId: z.uuid(),
	classGroupId: z.uuid().nullable(),
	replayed: z.boolean(),
});

export type IndependentEnrollmentOptionsInput = z.infer<
	typeof independentEnrollmentOptionsInputSchema
>;
export type IndependentEnrollmentOptions = z.infer<
	typeof independentEnrollmentOptionsSchema
>;
export type CreateIndependentEnrollmentInput = z.infer<
	typeof createIndependentEnrollmentInputSchema
>;
export type CreateIndependentEnrollmentResult = z.infer<
	typeof createIndependentEnrollmentResultSchema
>;
