CREATE TYPE "public"."invoice_metric_campus_attribution_kind" AS ENUM('linked', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."invoice_metric_course_attribution_kind" AS ENUM('linked', 'not_applicable', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."invoice_metric_provenance" AS ENUM('native', 'derived');--> statement-breakpoint
CREATE TYPE "public"."invoice_metric_source" AS ENUM('lead_conversion', 'independent_enrollment', 'renewal', 'manual');--> statement-breakpoint
CREATE TABLE "invoice_metric_fact" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid,
	"campus_attribution_kind" "invoice_metric_campus_attribution_kind" NOT NULL,
	"campus_name_snapshot" text,
	"course_id" uuid,
	"course_attribution_kind" "invoice_metric_course_attribution_kind" NOT NULL,
	"course_name_snapshot" text,
	"source" "invoice_metric_source" NOT NULL,
	"provenance" "invoice_metric_provenance" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_metric_fact_campus_attribution_check" CHECK (
				("invoice_metric_fact"."campus_attribution_kind" = 'linked'
					and "invoice_metric_fact"."campus_id" is not null
					and "invoice_metric_fact"."campus_name_snapshot" is not null)
				or ("invoice_metric_fact"."campus_attribution_kind" = 'unknown'
					and "invoice_metric_fact"."campus_id" is null
					and "invoice_metric_fact"."campus_name_snapshot" is null)
			),
	CONSTRAINT "invoice_metric_fact_course_attribution_check" CHECK (
				("invoice_metric_fact"."course_attribution_kind" = 'linked'
					and "invoice_metric_fact"."course_id" is not null
					and "invoice_metric_fact"."course_name_snapshot" is not null)
				or ("invoice_metric_fact"."course_attribution_kind" in ('not_applicable', 'unknown')
					and "invoice_metric_fact"."course_id" is null
					and "invoice_metric_fact"."course_name_snapshot" is null)
			),
	CONSTRAINT "invoice_metric_fact_native_attribution_check" CHECK (
				"invoice_metric_fact"."provenance" <> 'native'
				or ("invoice_metric_fact"."campus_attribution_kind" = 'linked'
					and "invoice_metric_fact"."course_attribution_kind" in ('linked', 'not_applicable'))
			)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_org_id_uidx" ON "campus" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_org_id_uidx" ON "course" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_id_uidx" ON "invoice" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_org_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoice"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_org_campus_fk" FOREIGN KEY ("organization_id","campus_id") REFERENCES "public"."campus"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_metric_fact" ADD CONSTRAINT "invoice_metric_fact_org_course_fk" FOREIGN KEY ("organization_id","course_id") REFERENCES "public"."course"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_metric_fact_org_invoice_uidx" ON "invoice_metric_fact" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_metric_fact_org_campus_occurred_idx" ON "invoice_metric_fact" USING btree ("organization_id","campus_id","occurred_at","invoice_id");--> statement-breakpoint
