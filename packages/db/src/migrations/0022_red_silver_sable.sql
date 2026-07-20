ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_created' BEFORE 'lead_imported';--> statement-breakpoint
CREATE TABLE "enrollment_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"class_group_id" uuid,
	"campus_id" uuid NOT NULL,
	"operator_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_registration" ADD CONSTRAINT "enrollment_registration_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_registration_org_request_uidx" ON "enrollment_registration" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "enrollment_registration_org_student_idx" ON "enrollment_registration" USING btree ("organization_id","student_id","created_at");