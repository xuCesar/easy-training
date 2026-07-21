CREATE TYPE "public"."enrollment_lifecycle_kind" AS ENUM('frozen', 'resumed', 'class_transferred', 'class_withdrawn', 'class_assigned');--> statement-breakpoint
ALTER TYPE "public"."enrollment_status" ADD VALUE 'frozen' BEFORE 'transferred';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_frozen' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_resumed' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_class_transferred' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_class_withdrawn' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'student_merged' BEFORE 'lead_imported';--> statement-breakpoint
CREATE TABLE "enrollment_lifecycle_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" "enrollment_lifecycle_kind" NOT NULL,
	"before_status" "enrollment_status" NOT NULL,
	"after_status" "enrollment_status" NOT NULL,
	"from_class_group_id" uuid,
	"to_class_group_id" uuid,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"operator_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_merge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_student_id" uuid NOT NULL,
	"target_student_id" uuid NOT NULL,
	"operator_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"selection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "guardian_phone_normalized" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "merged_into_student_id" uuid;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_contact" ADD COLUMN "phone_normalized" text;--> statement-breakpoint
UPDATE "student"
SET "guardian_phone_normalized" = regexp_replace(
	regexp_replace("guardian_phone", '[[:space:]()（）-]', '', 'g'),
	'^\+?86',
	''
);--> statement-breakpoint
UPDATE "student_contact"
SET "phone_normalized" = regexp_replace(
	regexp_replace("phone", '[[:space:]()（）-]', '', 'g'),
	'^\+?86',
	''
);--> statement-breakpoint
ALTER TABLE "student" ALTER COLUMN "guardian_phone_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "student_contact" ALTER COLUMN "phone_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_from_class_group_id_class_group_id_fk" FOREIGN KEY ("from_class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_to_class_group_id_class_group_id_fk" FOREIGN KEY ("to_class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_lifecycle_event" ADD CONSTRAINT "enrollment_lifecycle_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_merge" ADD CONSTRAINT "student_merge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_merge" ADD CONSTRAINT "student_merge_source_student_id_student_id_fk" FOREIGN KEY ("source_student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_merge" ADD CONSTRAINT "student_merge_target_student_id_student_id_fk" FOREIGN KEY ("target_student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_merge" ADD CONSTRAINT "student_merge_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_lifecycle_event_org_request_uidx" ON "enrollment_lifecycle_event" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "enrollment_lifecycle_event_enrollment_effective_idx" ON "enrollment_lifecycle_event" USING btree ("enrollment_id","effective_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_merge_org_request_uidx" ON "student_merge" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_merge_source_uidx" ON "student_merge" USING btree ("source_student_id");--> statement-breakpoint
CREATE INDEX "student_merge_org_target_idx" ON "student_merge" USING btree ("organization_id","target_student_id");--> statement-breakpoint
CREATE INDEX "student_org_guardian_phone_normalized_idx" ON "student" USING btree ("organization_id","guardian_phone_normalized");--> statement-breakpoint
CREATE INDEX "student_merged_into_idx" ON "student" USING btree ("merged_into_student_id");--> statement-breakpoint
CREATE INDEX "student_contact_phone_normalized_idx" ON "student_contact" USING btree ("phone_normalized");
