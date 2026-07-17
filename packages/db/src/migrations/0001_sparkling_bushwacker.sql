DROP INDEX "student_guardian_phone_idx";--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "amount_in_cents" integer;--> statement-breakpoint
UPDATE "enrollment" AS "enrollment_row"
SET "amount_in_cents" = COALESCE(
	(
		SELECT SUM("invoice"."amount_in_cents")
		FROM "invoice"
		WHERE "invoice"."enrollment_id" = "enrollment_row"."id"
	),
	GREATEST("enrollment_row"."paid_amount_in_cents", 0)
);--> statement-breakpoint
ALTER TABLE "enrollment" ALTER COLUMN "amount_in_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "enrollment" ALTER COLUMN "amount_in_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_group_org_course_status_idx" ON "class_group" USING btree ("organization_id","course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_org_lead_uidx" ON "enrollment" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "enrollment_org_idx" ON "enrollment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "student_org_guardian_phone_idx" ON "student" USING btree ("organization_id","guardian_phone");
