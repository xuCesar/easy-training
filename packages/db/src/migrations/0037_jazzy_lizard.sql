CREATE TABLE "class_group_capacity_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"capacity" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_capacity_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"weekly_capacity_minutes" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_group_capacity_history" ADD CONSTRAINT "class_group_capacity_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group_capacity_history" ADD CONSTRAINT "class_group_capacity_history_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group_capacity_history" ADD CONSTRAINT "class_group_capacity_history_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_capacity_history" ADD CONSTRAINT "teacher_capacity_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_capacity_history" ADD CONSTRAINT "teacher_capacity_history_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_capacity_history" ADD CONSTRAINT "teacher_capacity_history_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_group_capacity_history_group_effective_uidx" ON "class_group_capacity_history" USING btree ("class_group_id","effective_from");--> statement-breakpoint
CREATE INDEX "class_group_capacity_history_org_group_effective_idx" ON "class_group_capacity_history" USING btree ("organization_id","class_group_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_capacity_history_teacher_effective_uidx" ON "teacher_capacity_history" USING btree ("teacher_id","effective_from");--> statement-breakpoint
CREATE INDEX "teacher_capacity_history_org_teacher_effective_idx" ON "teacher_capacity_history" USING btree ("organization_id","teacher_id","effective_from");