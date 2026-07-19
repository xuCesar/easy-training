CREATE TYPE "public"."lead_import_batch_status" AS ENUM('processing', 'completed', 'completed_with_errors');--> statement-breakpoint
CREATE TYPE "public"."organization_notification_type" AS ENUM('lead_import_completed', 'lead_import_failed', 'invoice_follow_up');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lead_exported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'notification_read';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'notifications_marked_read';--> statement-breakpoint
CREATE TABLE "lead_import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" "lead_import_batch_status" NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"error_rows" integer NOT NULL,
	"errors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"campus_id" uuid,
	"type" "organization_notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_audit_event" ADD COLUMN "campus_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_import_batch" ADD CONSTRAINT "lead_import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_batch" ADD CONSTRAINT "lead_import_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_notification" ADD CONSTRAINT "organization_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_notification" ADD CONSTRAINT "organization_notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_notification" ADD CONSTRAINT "organization_notification_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_import_batch_org_request_uidx" ON "lead_import_batch" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "lead_import_batch_org_created_idx" ON "lead_import_batch" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_notification_recipient_key_uidx" ON "organization_notification" USING btree ("organization_id","recipient_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "organization_notification_recipient_read_created_idx" ON "organization_notification" USING btree ("organization_id","recipient_user_id","read_at","created_at","id");--> statement-breakpoint
ALTER TABLE "organization_audit_event" ADD CONSTRAINT "organization_audit_event_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_audit_event_org_campus_created_idx" ON "organization_audit_event" USING btree ("organization_id","campus_id","created_at","id");