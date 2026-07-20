CREATE TYPE "public"."class_pause_future_lesson_policy" AS ENUM('keep', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."class_status_event_kind" AS ENUM('paused', 'resumed');--> statement-breakpoint
CREATE TABLE "class_status_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"kind" "class_status_event_kind" NOT NULL,
	"future_lesson_policy" "class_pause_future_lesson_policy",
	"reason" text NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_status_event" ADD CONSTRAINT "class_status_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_status_event" ADD CONSTRAINT "class_status_event_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_status_event" ADD CONSTRAINT "class_status_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_status_event_org_request_uidx" ON "class_status_event" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "class_status_event_class_created_idx" ON "class_status_event" USING btree ("class_group_id","created_at");