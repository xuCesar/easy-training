ALTER TYPE "public"."organization_audit_action" ADD VALUE 'organization_onboarded';--> statement-breakpoint
CREATE TABLE "organization_onboarding_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"organization_name" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_by_user_id" text,
	"created_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD CONSTRAINT "organization_onboarding_invitation_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding_invitation" ADD CONSTRAINT "organization_onboarding_invitation_created_organization_id_organization_id_fk" FOREIGN KEY ("created_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_onboarding_invitation_token_hash_uidx" ON "organization_onboarding_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "organization_onboarding_invitation_email_idx" ON "organization_onboarding_invitation" USING btree ("email_normalized");