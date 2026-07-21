CREATE TYPE "public"."invoice_business_activity_type" AS ENUM('course_enrollment', 'course_renewal', 'material_fee', 'exam_fee', 'price_difference', 'other');--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('enrollment', 'renewal', 'manual');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'manual_invoice_created';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'invoice_adjusted';--> statement-breakpoint
CREATE TABLE "invoice_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"before_version" integer NOT NULL,
	"after_version" integer NOT NULL,
	"before_amount_in_cents" integer NOT NULL,
	"after_amount_in_cents" integer NOT NULL,
	"before_due_date" date NOT NULL,
	"after_due_date" date NOT NULL,
	"before_summary" text NOT NULL,
	"after_summary" text NOT NULL,
	"reason" text NOT NULL,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_adjustment_version_order_check" CHECK ("invoice_adjustment"."after_version" = "invoice_adjustment"."before_version" + 1)
);
--> statement-breakpoint
CREATE TABLE "manual_invoice_creation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"campus_id" uuid NOT NULL,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "source" "invoice_source" DEFAULT 'enrollment' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "business_activity_type" "invoice_business_activity_type" DEFAULT 'course_enrollment' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "summary" text DEFAULT '课程报名费用' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "invoice"
SET
	"source" = 'renewal',
	"business_activity_type" = 'course_renewal',
	"summary" = '课程续费费用'
WHERE EXISTS (
	SELECT 1
	FROM "enrollment_renewal"
	WHERE "enrollment_renewal"."invoice_id" = "invoice"."id"
);--> statement-breakpoint
ALTER TABLE "invoice_adjustment" ADD CONSTRAINT "invoice_adjustment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustment" ADD CONSTRAINT "invoice_adjustment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustment" ADD CONSTRAINT "invoice_adjustment_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustment" ADD CONSTRAINT "invoice_adjustment_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_creation" ADD CONSTRAINT "manual_invoice_creation_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_adjustment_org_request_uidx" ON "invoice_adjustment" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "invoice_adjustment_org_invoice_created_idx" ON "invoice_adjustment" USING btree ("organization_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_invoice_creation_org_request_uidx" ON "manual_invoice_creation" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "manual_invoice_creation_org_invoice_idx" ON "manual_invoice_creation" USING btree ("organization_id","invoice_id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_version_positive_check" CHECK ("invoice"."version" > 0);
