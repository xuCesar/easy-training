import {
	ClassroomRepositoryError,
	createClassroomRecord,
	listClassroomRecords,
	setClassroomActiveRecord,
	updateClassroomRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	Classroom,
	ClassroomListInput,
	ClassroomListResult,
	CreateClassroomInput,
	SetClassroomActiveInput,
	UpdateClassroomInput,
} from "../contracts/training";

type ClassroomScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listClassroomRecords>[0]["campusAccess"];
};

function toClassroom(
	record: Awaited<ReturnType<typeof createClassroomRecord>>,
): Classroom {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function throwClassroomError(error: unknown): never {
	if (!(error instanceof ClassroomRepositoryError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理教室数据，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权管理该校区教室。",
			});
		case "CAMPUS_NOT_FOUND":
		case "CLASSROOM_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标教室不存在。" });
		case "INVALID_INPUT":
			throw new ORPCError("BAD_REQUEST", {
				message: "降低容量会使部分未来课次超出教室容量。",
				data: toErrorData(error.details),
			});
		case "CLASSROOM_DUPLICATE":
			throw new ORPCError("CONFLICT", { message: "该校区已存在同名教室。" });
		case "CLASSROOM_HAS_FUTURE_LESSONS":
			throw new ORPCError("CONFLICT", {
				message: "该教室仍有未来待上课次，请先调课或取消相关课次。",
				data: toErrorData(error.details),
			});
		case "CLASSROOM_INACTIVE":
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", { message: "校区或教室已停用。" });
	}
}

function toErrorData(details: ClassroomRepositoryError["details"]) {
	return details?.affectedLessons
		? {
				affectedLessons: details.affectedLessons.map((item) => ({
					...item,
					startsAt: item.startsAt.toISOString(),
				})),
			}
		: undefined;
}

export async function listClassrooms(
	scope: ClassroomScope,
	input: ClassroomListInput,
): Promise<ClassroomListResult> {
	return {
		items: (
			await listClassroomRecords({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess,
				...input,
			})
		).map(toClassroom),
	};
}

export async function createClassroom(
	scope: ClassroomScope,
	input: CreateClassroomInput,
) {
	try {
		return toClassroom(
			await createClassroomRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwClassroomError(error);
	}
}

export async function updateClassroom(
	scope: ClassroomScope,
	input: UpdateClassroomInput,
) {
	try {
		return toClassroom(
			await updateClassroomRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				id: input.id,
				...input.data,
			}),
		);
	} catch (error) {
		return throwClassroomError(error);
	}
}

export async function setClassroomActive(
	scope: ClassroomScope,
	input: SetClassroomActiveInput,
) {
	try {
		return toClassroom(
			await setClassroomActiveRecord({
				organizationId: scope.organizationId,
				userId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwClassroomError(error);
	}
}
