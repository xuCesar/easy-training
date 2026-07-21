import {
	createStudentRecord,
	createStudentTagRecord,
	findDuplicateStudentCandidates,
	getStudentRecord,
	listStudentRecords,
	listStudentTagRecords,
	renameStudentTagRecord,
	StudentRepositoryError,
	setStudentTagActiveRecord,
	updateStudentRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CreateStudentInput,
	CreateStudentTagInput,
	DuplicateStudentCandidatesInput,
	DuplicateStudentCandidatesResult,
	SetStudentTagActiveInput,
	StudentDetail,
	StudentListInput,
	StudentListResult,
	StudentStatus,
	StudentTag,
	StudentTagListInput,
	StudentTagListResult,
	UpdateStudentInput,
	UpdateStudentTagInput,
} from "../contracts/training";

type StudentScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listStudentRecords>[0]["campusAccess"];
};

function toStudentStatus(
	status: "active" | "trial" | "paused" | "graduated" | "at_risk",
): StudentStatus {
	return status === "at_risk" ? "atRisk" : status;
}

function toDatabaseStatus(status: StudentStatus) {
	return status === "atRisk" ? "at_risk" : status;
}

function toTag(record: {
	id: string;
	name: string;
	isActive: boolean;
}): StudentTag {
	return record;
}

function toSummary(
	record: Awaited<ReturnType<typeof listStudentRecords>>["items"][number],
) {
	return {
		...record,
		status: toStudentStatus(record.status),
		tags: record.tags.map(toTag),
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function toDetail(
	record: Awaited<ReturnType<typeof getStudentRecord>>,
): StudentDetail {
	return {
		...toSummary(record),
		birthDate: record.birthDate,
		contacts: record.contacts,
	};
}

function throwStudentError(error: unknown): never {
	if (!(error instanceof StudentRepositoryError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理学员档案，请稍后重试。",
		});
	}

	switch (error.code) {
		case "STUDENT_NOT_FOUND":
		case "STUDENT_TAG_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标资源不存在。" });
		case "MEMBER_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权访问学员档案。",
			});
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权访问该校区。" });
		case "CAMPUS_INACTIVE":
			throw new ORPCError("CONFLICT", {
				message: "校区已停用，不能继续写入。",
			});
		case "STUDENT_VERSION_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "该学员档案已被其他人更新，请刷新最新资料后重试。",
				data: { reason: "STUDENT_VERSION_CONFLICT" },
			});
		case "STUDENT_MERGED":
			throw new ORPCError("CONFLICT", {
				message: "该学员已合并到主档案，不能再编辑。",
			});
		case "CONTACT_INVARIANT":
			throw new ORPCError("BAD_REQUEST", {
				message: "请且仅保留一位主要联系人。",
			});
		case "INVALID_TAGS":
			throw new ORPCError("BAD_REQUEST", {
				message: "标签列表无效或包含重复项。",
			});
		case "STUDENT_TAG_DUPLICATE":
			throw new ORPCError("CONFLICT", { message: "机构内已存在同名标签。" });
		case "INVALID_CURSOR":
			throw new ORPCError("BAD_REQUEST", { message: "分页游标无效。" });
		case "CAMPUS_NOT_FOUND":
			throw new ORPCError("BAD_REQUEST", { message: "校区不可用。" });
	}
}

export async function listStudents(
	scope: StudentScope,
	input: StudentListInput,
): Promise<StudentListResult> {
	try {
		const result = await listStudentRecords({
			...scope,
			...input,
			status:
				input.status === "all" ? undefined : toDatabaseStatus(input.status),
		});
		return {
			items: result.items.map(toSummary),
			total: result.total,
			nextCursor: result.nextCursor,
		};
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function getDuplicateStudentCandidates(
	scope: StudentScope,
	input: DuplicateStudentCandidatesInput,
): Promise<DuplicateStudentCandidatesResult> {
	try {
		return {
			items: (await findDuplicateStudentCandidates({ ...scope, ...input })).map(
				(item) => ({
					...item,
					status: toStudentStatus(item.status),
				}),
			),
		};
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function getStudent(
	scope: StudentScope,
	id: string,
): Promise<StudentDetail> {
	try {
		return toDetail(await getStudentRecord({ ...scope, id }));
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function createStudent(
	scope: StudentScope,
	input: CreateStudentInput,
): Promise<StudentDetail> {
	try {
		return toDetail(
			await createStudentRecord({
				...scope,
				...input,
				status: toDatabaseStatus(input.status),
			}),
		);
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function updateStudent(
	scope: StudentScope,
	input: UpdateStudentInput,
): Promise<StudentDetail> {
	try {
		return toDetail(
			await updateStudentRecord({
				...scope,
				id: input.id,
				expectedUpdatedAt: new Date(input.expectedUpdatedAt),
				data: { ...input.data, status: toDatabaseStatus(input.data.status) },
			}),
		);
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function listStudentTags(
	scope: StudentScope,
	input: StudentTagListInput,
): Promise<StudentTagListResult> {
	try {
		const result = await listStudentTagRecords({ ...scope, ...input });
		return { items: result.items.map(toTag) };
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function createStudentTag(
	scope: StudentScope,
	input: CreateStudentTagInput,
): Promise<StudentTag> {
	try {
		return toTag(await createStudentTagRecord({ ...scope, ...input }));
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function updateStudentTag(
	scope: StudentScope,
	input: UpdateStudentTagInput,
): Promise<StudentTag> {
	try {
		return toTag(await renameStudentTagRecord({ ...scope, ...input }));
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function setStudentTagActive(
	scope: StudentScope,
	input: SetStudentTagActiveInput,
): Promise<StudentTag> {
	try {
		return toTag(await setStudentTagActiveRecord({ ...scope, ...input }));
	} catch (error) {
		return throwStudentError(error);
	}
}
