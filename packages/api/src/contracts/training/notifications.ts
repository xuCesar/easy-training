import { z } from "zod";

const notificationSchema = z.object({
	id: z.uuid(),
	type: z.enum([
		"lead_import_completed",
		"lead_import_failed",
		"invoice_follow_up",
		"operation_task_assigned",
		"operation_task_completed",
		"operation_task_reminder",
	]),
	title: z.string(),
	body: z.string(),
	entityType: z.string(),
	entityId: z.uuid(),
	readAt: z.iso.datetime({ offset: true }).nullable(),
	createdAt: z.iso.datetime({ offset: true }),
});
export const notificationListInputSchema = z.object({
	limit: z.number().int().min(1).max(100).default(20),
});
export const notificationListResultSchema = z.object({
	items: z.array(notificationSchema),
	unreadCount: z.number().int().nonnegative(),
});
export const markNotificationReadInputSchema = z.object({ id: z.uuid() });
export const markNotificationsReadResultSchema = z.object({
	count: z.number().int().nonnegative(),
});
export type NotificationListInput = z.infer<typeof notificationListInputSchema>;
export type NotificationListResult = z.infer<
	typeof notificationListResultSchema
>;
