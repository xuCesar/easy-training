ALTER TYPE "public"."organization_audit_action" ADD VALUE 'payment_created' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'refund_created' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_renewed' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'enrollment_transferred' BEFORE 'lead_imported';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'lesson_completed' BEFORE 'lead_imported';