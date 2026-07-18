CREATE TYPE "public"."lead_activity_type" AS ENUM('created', 'updated', 'followed_up', 'converted');--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "lead_activity_type" NOT NULL,
	"content" text NOT NULL,
	"stage" "lead_stage" NOT NULL,
	"next_follow_at" timestamp with time zone,
	"lost_reason" text,
	"operator_user_id" text,
	"operator_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "lead_activity" ("organization_id", "lead_id", "type", "content", "stage", "next_follow_at", "operator_name", "created_at")
SELECT
	"organization_id",
	"id",
	'created',
	COALESCE(NULLIF("note", ''), '历史线索导入'),
	"stage",
	"next_follow_at",
	'系统迁移',
	"created_at"
FROM "lead";--> statement-breakpoint
CREATE FUNCTION "prevent_lead_activity_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Lead activities are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "lead_activity_immutable_update" BEFORE UPDATE ON "lead_activity" FOR EACH ROW EXECUTE FUNCTION "prevent_lead_activity_update"();--> statement-breakpoint
CREATE INDEX "lead_activity_org_lead_created_idx" ON "lead_activity" USING btree ("organization_id","lead_id","created_at","id");--> statement-breakpoint
CREATE INDEX "lead_org_created_idx" ON "lead" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "lead_org_campus_created_idx" ON "lead" USING btree ("organization_id","campus_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_org_owner_created_idx" ON "lead" USING btree ("organization_id","owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_org_request_uidx" ON "lead" USING btree ("organization_id","request_id");
