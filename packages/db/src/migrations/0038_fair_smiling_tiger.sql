ALTER TYPE "public"."organization_audit_action" ADD VALUE 'analytics_filter_saved';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'analytics_filter_updated';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'analytics_filter_deleted';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'analytics_exported';--> statement-breakpoint
CREATE TABLE "analytics_saved_filter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"report_kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_saved_filter" ADD CONSTRAINT "analytics_saved_filter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_filter" ADD CONSTRAINT "analytics_saved_filter_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_saved_filter_org_user_kind_name_uidx" ON "analytics_saved_filter" USING btree ("organization_id","user_id","report_kind","name");--> statement-breakpoint
CREATE INDEX "analytics_saved_filter_org_user_updated_idx" ON "analytics_saved_filter" USING btree ("organization_id","user_id","updated_at","id");