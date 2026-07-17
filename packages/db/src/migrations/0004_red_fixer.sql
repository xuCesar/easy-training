ALTER TABLE "session" ADD COLUMN "active_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "organization_initialized_at" timestamp;--> statement-breakpoint
UPDATE "user"
SET "organization_initialized_at" = now()
WHERE EXISTS (
	SELECT 1
	FROM "organization_member"
	WHERE "organization_member"."user_id" = "user"."id"
);
