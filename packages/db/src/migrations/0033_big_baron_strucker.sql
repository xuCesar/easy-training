CREATE TYPE "public"."enrollment_purchase_cycle_source" AS ENUM('initial', 'renewal', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."lead_milestone_kind" AS ENUM('contacted', 'trial_booked', 'lost', 'reopened', 'converted');--> statement-breakpoint
CREATE TYPE "public"."lead_owner_assignment_source" AS ENUM('creation', 'import', 'manual', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."metric_fact_provenance" AS ENUM('native', 'migrated');--> statement-breakpoint
CREATE TABLE "enrollment_purchase_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"source" "enrollment_purchase_cycle_source" NOT NULL,
	"source_lead_id" uuid,
	"source_registration_id" uuid,
	"source_renewal_id" uuid,
	"source_transfer_id" uuid,
	"purchased_lessons" integer NOT NULL,
	"starting_remaining_lessons" integer NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"campus_id" uuid,
	"provenance" "metric_fact_provenance" DEFAULT 'native' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_cycle_sequence_positive_check" CHECK ("enrollment_purchase_cycle"."sequence" > 0),
	CONSTRAINT "purchase_cycle_lessons_positive_check" CHECK ("enrollment_purchase_cycle"."purchased_lessons" > 0),
	CONSTRAINT "purchase_cycle_starting_remaining_check" CHECK ("enrollment_purchase_cycle"."starting_remaining_lessons" >= 0),
	CONSTRAINT "purchase_cycle_amount_check" CHECK ("enrollment_purchase_cycle"."amount_in_cents" >= 0),
	CONSTRAINT "purchase_cycle_source_consistency_check" CHECK (
				(
					"enrollment_purchase_cycle"."source" = 'initial'
					and "enrollment_purchase_cycle"."source_renewal_id" is null
					and "enrollment_purchase_cycle"."source_transfer_id" is null
					and num_nonnulls("enrollment_purchase_cycle"."source_lead_id", "enrollment_purchase_cycle"."source_registration_id") = 1
				)
				or (
					"enrollment_purchase_cycle"."source" = 'renewal'
					and "enrollment_purchase_cycle"."source_lead_id" is null
					and "enrollment_purchase_cycle"."source_registration_id" is null
					and "enrollment_purchase_cycle"."source_renewal_id" is not null
					and "enrollment_purchase_cycle"."source_transfer_id" is null
				)
				or (
					"enrollment_purchase_cycle"."source" = 'transfer'
					and "enrollment_purchase_cycle"."source_lead_id" is null
					and "enrollment_purchase_cycle"."source_registration_id" is null
					and "enrollment_purchase_cycle"."source_renewal_id" is null
					and "enrollment_purchase_cycle"."source_transfer_id" is not null
				)
			)
);
--> statement-breakpoint
CREATE TABLE "lead_milestone_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"kind" "lead_milestone_kind" NOT NULL,
	"campus_id" uuid,
	"provider_user_id" text,
	"provider_name_snapshot" text,
	"attribution_user_id" text,
	"attribution_name_snapshot" text,
	"operator_user_id" text,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"provenance" "metric_fact_provenance" DEFAULT 'native' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_milestone_cycle_positive_check" CHECK ("lead_milestone_event"."cycle_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "lead_owner_assignment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"campus_id" uuid,
	"previous_owner_user_id" text,
	"previous_owner_name_snapshot" text,
	"next_owner_user_id" text,
	"next_owner_name_snapshot" text,
	"operator_user_id" text,
	"source" "lead_owner_assignment_source" NOT NULL,
	"request_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewal_opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"purchase_cycle_id" uuid NOT NULL,
	"triggering_lesson_consumption_id" uuid NOT NULL,
	"threshold_lessons" integer NOT NULL,
	"remaining_lessons" integer NOT NULL,
	"campus_id" uuid,
	"provenance" "metric_fact_provenance" DEFAULT 'native' NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_opportunity_threshold_positive_check" CHECK ("renewal_opportunity"."threshold_lessons" > 0),
	CONSTRAINT "renewal_opportunity_remaining_check" CHECK ("renewal_opportunity"."remaining_lessons" >= 0),
	CONSTRAINT "renewal_opportunity_reached_threshold_check" CHECK ("renewal_opportunity"."remaining_lessons" <= "renewal_opportunity"."threshold_lessons")
);
--> statement-breakpoint
CREATE TABLE "renewal_opportunity_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"renewal_id" uuid NOT NULL,
	"converted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "conversion_owner_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "conversion_campus_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD COLUMN "provider_user_id" text;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD COLUMN "provider_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "provider_user_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "provider_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "created_campus_id" uuid;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "current_cycle_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_source_lead_id_lead_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_source_registration_id_enrollment_registration_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."enrollment_registration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_source_renewal_id_enrollment_renewal_id_fk" FOREIGN KEY ("source_renewal_id") REFERENCES "public"."enrollment_renewal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_source_transfer_id_enrollment_transfer_id_fk" FOREIGN KEY ("source_transfer_id") REFERENCES "public"."enrollment_transfer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_purchase_cycle" ADD CONSTRAINT "enrollment_purchase_cycle_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_attribution_user_id_user_id_fk" FOREIGN KEY ("attribution_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_milestone_event" ADD CONSTRAINT "lead_milestone_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_previous_owner_user_id_user_id_fk" FOREIGN KEY ("previous_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_next_owner_user_id_user_id_fk" FOREIGN KEY ("next_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_owner_assignment_event" ADD CONSTRAINT "lead_owner_assignment_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity" ADD CONSTRAINT "renewal_opportunity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity" ADD CONSTRAINT "renewal_opportunity_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity" ADD CONSTRAINT "renewal_opportunity_purchase_cycle_id_enrollment_purchase_cycle_id_fk" FOREIGN KEY ("purchase_cycle_id") REFERENCES "public"."enrollment_purchase_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity" ADD CONSTRAINT "renewal_opportunity_triggering_lesson_consumption_id_lesson_consumption_id_fk" FOREIGN KEY ("triggering_lesson_consumption_id") REFERENCES "public"."lesson_consumption"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity" ADD CONSTRAINT "renewal_opportunity_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity_conversion" ADD CONSTRAINT "renewal_opportunity_conversion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity_conversion" ADD CONSTRAINT "renewal_opportunity_conversion_opportunity_id_renewal_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."renewal_opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_opportunity_conversion" ADD CONSTRAINT "renewal_opportunity_conversion_renewal_id_enrollment_renewal_id_fk" FOREIGN KEY ("renewal_id") REFERENCES "public"."enrollment_renewal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_cycle_enrollment_sequence_uidx" ON "enrollment_purchase_cycle" USING btree ("enrollment_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_cycle_registration_uidx" ON "enrollment_purchase_cycle" USING btree ("source_registration_id") WHERE "enrollment_purchase_cycle"."source_registration_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_cycle_renewal_uidx" ON "enrollment_purchase_cycle" USING btree ("source_renewal_id") WHERE "enrollment_purchase_cycle"."source_renewal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_cycle_transfer_uidx" ON "enrollment_purchase_cycle" USING btree ("source_transfer_id") WHERE "enrollment_purchase_cycle"."source_transfer_id" is not null;--> statement-breakpoint
CREATE INDEX "purchase_cycle_org_campus_started_idx" ON "enrollment_purchase_cycle" USING btree ("organization_id","campus_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_milestone_cycle_kind_uidx" ON "lead_milestone_event" USING btree ("organization_id","lead_id","cycle_number","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_milestone_cycle_outcome_uidx" ON "lead_milestone_event" USING btree ("organization_id","lead_id","cycle_number") WHERE "lead_milestone_event"."kind" in ('lost', 'converted');--> statement-breakpoint
CREATE INDEX "lead_milestone_org_campus_time_idx" ON "lead_milestone_event" USING btree ("organization_id","campus_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_milestone_org_attr_time_idx" ON "lead_milestone_event" USING btree ("organization_id","attribution_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_milestone_org_provider_time_idx" ON "lead_milestone_event" USING btree ("organization_id","provider_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_owner_event_org_request_uidx" ON "lead_owner_assignment_event" USING btree ("organization_id","request_id") WHERE "lead_owner_assignment_event"."request_id" is not null;--> statement-breakpoint
CREATE INDEX "lead_owner_event_lead_occurred_idx" ON "lead_owner_assignment_event" USING btree ("lead_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_opportunity_cycle_uidx" ON "renewal_opportunity" USING btree ("purchase_cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_opportunity_consumption_uidx" ON "renewal_opportunity" USING btree ("triggering_lesson_consumption_id");--> statement-breakpoint
CREATE INDEX "renewal_opportunity_org_campus_triggered_idx" ON "renewal_opportunity" USING btree ("organization_id","campus_id","triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_opportunity_conversion_opportunity_uidx" ON "renewal_opportunity_conversion" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_opportunity_conversion_renewal_uidx" ON "renewal_opportunity_conversion" USING btree ("renewal_id");--> statement-breakpoint
CREATE INDEX "renewal_opportunity_conversion_org_time_idx" ON "renewal_opportunity_conversion" USING btree ("organization_id","converted_at");--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_conversion_campus_id_campus_id_fk" FOREIGN KEY ("conversion_campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_created_campus_id_campus_id_fk" FOREIGN KEY ("created_campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_org_provider_created_idx" ON "lead" USING btree ("organization_id","provider_user_id","created_at");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_current_cycle_positive_check" CHECK ("lead"."current_cycle_number" > 0);