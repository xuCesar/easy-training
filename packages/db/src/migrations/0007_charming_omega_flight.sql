CREATE TABLE "student_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"relationship" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_tag_assignment" (
	"student_id" uuid NOT NULL,
	"student_tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_contact" ADD CONSTRAINT "student_contact_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_tag" ADD CONSTRAINT "student_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_tag_assignment" ADD CONSTRAINT "student_tag_assignment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_tag_assignment" ADD CONSTRAINT "student_tag_assignment_student_tag_id_student_tag_id_fk" FOREIGN KEY ("student_tag_id") REFERENCES "public"."student_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "student_contact" ("student_id", "name", "phone", "is_primary", "created_at", "updated_at")
SELECT "id", "guardian_name", "guardian_phone", true, "created_at", "updated_at"
FROM "student";--> statement-breakpoint
CREATE UNIQUE INDEX "student_contact_primary_uidx" ON "student_contact" USING btree ("student_id") WHERE "student_contact"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "student_contact_student_idx" ON "student_contact" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_tag_org_name_normalized_uidx" ON "student_tag" USING btree ("organization_id","name_normalized");--> statement-breakpoint
CREATE INDEX "student_tag_org_active_name_idx" ON "student_tag" USING btree ("organization_id","is_active","name");--> statement-breakpoint
CREATE UNIQUE INDEX "student_tag_assignment_uidx" ON "student_tag_assignment" USING btree ("student_id","student_tag_id");--> statement-breakpoint
CREATE INDEX "student_tag_assignment_tag_idx" ON "student_tag_assignment" USING btree ("student_tag_id");
