CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'transferred');--> statement-breakpoint
CREATE TABLE "enrollment_renewal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"added_lessons" integer NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"operator_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_enrollment_id" uuid NOT NULL,
	"target_enrollment_id" uuid NOT NULL,
	"target_course_id" uuid NOT NULL,
	"transferred_lessons" integer NOT NULL,
	"operator_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_follow_up" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"note" text NOT NULL,
	"followed_up_at" timestamp with time zone NOT NULL,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"method" "payment_method" NOT NULL,
	"reason" text NOT NULL,
	"operator_user_id" text NOT NULL,
	"operator_name" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount_positive_check" CHECK ("refund"."amount_in_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "status" "enrollment_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_renewal" ADD CONSTRAINT "enrollment_renewal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_renewal" ADD CONSTRAINT "enrollment_renewal_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_renewal" ADD CONSTRAINT "enrollment_renewal_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_transfer" ADD CONSTRAINT "enrollment_transfer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_transfer" ADD CONSTRAINT "enrollment_transfer_source_enrollment_id_enrollment_id_fk" FOREIGN KEY ("source_enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_transfer" ADD CONSTRAINT "enrollment_transfer_target_enrollment_id_enrollment_id_fk" FOREIGN KEY ("target_enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_transfer" ADD CONSTRAINT "enrollment_transfer_target_course_id_course_id_fk" FOREIGN KEY ("target_course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_transfer" ADD CONSTRAINT "enrollment_transfer_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_follow_up" ADD CONSTRAINT "invoice_follow_up_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_follow_up" ADD CONSTRAINT "invoice_follow_up_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_follow_up" ADD CONSTRAINT "invoice_follow_up_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_renewal_org_request_uidx" ON "enrollment_renewal" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "enrollment_renewal_org_enrollment_idx" ON "enrollment_renewal" USING btree ("organization_id","enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_transfer_org_request_uidx" ON "enrollment_transfer" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_transfer_source_uidx" ON "enrollment_transfer" USING btree ("source_enrollment_id");--> statement-breakpoint
CREATE INDEX "enrollment_transfer_org_target_idx" ON "enrollment_transfer" USING btree ("organization_id","target_enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_follow_up_org_request_uidx" ON "invoice_follow_up" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "invoice_follow_up_org_invoice_followed_idx" ON "invoice_follow_up" USING btree ("organization_id","invoice_id","followed_up_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_org_request_uidx" ON "refund" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "refund_org_invoice_refunded_idx" ON "refund" USING btree ("organization_id","invoice_id","refunded_at");
