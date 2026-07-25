import {
	bulkUpdateLessonsRecord,
	createScheduleRuleRecord,
	deactivateScheduleRuleRecord,
	deleteScheduleRuleRecord,
	generateScheduleLessonsRecord,
	listScheduleRuleRecords,
	previewBulkLessonUpdateRecord,
	previewScheduleGenerationRecord,
	previewScheduleRuleDeactivationRecord,
	previewScheduleRuleUpdateRecord,
	updateScheduleRuleRecord,
} from "@easy-training/db";

import type {
	BulkUpdateLessonsInput,
	CreateScheduleRuleInput,
	DeactivateScheduleRuleInput,
	DeleteScheduleRuleInput,
	GenerateScheduleLessonsInput,
	PreviewBulkLessonUpdateInput,
	PreviewScheduleGenerationInput,
	PreviewScheduleRuleDeactivationInput,
	PreviewScheduleRuleUpdateInput,
	ScheduleRuleListInput,
	UpdateScheduleRuleInput,
} from "../contracts/training";

import {
	type TeachingScope,
	throwTeachingError,
	toScheduleRule,
} from "./teaching-support";

export async function listScheduleRules(
	scope: TeachingScope,
	input: ScheduleRuleListInput,
) {
	return {
		items: (
			await listScheduleRuleRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				...input,
			})
		).map(toScheduleRule),
	};
}

export async function createScheduleRule(
	scope: TeachingScope,
	input: CreateScheduleRuleInput,
) {
	try {
		return toScheduleRule(
			await createScheduleRuleRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function previewScheduleGeneration(
	scope: TeachingScope,
	input: PreviewScheduleGenerationInput,
) {
	try {
		const result = await previewScheduleGenerationRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
			overrides: input.overrides.map((item) => ({
				...item,
				startsAt: new Date(item.startsAt),
			})),
		});
		return {
			rule: toScheduleRule(result.rule),
			candidates: result.candidates.map((item) => ({
				...item,
				baselineStartsAt: item.baselineStartsAt.toISOString(),
				startsAt: item.startsAt.toISOString(),
				endsAt: item.endsAt.toISOString(),
			})),
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function generateScheduleLessons(
	scope: TeachingScope,
	input: GenerateScheduleLessonsInput,
) {
	try {
		return await generateScheduleLessonsRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
			candidates: input.candidates.map((item) => ({
				...item,
				startsAt: new Date(item.startsAt),
			})),
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function previewScheduleRuleDeactivation(
	scope: TeachingScope,
	input: PreviewScheduleRuleDeactivationInput,
) {
	try {
		return await previewScheduleRuleDeactivationRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function deactivateScheduleRule(
	scope: TeachingScope,
	input: DeactivateScheduleRuleInput,
) {
	try {
		return await deactivateScheduleRuleRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function deleteScheduleRule(
	scope: TeachingScope,
	input: DeleteScheduleRuleInput,
) {
	try {
		return await deleteScheduleRuleRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}

export function toScheduleRuleUpdateItem(
	item: Awaited<
		ReturnType<typeof previewScheduleRuleUpdateRecord>
	>["items"][number],
) {
	return {
		...item,
		current: {
			...item.current,
			startsAt: item.current.startsAt.toISOString(),
			endsAt: item.current.endsAt.toISOString(),
		},
		proposed: {
			...item.proposed,
			startsAt: item.proposed.startsAt.toISOString(),
			endsAt: item.proposed.endsAt.toISOString(),
		},
	};
}

export async function previewScheduleRuleUpdate(
	scope: TeachingScope,
	input: PreviewScheduleRuleUpdateInput,
) {
	try {
		const result = await previewScheduleRuleUpdateRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { ...result, items: result.items.map(toScheduleRuleUpdateItem) };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function updateScheduleRule(
	scope: TeachingScope,
	input: UpdateScheduleRuleInput,
) {
	try {
		return await updateScheduleRuleRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}

export function toBulkLessonUpdateInput(
	input: PreviewBulkLessonUpdateInput["items"],
) {
	return input.map((item) => ({ ...item, startsAt: new Date(item.startsAt) }));
}

export function toBulkLessonUpdateItem(
	item: Awaited<
		ReturnType<typeof previewBulkLessonUpdateRecord>
	>["items"][number],
) {
	return {
		...item,
		current: {
			...item.current,
			startsAt: item.current.startsAt.toISOString(),
			endsAt: item.current.endsAt.toISOString(),
		},
		proposed: {
			...item.proposed,
			startsAt: item.proposed.startsAt.toISOString(),
			endsAt: item.proposed.endsAt.toISOString(),
		},
	};
}

export async function previewBulkLessonUpdate(
	scope: TeachingScope,
	input: PreviewBulkLessonUpdateInput,
) {
	try {
		const result = await previewBulkLessonUpdateRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			items: toBulkLessonUpdateInput(input.items),
		});
		return { items: result.items.map(toBulkLessonUpdateItem) };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function bulkUpdateLessons(
	scope: TeachingScope,
	input: BulkUpdateLessonsInput,
) {
	try {
		return await bulkUpdateLessonsRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			requestId: input.requestId,
			items: toBulkLessonUpdateInput(input.items),
		});
	} catch (error) {
		return throwTeachingError(error);
	}
}
