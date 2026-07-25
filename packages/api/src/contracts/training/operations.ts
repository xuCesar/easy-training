import { z } from "zod";

import { organizationRoleSchema } from "./organization";

const operationTaskModuleSchema = z.enum([
	"enrollment",
	"academic",
	"finance",
	"student_service",
]);
const operationTaskPrioritySchema = z.enum(["high", "medium", "low"]);
const operationTaskStatusSchema = z.enum(["pending", "completed", "cancelled"]);
const operationTaskSchema = z.object({
	id: z.uuid(),
	organizationId: z.uuid(),
	campusId: z.uuid().nullable(),
	createdByUserId: z.string().nullable(),
	ownerUserId: z.string().nullable(),
	title: z.string(),
	description: z.string().nullable(),
	module: operationTaskModuleSchema,
	priority: operationTaskPrioritySchema,
	dueAt: z.iso.datetime({ offset: true }),
	remindBeforeMinutes: z.number().int().nullable(),
	status: operationTaskStatusSchema,
	version: z.number().int().positive(),
	completedAt: z.iso.datetime({ offset: true }).nullable(),
	completedByUserId: z.string().nullable(),
	cancelledAt: z.iso.datetime({ offset: true }).nullable(),
	cancelledByUserId: z.string().nullable(),
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
});
const operationTaskListItemSchema = operationTaskSchema.extend({
	ownerName: z.string().nullable(),
});

export const createOperationTaskInputSchema = z.object({
	campusId: z.uuid().nullable().default(null),
	ownerUserId: z.string().min(1).max(255).nullable().optional(),
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().max(4_000).nullable().default(null),
	module: operationTaskModuleSchema,
	priority: operationTaskPrioritySchema.default("medium"),
	dueAt: z.iso.datetime({ offset: true }),
	remindBeforeMinutes: z
		.number()
		.int()
		.min(5)
		.max(10_080)
		.nullable()
		.default(null),
});
export const operationTaskListInputSchema = z.object({
	view: z.enum(["mine", "created", "public", "managed"]).default("mine"),
	status: operationTaskStatusSchema.optional(),
	campusId: z.uuid().optional(),
	module: operationTaskModuleSchema.optional(),
	dueAtFrom: z.iso.datetime({ offset: true }).optional(),
	dueAtTo: z.iso.datetime({ offset: true }).optional(),
	keyword: z.string().trim().min(1).max(100).optional(),
	cursor: z.string().min(1).max(512).optional(),
	limit: z.number().int().min(1).max(100).default(30),
});
export const operationTaskListResultSchema = z.object({
	items: z.array(operationTaskListItemSchema),
	nextCursor: z.string().nullable(),
});
export const operationTaskAssigneeListInputSchema = z.object({
	campusId: z.uuid().nullable().default(null),
	module: operationTaskModuleSchema,
});
export const operationTaskAssigneeListResultSchema = z.object({
	items: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			role: organizationRoleSchema,
		}),
	),
});
export const operationTaskActionInputSchema = z.object({
	id: z.uuid(),
	expectedVersion: z.number().int().positive(),
});
export const updateOperationTaskInputSchema =
	operationTaskActionInputSchema.extend({
		data: z
			.object({
				campusId: z.uuid().nullable(),
				ownerUserId: z.string().min(1).max(255).nullable(),
				title: z.string().trim().min(1).max(200),
				description: z.string().trim().max(4_000).nullable(),
				module: operationTaskModuleSchema,
				priority: operationTaskPrioritySchema,
				dueAt: z.iso.datetime({ offset: true }),
				remindBeforeMinutes: z.number().int().min(5).max(10_080).nullable(),
			})
			.partial()
			.refine((value) => Object.keys(value).length > 0, {
				message: "至少提供一个待更新字段。",
			}),
	});
export const operationTaskMutationResultSchema = operationTaskSchema;
export type OperationTask = z.infer<typeof operationTaskSchema>;
export type OperationTaskListItem = z.infer<typeof operationTaskListItemSchema>;
export type CreateOperationTaskInput = z.infer<
	typeof createOperationTaskInputSchema
>;
export type OperationTaskListInput = z.infer<
	typeof operationTaskListInputSchema
>;
export type OperationTaskAssigneeListInput = z.infer<
	typeof operationTaskAssigneeListInputSchema
>;
export type OperationTaskActionInput = z.infer<
	typeof operationTaskActionInputSchema
>;
export type UpdateOperationTaskInput = z.infer<
	typeof updateOperationTaskInputSchema
>;
