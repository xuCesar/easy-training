CREATE TYPE "public"."makeup_lesson_status" AS ENUM('scheduled', 'fulfilled', 'needs_reschedule', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'class_paused' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'class_resumed' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'classroom_created' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'classroom_updated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'classroom_activated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'classroom_deactivated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'makeup_lesson_created' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'makeup_lesson_cancelled' BEFORE 'lead_imported';--> statement-breakpoint
CREATE TABLE "classroom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"capacity" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "makeup_lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_lesson_id" uuid NOT NULL,
	"source_enrollment_id" uuid NOT NULL,
	"target_lesson_id" uuid NOT NULL,
	"status" "makeup_lesson_status" DEFAULT 'scheduled' NOT NULL,
	"request_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "classroom" ADD CONSTRAINT "classroom_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom" ADD CONSTRAINT "classroom_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD CONSTRAINT "makeup_lesson_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD CONSTRAINT "makeup_lesson_source_lesson_id_lesson_id_fk" FOREIGN KEY ("source_lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD CONSTRAINT "makeup_lesson_source_enrollment_id_enrollment_id_fk" FOREIGN KEY ("source_enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD CONSTRAINT "makeup_lesson_target_lesson_id_lesson_id_fk" FOREIGN KEY ("target_lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD CONSTRAINT "makeup_lesson_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_org_campus_name_uidx" ON "classroom" USING btree ("organization_id","campus_id","name_normalized");--> statement-breakpoint
CREATE INDEX "classroom_org_campus_active_idx" ON "classroom" USING btree ("organization_id","campus_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_lesson_org_request_uidx" ON "makeup_lesson" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_lesson_source_active_uidx" ON "makeup_lesson" USING btree ("source_lesson_id","source_enrollment_id") WHERE "makeup_lesson"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "makeup_lesson_target_status_idx" ON "makeup_lesson" USING btree ("target_lesson_id","status");--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_room_id_classroom_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."classroom"("id") ON DELETE set null ON UPDATE no action;