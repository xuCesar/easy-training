CREATE TYPE "public"."operation_task_history_action" AS ENUM('created', 'updated', 'claimed', 'rescheduled', 'reassigned', 'completed', 'reopened', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."operation_task_reminder_status" AS ENUM('pending', 'leased', 'delivered', 'cancelled', 'dead');--> statement-breakpoint
CREATE TYPE "public"."operation_task_reminder_type" AS ENUM('before_due', 'due', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."operation_task_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_created';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_updated';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_claimed';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_completed';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_reopened';--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'operation_task_cancelled';--> statement-breakpoint
ALTER TYPE "public"."organization_notification_type" ADD VALUE 'operation_task_assigned';--> statement-breakpoint
ALTER TYPE "public"."organization_notification_type" ADD VALUE 'operation_task_completed';--> statement-breakpoint
ALTER TYPE "public"."organization_notification_type" ADD VALUE 'operation_task_reminder';--> statement-breakpoint
CREATE TABLE "operation_task_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_version" integer NOT NULL,
	"action" "operation_task_history_action" NOT NULL,
	"from_status" "operation_task_status",
	"to_status" "operation_task_status",
	"actor_user_id" text,
	"owner_user_id" text,
	"due_at" timestamp with time zone,
	"remind_before_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_task_history_version_positive_check" CHECK ("operation_task_history"."task_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_task_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_version" integer NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" "operation_task_reminder_type" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"due_at_snapshot" timestamp with time zone NOT NULL,
	"status" "operation_task_reminder_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_task_reminder_version_positive_check" CHECK ("operation_task_reminder"."task_version" > 0),
	CONSTRAINT "operation_task_reminder_attempt_count_nonnegative_check" CHECK ("operation_task_reminder"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "campus_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "remind_before_minutes" integer;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "status" "operation_task_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "completed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "operation_task"
SET "status" = CASE
	WHEN "completed_at" IS NOT NULL THEN 'completed'::"operation_task_status"
	ELSE 'pending'::"operation_task_status"
END;--> statement-breakpoint
ALTER TABLE "operation_task_history" ADD CONSTRAINT "operation_task_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_history" ADD CONSTRAINT "operation_task_history_task_id_operation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."operation_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_history" ADD CONSTRAINT "operation_task_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_history" ADD CONSTRAINT "operation_task_history_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_reminder" ADD CONSTRAINT "operation_task_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_reminder" ADD CONSTRAINT "operation_task_reminder_task_id_operation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."operation_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task_reminder" ADD CONSTRAINT "operation_task_reminder_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_task_history_task_version_uidx" ON "operation_task_history" USING btree ("task_id","task_version");--> statement-breakpoint
CREATE INDEX "operation_task_history_org_task_created_idx" ON "operation_task_history" USING btree ("organization_id","task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_task_reminder_task_version_type_uidx" ON "operation_task_reminder" USING btree ("task_id","task_version","type");--> statement-breakpoint
CREATE INDEX "operation_task_reminder_pending_claim_idx" ON "operation_task_reminder" USING btree ("available_at","scheduled_at","id") WHERE "operation_task_reminder"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "operation_task_reminder_leased_expiry_idx" ON "operation_task_reminder" USING btree ("lease_expires_at","id") WHERE "operation_task_reminder"."status" = 'leased';--> statement-breakpoint
CREATE INDEX "operation_task_reminder_task_status_idx" ON "operation_task_reminder" USING btree ("task_id","status");--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_task_org_status_due_idx" ON "operation_task" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "operation_task_org_campus_status_due_idx" ON "operation_task" USING btree ("organization_id","campus_id","status","due_at");--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_version_positive_check" CHECK ("operation_task"."version" > 0);--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_remind_before_range_check" CHECK ("operation_task"."remind_before_minutes" is null or ("operation_task"."remind_before_minutes" >= 5 and "operation_task"."remind_before_minutes" <= 10080));--> statement-breakpoint
ALTER TABLE "operation_task" ADD CONSTRAINT "operation_task_related_entity_pair_check" CHECK (("operation_task"."related_entity_type" is null) = ("operation_task"."related_entity_id" is null));
