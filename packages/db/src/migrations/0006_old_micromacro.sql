CREATE TYPE "public"."campus_access_mode" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."organization_audit_action" AS ENUM('campus_created', 'campus_updated', 'campus_activated', 'campus_deactivated', 'invitation_created', 'invitation_revoked', 'invitation_claimed', 'member_role_changed', 'member_access_changed', 'member_removed');--> statement-breakpoint
CREATE TABLE "organization_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" "organization_audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" "member_role" NOT NULL,
	"campus_access_mode" "campus_access_mode" DEFAULT 'all' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"claimed_by_user_id" text,
	"request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitation_campus" (
	"organization_invitation_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_member_campus" (
	"organization_member_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campus" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_member" ADD COLUMN "campus_access_mode" "campus_access_mode" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_audit_event" ADD CONSTRAINT "organization_audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_audit_event" ADD CONSTRAINT "organization_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_audit_event" ADD CONSTRAINT "organization_audit_event_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation_campus" ADD CONSTRAINT "organization_invitation_campus_organization_invitation_id_organization_invitation_id_fk" FOREIGN KEY ("organization_invitation_id") REFERENCES "public"."organization_invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation_campus" ADD CONSTRAINT "organization_invitation_campus_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_campus" ADD CONSTRAINT "organization_member_campus_organization_member_id_organization_member_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "public"."organization_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_campus" ADD CONSTRAINT "organization_member_campus_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_audit_event_org_created_idx" ON "organization_audit_event" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "organization_audit_event_org_entity_idx" ON "organization_audit_event" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitation_token_hash_uidx" ON "organization_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitation_org_request_uidx" ON "organization_invitation" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "organization_invitation_org_email_idx" ON "organization_invitation" USING btree ("organization_id","email_normalized");--> statement-breakpoint
CREATE INDEX "organization_invitation_org_expires_idx" ON "organization_invitation" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitation_campus_uidx" ON "organization_invitation_campus" USING btree ("organization_invitation_id","campus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_member_campus_uidx" ON "organization_member_campus" USING btree ("organization_member_id","campus_id");--> statement-breakpoint
CREATE INDEX "organization_member_campus_campus_idx" ON "organization_member_campus" USING btree ("campus_id");
--> statement-breakpoint
CREATE FUNCTION "prevent_organization_audit_event_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Organization audit events are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organization_audit_event_immutable_update" BEFORE UPDATE ON "organization_audit_event" FOR EACH ROW EXECUTE FUNCTION "prevent_organization_audit_event_update"();
