ALTER TABLE "invoice_metric_fact" DROP CONSTRAINT "invoice_metric_fact_campus_attribution_check";--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" DROP CONSTRAINT "invoice_metric_fact_course_attribution_check";--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" DROP CONSTRAINT "invoice_metric_fact_native_attribution_check";--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_campus_attribution_check" CHECK (
				("invoice_metric_fact"."campus_attribution_kind" = 'linked'
					and "invoice_metric_fact"."campus_id" is not null)
				or ("invoice_metric_fact"."campus_attribution_kind" = 'unknown'
					and "invoice_metric_fact"."campus_id" is null
					and "invoice_metric_fact"."campus_name_snapshot" is null)
			);--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_course_attribution_check" CHECK (
				("invoice_metric_fact"."course_attribution_kind" = 'linked'
					and "invoice_metric_fact"."course_id" is not null)
				or ("invoice_metric_fact"."course_attribution_kind" in ('not_applicable', 'unknown')
					and "invoice_metric_fact"."course_id" is null
					and "invoice_metric_fact"."course_name_snapshot" is null)
			);--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_native_attribution_check" CHECK (
				"invoice_metric_fact"."provenance" <> 'native'
				or ("invoice_metric_fact"."campus_attribution_kind" = 'linked'
					and "invoice_metric_fact"."campus_name_snapshot" is not null
					and (
						"invoice_metric_fact"."course_attribution_kind" = 'not_applicable'
						or "invoice_metric_fact"."course_name_snapshot" is not null
					)
					and "invoice_metric_fact"."course_attribution_kind" in ('linked', 'not_applicable'))
			);