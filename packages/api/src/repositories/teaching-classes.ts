import {
	assignEnrollmentClassLegacyRecord,
	createClassGroupRecord,
	listClassEnrollmentRecords,
	listClassGroupRecords,
	pauseClassGroupRecord,
	resumeClassGroupRecord,
	updateClassGroupRecord,
} from "@easy-training/db";

import type {
	AssignEnrollmentClassInput,
	ClassEnrollmentListInput,
	ClassGroupListInput,
	CreateClassGroupInput,
	PauseClassGroupInput,
	ResumeClassGroupInput,
	UpdateClassGroupInput,
} from "../contracts/training";

import {
	appendTarget,
	encodeClassGroupCursor,
	type TeachingScope,
	throwTargetNotFound,
	throwTeachingError,
	toClassGroup,
} from "./teaching-support";

export async function listClassGroups(
	scope: TeachingScope,
	input: ClassGroupListInput,
) {
	const { targetId, ...filters } = input;
	const baseInput = {
		organizationId: scope.organizationId,
		campusAccess: scope.campusAccess,
	};
	const [records, targetRecords] = await Promise.all([
		listClassGroupRecords({ ...baseInput, ...filters }),
		targetId
			? listClassGroupRecords({ ...baseInput, targetId })
			: Promise.resolve([]),
	]);
	if (targetId && !targetRecords[0]) throwTargetNotFound();
	const page = records.slice(0, input.pageSize);
	const last = page.at(-1);
	return {
		items: appendTarget(
			page,
			filters.cursor ? undefined : targetRecords[0],
		).map(toClassGroup),
		nextCursor:
			records.length > input.pageSize && last
				? encodeClassGroupCursor(last)
				: null,
	};
}
export async function createClassGroup(
	scope: TeachingScope,
	input: CreateClassGroupInput,
) {
	try {
		return toClassGroup(
			await createClassGroupRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateClassGroup(
	scope: TeachingScope,
	input: UpdateClassGroupInput,
) {
	try {
		return toClassGroup(
			await updateClassGroupRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				...input.data,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function pauseClassGroup(
	scope: TeachingScope,
	input: PauseClassGroupInput,
) {
	try {
		const result = await pauseClassGroupRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { ...result, classGroup: toClassGroup(result.classGroup) };
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function resumeClassGroup(
	scope: TeachingScope,
	input: ResumeClassGroupInput,
) {
	try {
		const result = await resumeClassGroupRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { ...result, classGroup: toClassGroup(result.classGroup) };
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listClassEnrollments(
	scope: TeachingScope,
	input: ClassEnrollmentListInput,
) {
	try {
		return {
			items: await listClassEnrollmentRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				classGroupId: input.id,
			}),
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function assignEnrollmentClass(
	scope: TeachingScope,
	input: AssignEnrollmentClassInput,
) {
	try {
		await assignEnrollmentClassLegacyRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { enrollmentId: input.enrollmentId };
	} catch (error) {
		return throwTeachingError(error);
	}
}
