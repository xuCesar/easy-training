CREATE TYPE "public"."onboarding_invitation_closed_reason" AS ENUM('revoked', 'rotated', 'expired_superseded', 'break_glass_rotated');--> statement-breakpoint
CREATE TYPE "public"."platform_audit_action" AS ENUM('onboarding_invitation_created', 'onboarding_invitation_rotated', 'onboarding_invitation_revoked', 'onboarding_invitation_claimed');--> statement-breakpoint
CREATE TYPE "public"."platform_audit_source" AS ENUM('web', 'break_glass', 'migration');--> statement-breakpoint
CREATE TABLE "platform_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "platform_audit_action" NOT NULL,
	"source" "platform_audit_source" NOT NULL,
	"actor_user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"request_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD COLUMN "revoked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD COLUMN "replaces_invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD COLUMN "closed_reason" "onboarding_invitation_closed_reason";--> statement-breakpoint
ALTER TABLE "platform_audit_event" ADD CONSTRAINT "platform_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_event_created_idx" ON "platform_audit_event" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "platform_audit_event_entity_idx" ON "platform_audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "platform_audit_event_actor_created_idx" ON "platform_audit_event" USING btree ("actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD CONSTRAINT "organization_onboarding_invitation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD CONSTRAINT "organization_onboarding_invitation_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD CONSTRAINT "organization_onboarding_invitation_replaces_invitation_id_organization_onboarding_invitation_id_fk" FOREIGN KEY ("replaces_invitation_id") REFERENCES "public"."organization_onboarding_invitation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
WITH ranked_open_invitations AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "email_normalized"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "position"
	FROM "organization_onboarding_invitation"
	WHERE "revoked_at" IS NULL AND "claimed_at" IS NULL
), closed_duplicates AS (
	UPDATE "organization_onboarding_invitation" AS invitation
	SET
		"revoked_at" = now(),
		"closed_reason" = CASE
			WHEN invitation."expires_at" <= now()
				THEN 'expired_superseded'::"onboarding_invitation_closed_reason"
			ELSE 'rotated'::"onboarding_invitation_closed_reason"
		END
	FROM ranked_open_invitations
	WHERE invitation."id" = ranked_open_invitations."id"
		AND ranked_open_invitations."position" > 1
	RETURNING invitation."id"
)
INSERT INTO "platform_audit_event" (
	"action",
	"source",
	"actor_user_id",
	"entity_type",
	"entity_id",
	"metadata"
)
SELECT
	'onboarding_invitation_revoked'::"platform_audit_action",
	'migration'::"platform_audit_source",
	NULL,
	'organizationOnboardingInvitation',
	"id",
	jsonb_build_object('reason', 'duplicate_open_invitation_cleanup')
FROM closed_duplicates;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_onboarding_invitation_request_uidx" ON "organization_onboarding_invitation" USING btree ("request_id") WHERE "organization_onboarding_invitation"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_onboarding_invitation_open_email_uidx" ON "organization_onboarding_invitation" USING btree ("email_normalized") WHERE "organization_onboarding_invitation"."revoked_at" IS NULL AND "organization_onboarding_invitation"."claimed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "organization_onboarding_invitation_created_idx" ON "organization_onboarding_invitation" USING btree ("created_at","id");
