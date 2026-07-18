ALTER TABLE "course" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_org_active_name_idx" ON "course" USING btree ("organization_id","is_active","name");--> statement-breakpoint
CREATE INDEX "lesson_org_teacher_starts_idx" ON "lesson" USING btree ("organization_id","teacher_id","starts_at");--> statement-breakpoint
CREATE INDEX "lesson_org_campus_room_starts_idx" ON "lesson" USING btree ("organization_id","campus_id","room","starts_at");