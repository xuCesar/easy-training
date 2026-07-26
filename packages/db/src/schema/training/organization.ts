import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import {
	campusAccessMode,
	memberRole,
	organizationAuditAction,
	organizationNotificationType,
} from "./enums";

export const organization = pgTable("organization", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const organizationMember = pgTable(
	"organization_member",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: memberRole("role").notNull(),
		campusAccessMode: campusAccessMode("campus_access_mode")
			.default("all")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_member_org_user_uidx").on(
			table.organizationId,
			table.userId,
		),
		index("organization_member_user_idx").on(table.userId),
	],
);

export const campus = pgTable(
	"campus",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		code: text("code").notNull(),
		name: text("name").notNull(),
		city: text("city").notNull(),
		address: text("address").notNull(),
		roomCount: integer("room_count").default(0).notNull(),
		capacity: integer("capacity").default(0).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("campus_org_code_uidx").on(table.organizationId, table.code),
		uniqueIndex("campus_org_id_uidx").on(table.organizationId, table.id),
		index("campus_org_idx").on(table.organizationId),
	],
);

export const organizationMemberCampus = pgTable(
	"organization_member_campus",
	{
		organizationMemberId: uuid("organization_member_id")
			.notNull()
			.references(() => organizationMember.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("organization_member_campus_uidx").on(
			table.organizationMemberId,
			table.campusId,
		),
		index("organization_member_campus_campus_idx").on(table.campusId),
	],
);

export const organizationInvitation = pgTable(
	"organization_invitation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		emailNormalized: text("email_normalized").notNull(),
		tokenHash: text("token_hash").notNull(),
		role: memberRole("role").notNull(),
		campusAccessMode: campusAccessMode("campus_access_mode")
			.default("all")
			.notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		claimedByUserId: text("claimed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		requestId: uuid("request_id").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_invitation_token_hash_uidx").on(table.tokenHash),
		uniqueIndex("organization_invitation_org_request_uidx").on(
			table.organizationId,
			table.requestId,
		),
		index("organization_invitation_org_email_idx").on(
			table.organizationId,
			table.emailNormalized,
		),
		index("organization_invitation_org_expires_idx").on(
			table.organizationId,
			table.expiresAt,
		),
	],
);

// 平台级"机构开通邀请"(#66):不隶属任何机构,受邀邮箱注册后
// 自动创建指定名称的新机构并授予 owner。
export const organizationOnboardingInvitation = pgTable(
	"organization_onboarding_invitation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		emailNormalized: text("email_normalized").notNull(),
		tokenHash: text("token_hash").notNull(),
		organizationName: text("organization_name").notNull(),
		note: text("note"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		claimedByUserId: text("claimed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdOrganizationId: uuid("created_organization_id").references(
			() => organization.id,
			{ onDelete: "set null" },
		),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_onboarding_invitation_token_hash_uidx").on(
			table.tokenHash,
		),
		index("organization_onboarding_invitation_email_idx").on(
			table.emailNormalized,
		),
	],
);

export const organizationInvitationCampus = pgTable(
	"organization_invitation_campus",
	{
		organizationInvitationId: uuid("organization_invitation_id")
			.notNull()
			.references(() => organizationInvitation.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id")
			.notNull()
			.references(() => campus.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("organization_invitation_campus_uidx").on(
			table.organizationInvitationId,
			table.campusId,
		),
	],
);

export const organizationAuditEvent = pgTable(
	"organization_audit_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		action: organizationAuditAction("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		targetUserId: text("target_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		before: jsonb("before"),
		after: jsonb("after"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("organization_audit_event_org_created_idx").on(
			table.organizationId,
			table.createdAt,
			table.id,
		),
		index("organization_audit_event_org_entity_idx").on(
			table.organizationId,
			table.entityType,
			table.entityId,
		),
		index("organization_audit_event_org_campus_created_idx").on(
			table.organizationId,
			table.campusId,
			table.createdAt,
			table.id,
		),
	],
);

export const analyticsSavedFilter = pgTable(
	"analytics_saved_filter",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		reportKind: text("report_kind").notNull(),
		config: jsonb("config").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("analytics_saved_filter_org_user_kind_name_uidx").on(
			table.organizationId,
			table.userId,
			table.reportKind,
			table.name,
		),
		index("analytics_saved_filter_org_user_updated_idx").on(
			table.organizationId,
			table.userId,
			table.updatedAt,
			table.id,
		),
	],
);

export const organizationNotification = pgTable(
	"organization_notification",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		campusId: uuid("campus_id").references(() => campus.id, {
			onDelete: "set null",
		}),
		type: organizationNotificationType("type").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		readAt: timestamp("read_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("organization_notification_recipient_key_uidx").on(
			table.organizationId,
			table.recipientUserId,
			table.idempotencyKey,
		),
		index("organization_notification_recipient_read_created_idx").on(
			table.organizationId,
			table.recipientUserId,
			table.readAt,
			table.createdAt,
			table.id,
		),
	],
);
