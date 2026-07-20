ALTER TABLE "lesson_schedule_rule" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "makeup_lesson" ADD COLUMN "request_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_schedule_rule" ADD CONSTRAINT "lesson_schedule_rule_room_id_classroom_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."classroom"("id") ON DELETE set null ON UPDATE no action;