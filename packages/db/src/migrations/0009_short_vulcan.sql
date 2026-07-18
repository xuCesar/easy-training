CREATE TABLE "lesson_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"attendance_status" "attendance_status" NOT NULL,
	"previous_remaining_lessons" integer NOT NULL,
	"remaining_lessons" integer NOT NULL,
	"consumed_by_user_id" text,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_consumption" ADD CONSTRAINT "lesson_consumption_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_consumption" ADD CONSTRAINT "lesson_consumption_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_consumption" ADD CONSTRAINT "lesson_consumption_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_consumption" ADD CONSTRAINT "lesson_consumption_consumed_by_user_id_user_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_consumption_enrollment_lesson_uidx" ON "lesson_consumption" USING btree ("enrollment_id","lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_consumption_org_lesson_idx" ON "lesson_consumption" USING btree ("organization_id","lesson_id");