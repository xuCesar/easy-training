ALTER TYPE "public"."organization_audit_action" ADD VALUE 'payment_reversed' BEFORE 'refund_created';--> statement-breakpoint
CREATE TABLE "payment_reversal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"reversed_at" timestamp with time zone NOT NULL,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversal_amount_positive_check" CHECK ("payment_reversal"."amount_in_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_reversal" ADD CONSTRAINT "payment_reversal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal" ADD CONSTRAINT "payment_reversal_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal" ADD CONSTRAINT "payment_reversal_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal" ADD CONSTRAINT "payment_reversal_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal" ADD CONSTRAINT "payment_reversal_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reversal_org_request_uidx" ON "payment_reversal" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "payment_reversal_org_payment_reversed_idx" ON "payment_reversal" USING btree ("organization_id","payment_id","reversed_at","id");