CREATE TYPE "public"."refund_request_action" AS ENUM('submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'refund_request_submitted';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'refund_request_approved';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'refund_request_rejected';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'refund_request_cancelled';--> statement-breakpoint
CREATE TABLE "refund_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"method" "payment_method" NOT NULL,
	"reason" text NOT NULL,
	"applicant_user_id" text NOT NULL,
	"applicant_name" text NOT NULL,
	"status" "refund_request_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"refund_id" uuid,
	"submission_request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_request_amount_positive_check" CHECK ("refund_request"."amount_in_cents" > 0),
	CONSTRAINT "refund_request_version_positive_check" CHECK ("refund_request"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "refund_request_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"refund_request_id" uuid NOT NULL,
	"action" "refund_request_action" NOT NULL,
	"from_status" "refund_request_status",
	"to_status" "refund_request_status" NOT NULL,
	"comment" text,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_event" ADD CONSTRAINT "refund_request_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_event" ADD CONSTRAINT "refund_request_event_refund_request_id_refund_request_id_fk" FOREIGN KEY ("refund_request_id") REFERENCES "public"."refund_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_event" ADD CONSTRAINT "refund_request_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_org_submission_request_uidx" ON "refund_request" USING btree ("organization_id","submission_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_org_refund_uidx" ON "refund_request" USING btree ("organization_id","refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_org_invoice_pending_uidx" ON "refund_request" USING btree ("organization_id","invoice_id") WHERE "refund_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "refund_request_org_invoice_created_idx" ON "refund_request" USING btree ("organization_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_event_org_request_uidx" ON "refund_request_event" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "refund_request_event_org_refund_request_created_idx" ON "refund_request_event" USING btree ("organization_id","refund_request_id","created_at");