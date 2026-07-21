CREATE TYPE "public"."receipt_status" AS ENUM('active', 'voided');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'receipt_generated';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'receipt_voided';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'receipt_reissued';--> statement-breakpoint
CREATE TABLE "receipt_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"number" text NOT NULL,
	"year_month" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" "receipt_status" DEFAULT 'active' NOT NULL,
	"generation_request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"organization_name" text NOT NULL,
	"campus_name" text NOT NULL,
	"student_id" uuid NOT NULL,
	"student_name" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_summary" text NOT NULL,
	"invoice_amount_in_cents" integer NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"replaces_receipt_id" uuid,
	"generated_by_user_id" text NOT NULL,
	"generated_by_name" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"void_reason" text,
	"voided_by_user_id" text,
	"voided_by_name" text,
	"voided_at" timestamp with time zone,
	"void_request_id" uuid,
	CONSTRAINT "receipt_document_sequence_positive_check" CHECK ("receipt_document"."sequence" > 0),
	CONSTRAINT "receipt_document_snapshot_version_positive_check" CHECK ("receipt_document"."snapshot_version" > 0),
	CONSTRAINT "receipt_document_void_state_check" CHECK (("receipt_document"."status" = 'active' AND "receipt_document"."void_reason" IS NULL AND "receipt_document"."voided_by_user_id" IS NULL AND "receipt_document"."voided_by_name" IS NULL AND "receipt_document"."voided_at" IS NULL AND "receipt_document"."void_request_id" IS NULL) OR ("receipt_document"."status" = 'voided' AND "receipt_document"."void_reason" IS NOT NULL AND "receipt_document"."voided_by_user_id" IS NOT NULL AND "receipt_document"."voided_by_name" IS NOT NULL AND "receipt_document"."voided_at" IS NOT NULL AND "receipt_document"."void_request_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "receipt_document_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference_no" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "receipt_document_payment_amount_positive_check" CHECK ("receipt_document_payment"."amount_in_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_number_counter" (
	"organization_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"last_sequence" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_number_counter_organization_id_year_month_pk" PRIMARY KEY("organization_id","year_month"),
	CONSTRAINT "receipt_number_counter_sequence_positive_check" CHECK ("receipt_number_counter"."last_sequence" > 0),
	CONSTRAINT "receipt_number_counter_year_month_check" CHECK ("receipt_number_counter"."year_month" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_replaces_receipt_id_receipt_document_id_fk" FOREIGN KEY ("replaces_receipt_id") REFERENCES "public"."receipt_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_generated_by_user_id_user_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document" ADD CONSTRAINT "receipt_document_voided_by_user_id_user_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document_payment" ADD CONSTRAINT "receipt_document_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document_payment" ADD CONSTRAINT "receipt_document_payment_receipt_id_receipt_document_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_document_payment" ADD CONSTRAINT "receipt_document_payment_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_number_counter" ADD CONSTRAINT "receipt_number_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_org_number_uidx" ON "receipt_document" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_org_month_sequence_uidx" ON "receipt_document" USING btree ("organization_id","year_month","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_org_generation_request_uidx" ON "receipt_document" USING btree ("organization_id","generation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_org_void_request_uidx" ON "receipt_document" USING btree ("organization_id","void_request_id") WHERE "receipt_document"."void_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "receipt_document_org_invoice_generated_idx" ON "receipt_document" USING btree ("organization_id","invoice_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_payment_receipt_payment_uidx" ON "receipt_document_payment" USING btree ("receipt_id","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_document_payment_org_payment_active_uidx" ON "receipt_document_payment" USING btree ("organization_id","payment_id") WHERE "receipt_document_payment"."is_active" = true;--> statement-breakpoint
CREATE INDEX "receipt_document_payment_org_receipt_idx" ON "receipt_document_payment" USING btree ("organization_id","receipt_id");