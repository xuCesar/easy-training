CREATE TYPE "public"."student_bulk_operation_kind" AS ENUM('set_owner', 'clear_owner', 'add_tag', 'remove_tag', 'assign_class', 'withdraw_class');--> statement-breakpoint
CREATE TYPE "public"."student_owner_assignment_source" AS ENUM('manual', 'import', 'lead_conversion', 'direct_enrollment', 'bulk', 'merge', 'authorization_revoked');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'student_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'student_exported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'students_bulk_updated';--> statement-breakpoint
CREATE TABLE "student_bulk_operation_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"kind" "student_bulk_operation_kind" NOT NULL,
	"target_count" integer NOT NULL,
	"changed_count" integer NOT NULL,
	"unchanged_count" integer NOT NULL,
	"target_ids" uuid[] NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"error_rows" integer NOT NULL,
	"errors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_owner_assignment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"before_owner_user_id" text,
	"after_owner_user_id" text,
	"operator_user_id" text,
	"source" "student_owner_assignment_source" NOT NULL,
	"batch_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "conversion_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD COLUMN "bulk_operation_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_bulk_operation_batch" ADD CONSTRAINT "student_bulk_operation_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bulk_operation_batch" ADD CONSTRAINT "student_bulk_operation_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_batch" ADD CONSTRAINT "student_import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_batch" ADD CONSTRAINT "student_import_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_before_owner_user_id_user_id_fk" FOREIGN KEY ("before_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_after_owner_user_id_user_id_fk" FOREIGN KEY ("after_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_owner_assignment_event" ADD CONSTRAINT "student_owner_assignment_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_bulk_operation_org_request_uidx" ON "student_bulk_operation_batch" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "student_bulk_operation_org_created_idx" ON "student_bulk_operation_batch" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_import_batch_org_request_uidx" ON "student_import_batch" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "student_import_batch_org_created_idx" ON "student_import_batch" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "student_owner_event_org_student_occurred_idx" ON "student_owner_assignment_event" USING btree ("organization_id","student_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "student_owner_event_batch_idx" ON "student_owner_assignment_event" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_conversion_owner_user_id_user_id_fk" FOREIGN KEY ("conversion_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_bulk_operation_batch_id_student_bulk_operation_batch_id_fk" FOREIGN KEY ("bulk_operation_batch_id") REFERENCES "public"."student_bulk_operation_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_org_campus_owner_idx" ON "student" USING btree ("organization_id","campus_id","owner_user_id");