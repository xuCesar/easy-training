ALTER TYPE "public"."organization_audit_action" ADD VALUE 'student_erased';--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "anonymized_at" timestamp with time zone;