CREATE TYPE "public"."payment_method" AS ENUM('cash', 'wechat', 'alipay', 'bank_transfer', 'pos', 'other');--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'partial' BEFORE 'overdue';--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference_no" text,
	"note" text,
	"operator_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_positive_check" CHECK ("payment"."amount_in_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_org_request_uidx" ON "payment" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "payment_org_invoice_received_idx" ON "payment" USING btree ("organization_id","invoice_id","received_at");