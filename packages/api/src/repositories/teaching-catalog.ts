import {
	createCourseRecord,
	createTeacherRecord,
	listBindableTeacherMemberRecords,
	listCourseRecords,
	listTeacherRecords,
	setCourseActiveRecord,
	updateCourseRecord,
	updateTeacherRecord,
} from "@easy-training/db";

import type {
	CourseListInput,
	CreateCourseInput,
	CreateTeacherInput,
	SetCourseActiveInput,
	UpdateCourseInput,
	UpdateTeacherInput,
} from "../contracts/training";

import {
	appendTarget,
	type TeachingScope,
	throwTargetNotFound,
	throwTeachingError,
	toCourse,
	toTeacher,
} from "./teaching-support";

export async function listCourses(
	scope: TeachingScope,
	input: CourseListInput,
) {
	const { targetId, ...filters } = input;
	const [records, targetRecords] = await Promise.all([
		listCourseRecords({ organizationId: scope.organizationId, ...filters }),
		targetId
			? listCourseRecords({
					organizationId: scope.organizationId,
					includeInactive: true,
					targetId,
				})
			: Promise.resolve([]),
	]);
	if (targetId && !targetRecords[0]) throwTargetNotFound();
	return {
		items: appendTarget(records, targetRecords[0]).map(toCourse),
	};
}
export async function createCourse(
	scope: TeachingScope,
	input: CreateCourseInput,
) {
	try {
		return toCourse(
			await createCourseRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateCourse(
	scope: TeachingScope,
	input: UpdateCourseInput,
) {
	try {
		return toCourse(
			await updateCourseRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				data: input.data,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function setCourseActive(
	scope: TeachingScope,
	input: SetCourseActiveInput,
) {
	try {
		return toCourse(
			await setCourseActiveRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function listTeachers(scope: TeachingScope) {
	return { items: (await listTeacherRecords(scope)).map(toTeacher) };
}
export async function listBindableTeacherMembers(scope: TeachingScope) {
	return {
		items: await listBindableTeacherMemberRecords({
			organizationId: scope.organizationId,
		}),
	};
}
export async function createTeacher(
	scope: TeachingScope,
	input: CreateTeacherInput,
) {
	try {
		return toTeacher(
			await createTeacherRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function updateTeacher(
	scope: TeachingScope,
	input: UpdateTeacherInput,
) {
	try {
		return toTeacher(
			await updateTeacherRecord({
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
