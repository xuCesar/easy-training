CREATE TYPE "public"."lesson_schedule_batch_kind" AS ENUM('generate', 'rule_sync', 'bulk_reschedule', 'rule_cancel_future');--> statement-breakpoint
CREATE TYPE "public"."lesson_schedule_kind" AS ENUM('weekly');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'schedule_rule_created' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'schedule_rule_updated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'schedule_rule_deactivated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lessons_generated' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lessons_bulk_rescheduled' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lessons_bulk_cancelled' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'teacher_binding_changed' BEFORE 'lead_imported';--> statement-breakpoint
CREATE TABLE "lesson_schedule_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "lesson_schedule_batch_kind" NOT NULL,
	"schedule_rule_id" uuid,
	"actor_user_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"affected_lesson_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_schedule_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"kind" "lesson_schedule_kind" DEFAULT 'weekly' NOT NULL,
	"interval_weeks" integer DEFAULT 1 NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_minute_of_day" integer NOT NULL,
	"room" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_schedule_rule_interval_check" CHECK ("lesson_schedule_rule"."interval_weeks" > 0),
	CONSTRAINT "lesson_schedule_rule_start_minute_check" CHECK ("lesson_schedule_rule"."start_minute_of_day" >= 0 and "lesson_schedule_rule"."start_minute_of_day" < 1440),
	CONSTRAINT "lesson_schedule_rule_date_range_check" CHECK ("lesson_schedule_rule"."valid_until" >= "lesson_schedule_rule"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "recorded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "schedule_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "schedule_rule_revision" integer;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "schedule_occurrence_date" date;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "is_schedule_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "teaching_summary" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "completed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "lesson_schedule_batch" ADD CONSTRAINT "lesson_schedule_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_batch" ADD CONSTRAINT "lesson_schedule_batch_schedule_rule_id_lesson_schedule_rule_id_fk" FOREIGN KEY ("schedule_rule_id") REFERENCES "public"."lesson_schedule_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_batch" ADD CONSTRAINT "lesson_schedule_batch_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_rule" ADD CONSTRAINT "lesson_schedule_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_rule" ADD CONSTRAINT "lesson_schedule_rule_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_rule" ADD CONSTRAINT "lesson_schedule_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_schedule_rule" ADD CONSTRAINT "lesson_schedule_rule_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_schedule_batch_org_request_uidx" ON "lesson_schedule_batch" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "lesson_schedule_batch_org_created_idx" ON "lesson_schedule_batch" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "lesson_schedule_rule_org_class_active_idx" ON "lesson_schedule_rule" USING btree ("organization_id","class_group_id","is_active");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_schedule_rule_id_lesson_schedule_rule_id_fk" FOREIGN KEY ("schedule_rule_id") REFERENCES "public"."lesson_schedule_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_schedule_rule_occurrence_uidx" ON "lesson" USING btree ("schedule_rule_id","schedule_occurrence_date") WHERE "lesson"."schedule_rule_id" is not null;--> statement-breakpoint
CREATE INDEX "lesson_schedule_rule_starts_idx" ON "lesson" USING btree ("schedule_rule_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_org_user_uidx" ON "teacher" USING btree ("organization_id","user_id") WHERE "teacher"."user_id" is not null;