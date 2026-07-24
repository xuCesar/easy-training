CREATE INDEX "attendance_lesson_status_idx" ON "attendance" USING btree ("lesson_id","status");--> statement-breakpoint
CREATE INDEX "makeup_lesson_org_updated_idx" ON "makeup_lesson" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "student_contact_student_phone_idx" ON "student_contact" USING btree ("student_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "teacher_campus_campus_teacher_idx" ON "teacher_campus" USING btree ("campus_id","teacher_id");