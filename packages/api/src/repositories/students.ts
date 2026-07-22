import {
	commitEnrollmentBulkOperationRecord,
	commitStudentBulkOperationRecord,
	confirmStudentImportRecord,
	createStudentRecord,
	createStudentTagRecord,
	EnrollmentBulkOperationError,
	exportStudentRecords,
	findDuplicateStudentCandidates,
	getStudentRecord,
	listStudentActiveEnrollmentOptionsRecord,
	listStudentOwnerCandidateRecords,
	listStudentRecords,
	listStudentTagRecords,
	listStudentTimelineRecords,
	previewEnrollmentBulkOperationRecord,
	previewStudentBulkOperationRecord,
	previewStudentImportRecord,
	renameStudentTagRecord,
	STUDENT_IMPORT_TEMPLATE,
	StudentBulkOperationError,
	StudentImportExportError,
	StudentRepositoryError,
	setStudentTagActiveRecord,
	updateStudentRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	CommitEnrollmentBulkOperationInput,
	CommitEnrollmentBulkOperationResult,
	CommitStudentBulkOperationInput,
	CommitStudentBulkOperationResult,
	ConfirmStudentImportInput,
	ConfirmStudentImportResult,
	CreateStudentInput,
	CreateStudentTagInput,
	DuplicateStudentCandidatesInput,
	DuplicateStudentCandidatesResult,
	ExportStudentsInput,
	ExportStudentsResult,
	PreviewEnrollmentBulkOperationInput,
	PreviewEnrollmentBulkOperationResult,
	PreviewStudentBulkOperationInput,
	PreviewStudentBulkOperationResult,
	PreviewStudentImportInput,
	PreviewStudentImportResult,
	SetStudentTagActiveInput,
	StudentActiveEnrollmentOptionsInput,
	StudentActiveEnrollmentOptionsResult,
	StudentDetail,
	StudentListInput,
	StudentListResult,
	StudentOwnerCandidateListInput,
	StudentOwnerCandidateListResult,
	StudentStatus,
	StudentTag,
	StudentTagListInput,
	StudentTagListResult,
	StudentTimelineInput,
	StudentTimelineResult,
	UpdateStudentInput,
	UpdateStudentTagInput,
} from "../contracts/training";
import { quoteCsv } from "./csv";

type StudentScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listStudentRecords>[0]["campusAccess"];
};

type StudentTimelineScope = StudentScope & {
	role:
		| "owner"
		| "admin"
		| "campus_manager"
		| "consultant"
		| "teacher"
		| "finance";
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
		case "STUDENT_OWNER_NOT_ELIGIBLE":
			throw new ORPCError("BAD_REQUEST", {
				message: "所选负责人已不属于该学员校区或角色不可用。",
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

function throwStudentImportExportError(error: unknown): never {
	if (!(error instanceof StudentImportExportError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理学员导入或导出，请稍后重试。",
		});
	}
	switch (error.code) {
		case "IMPORT_INVALID_CSV":
			throw new ORPCError("BAD_REQUEST", { message: "CSV 模板或内容无效。" });
		case "IMPORT_LIMIT_EXCEEDED":
			throw new ORPCError("BAD_REQUEST", {
				message: "CSV 文件或行数超过导入限制。",
			});
		case "IMPORT_IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "同一导入请求不能用于不同内容。",
			});
		case "MEMBER_FORBIDDEN":
		case "CAMPUS_OUT_OF_SCOPE":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权导入、导出或访问目标校区。",
			});
	}
}

function throwStudentBulkOperationError(error: unknown): never {
	if (!(error instanceof StudentBulkOperationError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理学员批量操作，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权执行学员批量调整。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "同一批量请求不能用于不同操作。",
			});
		case "BULK_BLOCKED":
			throw new ORPCError("CONFLICT", {
				message: "部分学员状态、权限或版本已变化，本批操作未执行。",
				data: { reason: "STUDENT_BULK_BLOCKED", items: error.items },
			});
	}
}

function throwEnrollmentBulkOperationError(error: unknown): never {
	if (!(error instanceof EnrollmentBulkOperationError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法处理报名班级批量操作，请稍后重试。",
		});
	}
	switch (error.code) {
		case "MEMBER_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", {
				message: "当前账号无权执行报名班级批量调整。",
			});
		case "IDEMPOTENCY_CONFLICT":
			throw new ORPCError("CONFLICT", {
				message: "同一批量请求不能用于不同操作。",
			});
		case "BULK_BLOCKED":
			throw new ORPCError("CONFLICT", {
				message: "部分报名状态、权限或容量已变化，本批操作未执行。",
				data: { reason: "ENROLLMENT_BULK_BLOCKED", items: error.items },
			});
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
			ownerUserId:
				input.ownerUserId === "unassigned" ? null : input.ownerUserId,
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

export async function listStudentOwnerCandidates(
	scope: StudentScope,
	input: StudentOwnerCandidateListInput,
): Promise<StudentOwnerCandidateListResult> {
	try {
		return {
			items: await listStudentOwnerCandidateRecords({ ...scope, ...input }),
		};
	} catch (error) {
		return throwStudentError(error);
	}
}

export async function getStudentTimeline(
	scope: StudentTimelineScope,
	input: StudentTimelineInput,
): Promise<StudentTimelineResult> {
	try {
		const result = await listStudentTimelineRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			studentId: input.studentId,
			includeFinancial:
				scope.role === "owner" ||
				scope.role === "admin" ||
				scope.role === "campus_manager",
			cursor: input.cursor,
			pageSize: input.pageSize,
		});
		return {
			items: result.items.map((item) => ({
				id: item.id,
				kind: item.kind,
				occurredAt: item.occurredAt.toISOString(),
				recordedAt: item.recordedAt?.toISOString() ?? null,
				actorName: item.actorName,
				courseName: item.courseName,
				className: item.className,
				invoiceSummary: item.invoiceSummary,
				invoiceSource: item.invoiceSource,
				amountInCents: item.amountInCents,
				lessonCount: item.lessonCount,
				previousRemainingLessons: item.previousRemainingLessons,
				remainingLessons: item.remainingLessons,
				status: item.status,
				beforeStatus: item.beforeStatus,
				afterStatus: item.afterStatus,
				source: item.invoiceId
					? { type: "invoice" as const, invoiceId: item.invoiceId }
					: item.lessonId
						? { type: "lesson" as const, lessonId: item.lessonId }
						: { type: "none" as const },
			})),
			nextCursor: result.nextCursor,
		};
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
				expectedVersion: input.expectedVersion,
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

export function getStudentImportTemplate() {
	return {
		fileName: "学员导入模板.csv",
		csv: `\uFEFF${STUDENT_IMPORT_TEMPLATE}`,
	};
}

export async function previewStudentImport(
	scope: StudentScope,
	input: PreviewStudentImportInput,
): Promise<PreviewStudentImportResult> {
	try {
		return await previewStudentImportRecord({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			content: input.content,
		});
	} catch (error) {
		return throwStudentImportExportError(error);
	}
}

export async function confirmStudentImport(
	scope: StudentScope,
	input: ConfirmStudentImportInput,
): Promise<ConfirmStudentImportResult> {
	try {
		return await confirmStudentImportRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			requestId: input.requestId,
			content: input.content,
		});
	} catch (error) {
		return throwStudentImportExportError(error);
	}
}

export async function exportStudents(
	scope: StudentScope,
	input: ExportStudentsInput,
): Promise<ExportStudentsResult> {
	try {
		const rows = await exportStudentRecords({
			organizationId: scope.organizationId,
			userId: scope.userId,
			query: input.query,
			campusId: input.campusId,
			status:
				input.status === "all" ? undefined : toDatabaseStatus(input.status),
			tagId: input.tagId,
			ownerUserId:
				input.ownerUserId === "unassigned"
					? null
					: input.ownerUserId || undefined,
			limit: input.limit,
		});
		const lines = [
			[
				"学员ID",
				"姓名",
				"校区编码",
				"校区名称",
				"出生日期",
				"状态",
				"负责人姓名",
				"负责人邮箱",
				"主要联系人姓名",
				"主要联系人手机号",
				"标签",
				"创建时间",
				"更新时间",
			].join(","),
			...rows.map((row) =>
				[
					quoteCsv(row.id),
					quoteCsv(row.name),
					quoteCsv(row.campusCode),
					quoteCsv(row.campusName),
					quoteCsv(row.birthDate),
					quoteCsv(toStudentStatus(row.status)),
					quoteCsv(row.ownerName),
					quoteCsv(row.ownerEmail),
					quoteCsv(row.primaryContactName),
					quoteCsv(row.primaryContactPhone),
					quoteCsv(row.tagNames.join("|")),
					quoteCsv(row.createdAt.toISOString()),
					quoteCsv(row.updatedAt.toISOString()),
				].join(","),
			),
		];
		return {
			fileName: `学员档案-${new Date().toISOString().slice(0, 10)}.csv`,
			csv: `\uFEFF${lines.join("\n")}`,
		};
	} catch (error) {
		return throwStudentImportExportError(error);
	}
}

export async function previewStudentBulkOperation(
	scope: StudentScope,
	input: PreviewStudentBulkOperationInput,
): Promise<PreviewStudentBulkOperationResult> {
	try {
		return await previewStudentBulkOperationRecord({
			...input,
			organizationId: scope.organizationId,
			userId: scope.userId,
		});
	} catch (error) {
		return throwStudentBulkOperationError(error);
	}
}

export async function commitStudentBulkOperation(
	scope: StudentScope,
	input: CommitStudentBulkOperationInput,
): Promise<CommitStudentBulkOperationResult> {
	try {
		return await commitStudentBulkOperationRecord({
			...input,
			organizationId: scope.organizationId,
			userId: scope.userId,
		});
	} catch (error) {
		return throwStudentBulkOperationError(error);
	}
}

export async function getStudentActiveEnrollmentOptions(
	scope: StudentScope,
	input: StudentActiveEnrollmentOptionsInput,
): Promise<StudentActiveEnrollmentOptionsResult> {
	try {
		const items = await listStudentActiveEnrollmentOptionsRecord({
			organizationId: scope.organizationId,
			userId: scope.userId,
			studentIds: input.studentIds,
		});
		return { items };
	} catch (error) {
		return throwEnrollmentBulkOperationError(error);
	}
}

export async function previewEnrollmentBulkOperation(
	scope: StudentScope,
	input: PreviewEnrollmentBulkOperationInput,
): Promise<PreviewEnrollmentBulkOperationResult> {
	try {
		return await previewEnrollmentBulkOperationRecord({
			...input,
			organizationId: scope.organizationId,
			userId: scope.userId,
		});
	} catch (error) {
		return throwEnrollmentBulkOperationError(error);
	}
}

export async function commitEnrollmentBulkOperation(
	scope: StudentScope,
	input: CommitEnrollmentBulkOperationInput,
): Promise<CommitEnrollmentBulkOperationResult> {
	try {
		return await commitEnrollmentBulkOperationRecord({
			...input,
			organizationId: scope.organizationId,
			userId: scope.userId,
		});
	} catch (error) {
		return throwEnrollmentBulkOperationError(error);
	}
}
