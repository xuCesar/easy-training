import {
	claimInvitationRecord,
	createCampusRecord,
	createInvitationRecord,
	listCampusRecords,
	listInvitationRecords,
	listMemberRecords,
	OrganizationManagementError,
	previewMemberOwnerImpactRecord,
	removeMemberRecord,
	resendInvitationRecord,
	revokeInvitationRecord,
	setCampusActiveRecord,
	updateCampusRecord,
	updateMemberRecord,
} from "@easy-training/db";
import { ORPCError } from "@orpc/server";

import type {
	Campus,
	CampusListInput,
	CampusListResult,
	ClaimInvitationInput,
	ClaimInvitationResult,
	CreateCampusInput,
	CreateInvitationInput,
	CreateInvitationResult,
	InvitationListResult,
	MemberListResult,
	MemberOwnerImpactInput,
	MemberOwnerImpactResult,
	RemoveMemberInput,
	ResendInvitationInput,
	RevokeInvitationInput,
	SetCampusActiveInput,
	UpdateCampusInput,
	UpdateMemberInput,
} from "../contracts/training";

type OrganizationScope = {
	organizationId: string;
	userId: string;
	campusAccess: Parameters<typeof listCampusRecords>[0]["campusAccess"];
};

function toCampus(
	record: Awaited<ReturnType<typeof createCampusRecord>>,
): Campus {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function toOrganizationError(error: OrganizationManagementError): never {
	switch (error.code) {
		case "CAMPUS_NOT_FOUND":
		case "MEMBER_NOT_FOUND":
		case "INVITATION_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "目标资源不存在。" });
		case "CAMPUS_OUT_OF_SCOPE":
		case "MEMBER_FORBIDDEN":
			throw new ORPCError("FORBIDDEN", { message: "当前账号无权执行该操作。" });
		case "LAST_OWNER":
			throw new ORPCError("CONFLICT", {
				message: "机构必须至少保留一名负责人。",
			});
		case "TEACHER_BINDING_EXISTS":
			throw new ORPCError("CONFLICT", {
				message: "请先在教师档案中解绑账号，再变更角色或移除成员。",
			});
		case "INVALID_SCOPE":
			throw new ORPCError("BAD_REQUEST", {
				message: "校区范围包含无效的校区。",
			});
		case "INVITATION_EMAIL_MISMATCH":
			throw new ORPCError("FORBIDDEN", {
				message: "当前登录邮箱与邀请目标不一致。",
			});
		case "INVITATION_ALREADY_MEMBER":
			throw new ORPCError("CONFLICT", {
				message: "该账号已经是当前机构成员。",
			});
		case "INVITATION_REQUEST_REPLAY":
			throw new ORPCError("CONFLICT", {
				message: "该邀请请求已处理；请关闭后重新创建，或使用重发生成新链接。",
			});
		case "INVITATION_INVALID":
			throw new ORPCError("CONFLICT", {
				message: "邀请已失效、已撤销或已被领取。",
			});
	}
}

function throwRepositoryError(error: unknown): never {
	if (error instanceof OrganizationManagementError) {
		return toOrganizationError(error);
	}
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505"
	) {
		throw new ORPCError("CONFLICT", { message: "该编号或请求已存在。" });
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "暂时无法处理机构管理请求，请稍后重试。",
	});
}

export async function listCampuses(
	scope: OrganizationScope,
	input: CampusListInput,
): Promise<CampusListResult> {
	try {
		const items = await listCampusRecords({
			organizationId: scope.organizationId,
			campusAccess: scope.campusAccess,
			includeInactive: input.includeInactive,
		});
		return { items: items.map(toCampus) };
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function createCampus(
	scope: OrganizationScope,
	input: CreateCampusInput,
): Promise<Campus> {
	try {
		return toCampus(
			await createCampusRecord({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function updateCampus(
	scope: OrganizationScope,
	input: UpdateCampusInput,
): Promise<Campus> {
	try {
		return toCampus(
			await updateCampusRecord({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				id: input.id,
				data: input.data,
			}),
		);
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function setCampusActive(
	scope: OrganizationScope,
	input: SetCampusActiveInput,
): Promise<Campus> {
	try {
		return toCampus(
			await setCampusActiveRecord({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function listMembers(
	scope: OrganizationScope,
): Promise<MemberListResult> {
	try {
		const items = await listMemberRecords({
			organizationId: scope.organizationId,
		});
		return {
			items: items.map((item) => ({
				...item,
				createdAt: item.createdAt.toISOString(),
			})),
		};
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function updateMember(
	scope: OrganizationScope,
	input: UpdateMemberInput,
): Promise<void> {
	try {
		await updateMemberRecord({
			organizationId: scope.organizationId,
			actorUserId: scope.userId,
			memberId: input.memberId,
			role: input.role,
			campusAccessMode: input.campusAccessMode,
			campusIds: input.campusIds,
		});
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function previewMemberOwnerImpact(
	scope: OrganizationScope,
	input: MemberOwnerImpactInput,
): Promise<MemberOwnerImpactResult> {
	try {
		return await previewMemberOwnerImpactRecord({
			organizationId: scope.organizationId,
			actorUserId: scope.userId,
			change: input,
		});
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function removeMember(
	scope: OrganizationScope,
	input: RemoveMemberInput,
): Promise<void> {
	try {
		await removeMemberRecord({
			organizationId: scope.organizationId,
			actorUserId: scope.userId,
			memberId: input.memberId,
		});
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function listInvitations(
	scope: OrganizationScope,
): Promise<InvitationListResult> {
	try {
		const items = await listInvitationRecords({
			organizationId: scope.organizationId,
		});
		return {
			items: items.map((item) => ({
				...item,
				expiresAt: item.expiresAt.toISOString(),
				revokedAt: item.revokedAt?.toISOString() ?? null,
				claimedAt: item.claimedAt?.toISOString() ?? null,
				createdAt: item.createdAt.toISOString(),
			})),
		};
	} catch (error) {
		return throwRepositoryError(error);
	}
}

function toCreateInvitationResult(
	result: Awaited<ReturnType<typeof createInvitationRecord>>,
): CreateInvitationResult {
	return {
		invitation: {
			...result.invitation,
			expiresAt: result.invitation.expiresAt.toISOString(),
			revokedAt: result.invitation.revokedAt?.toISOString() ?? null,
			claimedAt: result.invitation.claimedAt?.toISOString() ?? null,
			createdAt: result.invitation.createdAt.toISOString(),
		},
		token: result.token,
	};
}

export async function createInvitation(
	scope: OrganizationScope,
	input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
	try {
		return toCreateInvitationResult(
			await createInvitationRecord({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function revokeInvitation(
	scope: OrganizationScope,
	input: RevokeInvitationInput,
): Promise<void> {
	try {
		await revokeInvitationRecord({
			organizationId: scope.organizationId,
			actorUserId: scope.userId,
			...input,
		});
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function resendInvitation(
	scope: OrganizationScope,
	input: ResendInvitationInput,
): Promise<CreateInvitationResult> {
	try {
		return toCreateInvitationResult(
			await resendInvitationRecord({
				organizationId: scope.organizationId,
				actorUserId: scope.userId,
				...input,
			}),
		);
	} catch (error) {
		return throwRepositoryError(error);
	}
}

export async function claimInvitation(
	input: ClaimInvitationInput,
	session: {
		userId: string;
		email: string;
		sessionId: string;
	},
): Promise<ClaimInvitationResult> {
	try {
		return await claimInvitationRecord({
			token: input.token,
			userId: session.userId,
			userEmail: session.email,
			sessionId: session.sessionId,
		});
	} catch (error) {
		return throwRepositoryError(error);
	}
}
