import { z } from "zod";

export const BUSINESS_METRIC_CONTRACT_VERSION = "1" as const;
export const BUSINESS_METRIC_DEFINITION_VERSION = "2026-07-01" as const;
export const BUSINESS_METRIC_TIMEZONE = "Asia/Shanghai" as const;

export const businessMetricRangePresetSchema = z.enum([
	"last7Days",
	"last30Days",
	"last90Days",
	"month",
	"quarter",
	"year",
]);

export const businessMetricRangeInputSchema = z.discriminatedUnion("preset", [
	z.object({ preset: businessMetricRangePresetSchema }),
	z.object({
		preset: z.literal("custom"),
		from: z.iso.date(),
		to: z.iso.date(),
	}),
]);

export const businessMetricQueryInputSchema = z.object({
	range: businessMetricRangeInputSchema.default({ preset: "month" }),
});

export const businessMetricDrilldownKindSchema = z.enum([
	"salesCycles",
	"attendanceLessons",
	"consumptionLessons",
	"renewalOpportunities",
]);

export const businessMetricDrilldownInputSchema =
	businessMetricQueryInputSchema.extend({
		kind: businessMetricDrilldownKindSchema,
		limit: z.number().int().min(1).max(50).default(20),
		cursor: z
			.object({
				occurredAt: z.iso.datetime({ offset: true }),
				id: z.uuid(),
			})
			.optional(),
	});

export const businessMetricGranularitySchema = z.enum(["day", "week", "month"]);

export const resolvedBusinessMetricRangeSchema = z.object({
	from: z.iso.datetime({ offset: true }),
	to: z.iso.datetime({ offset: true }),
});

export const businessMetricNotApplicableReasonSchema = z.enum([
	"noDenominator",
	"immatureCohort",
	"insufficientSample",
	"factCoverageMissing",
]);

export const businessMetricRatioSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("available"),
		value: z.number().min(0),
		numerator: z.number().int().nonnegative(),
		denominator: z.number().int().positive(),
	}),
	z.object({
		status: z.literal("notApplicable"),
		value: z.null(),
		numerator: z.number().int().nonnegative(),
		denominator: z.number().int().nonnegative(),
		reason: businessMetricNotApplicableReasonSchema,
	}),
]);

export const businessMetricDataQualitySchema = z.object({
	missingAttributionCount: z.number().int().nonnegative(),
	missingMilestoneHistoryCount: z.number().int().nonnegative(),
	missingPurchaseCycleCount: z.number().int().nonnegative(),
	immatureCohortCount: z.number().int().nonnegative(),
	lateConsumptionCount: z.number().int().nonnegative(),
	insufficientSampleCount: z.number().int().nonnegative(),
});

export const businessMetricTrendPointSchema = z.object({
	bucketStart: z.iso.datetime({ offset: true }),
	value: z.number().nonnegative(),
});

const businessMetricEnvelopeBaseSchema = z.object({
	contractVersion: z.literal(BUSINESS_METRIC_CONTRACT_VERSION),
	definitionVersion: z.literal(BUSINESS_METRIC_DEFINITION_VERSION),
	timezone: z.literal(BUSINESS_METRIC_TIMEZONE),
	asOf: z.iso.datetime({ offset: true }),
	range: resolvedBusinessMetricRangeSchema,
	comparisonRange: resolvedBusinessMetricRangeSchema,
	granularity: businessMetricGranularitySchema,
	dataQuality: businessMetricDataQualitySchema,
});

export const businessMetricSalesDataSchema = z.object({
	conversionRate: businessMetricRatioSchema,
	comparisonConversionRate: businessMetricRatioSchema,
	campusBenchmarkConversionRate: businessMetricRatioSchema,
	closedCycleCount: z.number().int().nonnegative(),
	openCycleCount: z.number().int().nonnegative(),
	createdLeadCount: z.number().int().nonnegative(),
	contactedLeadCount: z.number().int().nonnegative(),
	trialBookedLeadCount: z.number().int().nonnegative(),
	convertedLeadCount: z.number().int().nonnegative(),
	lostLeadCount: z.number().int().nonnegative(),
	directEnrollmentCount: z.number().int().nonnegative(),
	directEnrollmentAmountInCents: z.number().int().nonnegative(),
});

export const businessMetricAttendanceDataSchema = z.object({
	attendanceRate: businessMetricRatioSchema,
	comparisonAttendanceRate: businessMetricRatioSchema,
	lateRate: businessMetricRatioSchema,
	leaveRate: businessMetricRatioSchema,
	absenceRate: businessMetricRatioSchema,
	makeupCompletionRate: businessMetricRatioSchema,
	pendingMakeupCount: z.number().int().nonnegative(),
	needsRescheduleMakeupCount: z.number().int().nonnegative(),
});

export const businessMetricConsumptionDataSchema = z.object({
	consumedLessonCount: z.number().int().nonnegative(),
	comparisonConsumedLessonCount: z.number().int().nonnegative(),
	trend: z.array(businessMetricTrendPointSchema),
});

export const businessMetricRenewalDataSchema = z.object({
	renewalRate: businessMetricRatioSchema,
	comparisonRenewalRate: businessMetricRatioSchema,
	opportunityCount: z.number().int().nonnegative(),
	succeededOpportunityCount: z.number().int().nonnegative(),
	unsucceededOpportunityCount: z.number().int().nonnegative(),
	immatureOpportunityCount: z.number().int().nonnegative(),
	minimumRemainingObservationDays: z.number().int().nonnegative().nullable(),
	earlyRenewalCount: z.number().int().nonnegative(),
	renewalAmountInCents: z.number().int().nonnegative(),
	renewalLessonCount: z.number().int().nonnegative(),
});

export const businessMetricSalesResultSchema =
	businessMetricEnvelopeBaseSchema.extend({
		data: businessMetricSalesDataSchema,
	});
export const businessMetricAttendanceResultSchema =
	businessMetricEnvelopeBaseSchema.extend({
		data: businessMetricAttendanceDataSchema,
	});
export const businessMetricConsumptionResultSchema =
	businessMetricEnvelopeBaseSchema.extend({
		data: businessMetricConsumptionDataSchema,
	});
export const businessMetricRenewalResultSchema =
	businessMetricEnvelopeBaseSchema.extend({
		data: businessMetricRenewalDataSchema,
	});

export const businessMetricDrilldownItemSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("salesCycle"),
		id: z.uuid(),
		occurredAt: z.iso.datetime({ offset: true }),
		outcome: z.enum(["converted", "lost"]),
		attributionLabel: z.string(),
	}),
	z.object({
		kind: z.literal("attendanceLesson"),
		id: z.uuid(),
		occurredAt: z.iso.datetime({ offset: true }),
		present: z.number().int().nonnegative(),
		late: z.number().int().nonnegative(),
		absent: z.number().int().nonnegative(),
		leave: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("consumptionLesson"),
		id: z.uuid(),
		occurredAt: z.iso.datetime({ offset: true }),
		consumedLessonCount: z.number().int().nonnegative(),
		lateConsumptionCount: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("renewalOpportunity"),
		id: z.uuid(),
		occurredAt: z.iso.datetime({ offset: true }),
		status: z.enum(["succeeded", "unsucceeded", "immature"]),
		remainingObservationDays: z.number().int().nonnegative().nullable(),
		renewalAmountInCents: z.number().int().nonnegative(),
		renewalLessonCount: z.number().int().nonnegative(),
	}),
]);

export const businessMetricDrilldownResultSchema =
	businessMetricEnvelopeBaseSchema.extend({
		items: z.array(businessMetricDrilldownItemSchema),
		nextCursor: z
			.object({
				occurredAt: z.iso.datetime({ offset: true }),
				id: z.uuid(),
			})
			.nullable(),
	});

export type BusinessMetricRangeInput = z.infer<
	typeof businessMetricRangeInputSchema
>;
export type BusinessMetricQueryInput = z.infer<
	typeof businessMetricQueryInputSchema
>;
export type BusinessMetricDrilldownKind = z.infer<
	typeof businessMetricDrilldownKindSchema
>;
export type BusinessMetricDrilldownInput = z.infer<
	typeof businessMetricDrilldownInputSchema
>;
export type BusinessMetricGranularity = z.infer<
	typeof businessMetricGranularitySchema
>;
export type ResolvedBusinessMetricRange = z.infer<
	typeof resolvedBusinessMetricRangeSchema
>;
export type BusinessMetricRatio = z.infer<typeof businessMetricRatioSchema>;
export type BusinessMetricDataQuality = z.infer<
	typeof businessMetricDataQualitySchema
>;
export type BusinessMetricSalesResult = z.infer<
	typeof businessMetricSalesResultSchema
>;
export type BusinessMetricAttendanceResult = z.infer<
	typeof businessMetricAttendanceResultSchema
>;
export type BusinessMetricConsumptionResult = z.infer<
	typeof businessMetricConsumptionResultSchema
>;
export type BusinessMetricRenewalResult = z.infer<
	typeof businessMetricRenewalResultSchema
>;
export type BusinessMetricDrilldownResult = z.infer<
	typeof businessMetricDrilldownResultSchema
>;
