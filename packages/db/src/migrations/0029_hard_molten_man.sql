CREATE TYPE "public"."arrears_event_type" AS ENUM('cycle_started', 'status_changed', 'note_added', 'auto_resolved');--> statement-breakpoint
CREATE TYPE "public"."arrears_status" AS ENUM('pending', 'following_up', 'promised', 'paused', 'resolved');--> statement-breakpoint
ALTER TYPE "public"."organization_audit_action" ADD VALUE 'arrears_status_changed';--> statement-breakpoint
CREATE TABLE "invoice_arrears_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"status" "arrears_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"promised_payment_date" date,
	"resume_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_arrears_cycle_number_positive_check" CHECK ("invoice_arrears_cycle"."cycle_number" > 0),
	CONSTRAINT "invoice_arrears_cycle_version_positive_check" CHECK ("invoice_arrears_cycle"."version" > 0),
	CONSTRAINT "invoice_arrears_cycle_resolved_state_check" CHECK (("invoice_arrears_cycle"."status" = 'resolved') = ("invoice_arrears_cycle"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invoice_arrears_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"event_type" "arrears_event_type" NOT NULL,
	"from_status" "arrears_status",
	"to_status" "arrears_status",
	"promised_payment_date" date,
	"resume_date" date,
	"reason" text,
	"note" text,
	"operator_user_id" text,
	"operator_name" text,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_arrears_cycle" ADD CONSTRAINT "invoice_arrears_cycle_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_arrears_cycle" ADD CONSTRAINT "invoice_arrears_cycle_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_arrears_cycle" ADD CONSTRAINT "invoice_arrears_cycle_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_arrears_event" ADD CONSTRAINT "invoice_arrears_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_arrears_event" ADD CONSTRAINT "invoice_arrears_event_cycle_id_invoice_arrears_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."invoice_arrears_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_arrears_event" ADD CONSTRAINT "invoice_arrears_event_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_arrears_cycle_org_invoice_number_uidx" ON "invoice_arrears_cycle" USING btree ("organization_id","invoice_id","cycle_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_arrears_cycle_org_invoice_open_uidx" ON "invoice_arrears_cycle" USING btree ("organization_id","invoice_id") WHERE "invoice_arrears_cycle"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invoice_arrears_cycle_org_campus_status_idx" ON "invoice_arrears_cycle" USING btree ("organization_id","campus_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_arrears_event_org_request_uidx" ON "invoice_arrears_event" USING btree ("organization_id","request_id") WHERE "invoice_arrears_event"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_arrears_event_org_source_uidx" ON "invoice_arrears_event" USING btree ("organization_id","source_type","source_id","event_type") WHERE "invoice_arrears_event"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_arrears_event_org_cycle_created_idx" ON "invoice_arrears_event" USING btree ("organization_id","cycle_id","created_at");
--> statement-breakpoint
WITH legacy AS (
	SELECT
		i."id" AS invoice_id,
		i."organization_id",
		s."campus_id",
		i."amount_in_cents",
		i."paid_amount_in_cents",
		i."status" AS invoice_status,
		i."issued_at",
		i."paid_at",
		MIN(f."followed_up_at") AS first_followed_up_at,
		MAX(f."followed_up_at") AS last_followed_up_at,
		COUNT(f."id") > 0 AS has_follow_up
	FROM "invoice" i
	INNER JOIN "student" s
		ON s."id" = i."student_id"
		AND s."organization_id" = i."organization_id"
	LEFT JOIN "invoice_follow_up" f
		ON f."invoice_id" = i."id"
		AND f."organization_id" = i."organization_id"
	GROUP BY i."id", i."organization_id", s."campus_id", i."amount_in_cents", i."paid_amount_in_cents", i."status", i."issued_at", i."paid_at"
)
INSERT INTO "invoice_arrears_cycle" (
	"organization_id", "campus_id", "invoice_id", "cycle_number", "status", "version", "started_at", "resolved_at"
)
SELECT
	legacy."organization_id",
	legacy."campus_id",
	legacy."invoice_id",
	1,
	CASE
		WHEN legacy."invoice_status" <> 'refunded' AND legacy."amount_in_cents" > legacy."paid_amount_in_cents"
			THEN CASE WHEN legacy."has_follow_up" THEN 'following_up'::"arrears_status" ELSE 'pending'::"arrears_status" END
		ELSE 'resolved'::"arrears_status"
	END,
	1,
	COALESCE(legacy."first_followed_up_at", legacy."issued_at"),
	CASE
		WHEN legacy."invoice_status" <> 'refunded' AND legacy."amount_in_cents" > legacy."paid_amount_in_cents" THEN NULL
		ELSE COALESCE(legacy."paid_at", legacy."last_followed_up_at", legacy."issued_at")
	END
FROM legacy
WHERE
	(legacy."invoice_status" <> 'refunded' AND legacy."amount_in_cents" > legacy."paid_amount_in_cents")
	OR legacy."has_follow_up"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_arrears_event" (
	"organization_id", "cycle_id", "event_type", "to_status", "source_type", "source_id", "created_at"
)
SELECT
	c."organization_id",
	c."id",
	'cycle_started'::"arrears_event_type",
	'pending'::"arrears_status",
	'migration',
	c."id",
	c."started_at"
FROM "invoice_arrears_cycle" c
WHERE c."cycle_number" = 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_arrears_event" (
	"organization_id", "cycle_id", "event_type", "from_status", "to_status", "source_type", "source_id", "created_at"
)
SELECT
	c."organization_id",
	c."id",
	'status_changed'::"arrears_event_type",
	'pending'::"arrears_status",
	'following_up'::"arrears_status",
	'migration',
	c."id",
	c."started_at"
FROM "invoice_arrears_cycle" c
WHERE c."cycle_number" = 1
	AND c."status" IN ('following_up', 'resolved')
	AND EXISTS (
		SELECT 1 FROM "invoice_follow_up" f
		WHERE f."organization_id" = c."organization_id"
			AND f."invoice_id" = c."invoice_id"
	)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_arrears_event" (
	"id", "organization_id", "cycle_id", "event_type", "note", "operator_user_id", "operator_name", "source_type", "source_id", "request_id", "created_at"
)
SELECT
	f."id",
	f."organization_id",
	c."id",
	'note_added'::"arrears_event_type",
	f."note",
	f."operator_user_id",
	f."operator_name",
	'invoice_follow_up',
	f."id",
	f."request_id",
	f."followed_up_at"
FROM "invoice_follow_up" f
INNER JOIN "invoice_arrears_cycle" c
	ON c."organization_id" = f."organization_id"
	AND c."invoice_id" = f."invoice_id"
	AND c."cycle_number" = 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_arrears_event" (
	"organization_id", "cycle_id", "event_type", "from_status", "to_status", "source_type", "source_id", "created_at"
)
SELECT
	c."organization_id",
	c."id",
	'auto_resolved'::"arrears_event_type",
	CASE
		WHEN EXISTS (
			SELECT 1 FROM "invoice_follow_up" f
			WHERE f."organization_id" = c."organization_id"
				AND f."invoice_id" = c."invoice_id"
		) THEN 'following_up'::"arrears_status"
		ELSE 'pending'::"arrears_status"
	END,
	'resolved'::"arrears_status",
	'migration',
	c."id",
	c."resolved_at"
FROM "invoice_arrears_cycle" c
WHERE c."cycle_number" = 1
	AND c."status" = 'resolved'
ON CONFLICT DO NOTHING;
