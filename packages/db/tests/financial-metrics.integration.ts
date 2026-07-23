import assert from "node:assert/strict";
import test from "node:test";

import {
	calculateFinancialCohort,
	getFinancialAgingBucket,
} from "../src/repositories/financial-metrics";

test("财务 cohort 区分成熟、未成熟、零金额和结算异常", () => {
	const result = calculateFinancialCohort({
		asOf: new Date("2026-08-01T00:00:00.000Z"),
		invoices: [
			{
				issuedAt: new Date("2026-06-01T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 700,
				financialFactsComplete: true,
			},
			{
				issuedAt: new Date("2026-07-20T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 0,
				financialFactsComplete: true,
			},
			{
				issuedAt: new Date("2026-06-01T00:00:00.000Z"),
				amountInCents: 0,
				settledInWindowInCents: 0,
				financialFactsComplete: true,
			},
			{
				issuedAt: new Date("2026-06-01T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 1200,
				financialFactsComplete: true,
			},
		],
	});
	assert.equal(result.matureInvoiceCount, 3);
	assert.equal(result.immatureInvoiceCount, 1);
	assert.equal(result.zeroAmountInvoiceCount, 1);
	assert.equal(result.numeratorInCents, 700);
	assert.equal(result.denominatorInCents, 1000);
	assert.equal(result.settlementAnomalyCount, 1);
});

test("账龄在到期日当天仍属于未到期", () => {
	const snapshot = new Date("2026-08-01T00:00:00.000Z");
	assert.equal(getFinancialAgingBucket("2026-08-01", snapshot), "notDue");
	assert.equal(getFinancialAgingBucket("2026-07-31", snapshot), "overdue1To30");
	assert.equal(
		getFinancialAgingBucket("2026-07-01", snapshot),
		"overdue31To60",
	);
	assert.equal(
		getFinancialAgingBucket("2026-06-01", snapshot),
		"overdue61To90",
	);
	assert.equal(
		getFinancialAgingBucket("2026-05-02", snapshot),
		"overdueOver90",
	);
});

test("财务 cohort 在 30 天边界保留覆盖与时间线异常", () => {
	const result = calculateFinancialCohort({
		asOf: new Date("2026-08-01T00:00:00.000Z"),
		invoices: [
			{
				issuedAt: new Date("2026-07-02T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 1000,
				financialFactsComplete: true,
			},
			{
				issuedAt: new Date("2026-07-03T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 0,
				financialFactsComplete: true,
			},
			{
				issuedAt: new Date("2026-06-01T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: -1,
				financialFactsComplete: true,
				chronologyAnomaly: true,
			},
			{
				issuedAt: new Date("2026-06-01T00:00:00.000Z"),
				amountInCents: 1000,
				settledInWindowInCents: 0,
				financialFactsComplete: false,
			},
		],
	});
	assert.equal(result.matureInvoiceCount, 3);
	assert.equal(result.immatureInvoiceCount, 1);
	assert.equal(result.minimumRemainingObservationDays, 1);
	assert.equal(result.numeratorInCents, 1000);
	assert.equal(result.denominatorInCents, 1000);
	assert.equal(result.chronologyAnomalyCount, 1);
	assert.equal(result.factCoverageMissingCount, 1);
});
