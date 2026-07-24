import {
	markNotificationReadInputSchema,
	markNotificationsReadResultSchema,
	notificationListInputSchema,
	notificationListResultSchema,
} from "../../contracts/training";
import { organizationProcedure } from "../../index";
import {
	getNotifications,
	readAllNotifications,
	readNotification,
} from "../../repositories/operations";

export const notificationsRouter = {
	list: organizationProcedure
		.input(notificationListInputSchema)
		.output(notificationListResultSchema)
		.handler(({ context, input }) =>
			getNotifications(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	read: organizationProcedure
		.input(markNotificationReadInputSchema)
		.output(markNotificationsReadResultSchema)
		.handler(async ({ context, input }) => {
			await readNotification(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input.id,
			);
			return { count: 1 };
		}),
	readAll: organizationProcedure
		.output(markNotificationsReadResultSchema)
		.handler(({ context }) =>
			readAllNotifications({
				organizationId: context.organization.id,
				userId: context.session.user.id,
				campusAccess: context.campusAccess,
			}),
		),
};
