import {
	cancelLessonRecord,
	cancelMakeupLessonRecord,
	completeLessonRecord,
	createLessonRecord,
	createMakeupLessonRecord,
	getLessonAttendanceRecord,
	getTeacherLessonAttendanceRecord,
	getTeacherWorkspaceRecord,
	listLessonRecords,
	listMakeupLessonRecords,
	saveLessonAttendanceDraftRecord,
} from "@easy-training/db";

import type {
	CancelLessonInput,
	CancelMakeupLessonInput,
	CompleteLessonInput,
	CreateLessonInput,
	CreateMakeupLessonInput,
	LessonAttendanceInput,
	LessonListInput,
	MakeupLessonListInput,
	SaveLessonAttendanceDraftInput,
	TeacherWorkspaceInput,
} from "../contracts/training";

import {
	appendTarget,
	encodeLessonCursor,
	type TeachingScope,
	throwTargetNotFound,
	throwTeachingError,
	toLesson,
	toMakeupLesson,
} from "./teaching-support";

export async function listLessons(
	scope: TeachingScope,
	input: LessonListInput,
) {
	const { targetId, ...filters } = input;
	const baseInput = {
		organizationId: scope.organizationId,
		campusAccess: scope.campusAccess,
	};
	const [records, targetRecords] = await Promise.all([
		listLessonRecords({
			...baseInput,
			campusId: filters.campusId,
			classGroupId: filters.classGroupId,
			from: filters.from ? new Date(filters.from) : undefined,
			to: filters.to ? new Date(filters.to) : undefined,
			cursor: filters.cursor,
			pageSize: filters.pageSize,
		}),
		targetId
			? listLessonRecords({ ...baseInput, targetId })
			: Promise.resolve([]),
	]);
	if (targetId && !targetRecords[0]) throwTargetNotFound();
	const page = records.slice(0, input.pageSize);
	const last = page.at(-1);
	return {
		items: appendTarget(
			page,
			filters.cursor ? undefined : targetRecords[0],
		).map(toLesson),
		nextCursor:
			records.length > input.pageSize && last ? encodeLessonCursor(last) : null,
	};
}
export async function createLesson(
	scope: TeachingScope,
	input: CreateLessonInput,
) {
	try {
		return toLesson(
			await createLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				classGroupId: input.classGroupId,
				roomId: input.roomId,
				room: input.room,
				startsAt: new Date(input.startsAt),
				endsAt: new Date(input.endsAt),
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function listMakeupLessons(
	scope: TeachingScope,
	input: MakeupLessonListInput,
) {
	try {
		return {
			items: (
				await listMakeupLessonRecords({
					organizationId: scope.organizationId,
					campusAccess: scope.campusAccess,
					...input,
				})
			).map(toMakeupLesson),
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function createMakeupLesson(
	scope: TeachingScope,
	input: CreateMakeupLessonInput,
) {
	try {
		const result = await createMakeupLessonRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { ...result, makeupLesson: toMakeupLesson(result.makeupLesson) };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function cancelMakeupLesson(
	scope: TeachingScope,
	input: CancelMakeupLessonInput,
) {
	try {
		const result = await cancelMakeupLessonRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { ...result, makeupLesson: toMakeupLesson(result.makeupLesson) };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function getLessonAttendance(
	scope: TeachingScope,
	input: LessonAttendanceInput,
) {
	try {
		const record = await getLessonAttendanceRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			id: input.id,
		});
		return {
			lesson: toLesson(record.lesson),
			members: record.members,
		};
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function getTeacherWorkspace(
	scope: TeachingScope,
	input: TeacherWorkspaceInput,
) {
	try {
		const record = await getTeacherWorkspaceRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			from: new Date(input.from),
			to: new Date(input.to),
			targetId: input.targetId,
		});
		return { teacher: record.teacher, lessons: record.lessons.map(toLesson) };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function getTeacherLessonAttendance(
	scope: TeachingScope,
	input: LessonAttendanceInput,
) {
	try {
		const record = await getTeacherLessonAttendanceRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			id: input.id,
		});
		return { lesson: toLesson(record.lesson), members: record.members };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function saveLessonAttendanceDraft(
	scope: TeachingScope,
	input: SaveLessonAttendanceDraftInput,
) {
	try {
		const record = await saveLessonAttendanceDraftRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			...input,
		});
		return { lesson: toLesson(record.lesson), members: record.members };
	} catch (error) {
		return throwTeachingError(error);
	}
}

export async function completeLesson(
	scope: TeachingScope,
	input: CompleteLessonInput,
) {
	try {
		return toLesson(
			await completeLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
export async function cancelLesson(
	scope: TeachingScope,
	input: CancelLessonInput,
) {
	try {
		return toLesson(
			await cancelLessonRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				reason: input.reason,
			}),
		);
	} catch (error) {
		return throwTeachingError(error);
	}
}
