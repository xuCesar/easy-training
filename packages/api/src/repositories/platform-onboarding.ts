import {
	createOnboardingInvitationRecord,
	listPlatformOnboardingInvitations,
	PlatformOnboardingError,
	revokeOnboardingInvitationRecord,
	rotateOnboardingInvitationRecord,
} from "@easy-training/db";
import { env } from "@easy-training/env/server";
import { ORPCError } from "@orpc/server";

import type {
	CreatePlatformOnboardingInput,
	PlatformOnboardingListInput,
	RotatePlatformOnboardingInput,
} from "../contracts/platform";

function throwPlatformOnboardingError(error: unknown): never {
	if (!(error instanceof PlatformOnboardingError)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "平台开通邀请操作失败，请稍后重试。",
		});
	}

	switch (error.code) {
		case "INVITATION_NOT_FOUND":
			throw new ORPCError("NOT_FOUND", { message: "开通邀请不存在。" });
		case "INVITATION_PENDING":
			throw new ORPCError("CONFLICT", {
				message: "该邮箱已有待领取邀请，请确认后使用重新生成。",
			});
		case "INVITATION_CLAIMED":
			throw new ORPCError("CONFLICT", {
				message: "邀请已领取，不能重新生成或撤销。",
			});
		case "INVITATION_EXPIRED":
			throw new ORPCError("CONFLICT", {
				message: "邀请已过期，请使用重新生成。",
			});
		case "INVALID_CURSOR":
			throw new ORPCError("BAD_REQUEST", {
				message: "分页游标无效，请刷新列表后重试。",
			});
		case "REQUEST_REPLAY":
			throw new ORPCError("CONFLICT", {
				message:
					"该操作已提交；出于安全原因无法再次显示原链接，如未保存请明确重新生成。",
			});
	}
}

function buildInvitationUrl(token: string): string {
	const url = new URL("/onboard", env.CORS_ORIGIN);
	url.hash = new URLSearchParams({ token }).toString();
	return url.toString();
}

function toIso(value: Date | null): string | null {
	return value?.toISOString() ?? null;
}

export async function listPlatformOnboarding(
	input: PlatformOnboardingListInput,
) {
	try {
		const result = await listPlatformOnboardingInvitations(input);
		return {
			...result,
			items: result.items.map((item) => ({
				...item,
				expiresAt: item.expiresAt.toISOString(),
				revokedAt: toIso(item.revokedAt),
				claimedAt: toIso(item.claimedAt),
				createdAt: item.createdAt.toISOString(),
			})),
		};
	} catch (error) {
		return throwPlatformOnboardingError(error);
	}
}

export async function createPlatformOnboarding(
	actorUserId: string,
	input: CreatePlatformOnboardingInput,
) {
	try {
		const created = await createOnboardingInvitationRecord({
			...input,
			actorUserId,
			source: "web",
		});
		return {
			id: created.id,
			expiresAt: created.expiresAt.toISOString(),
			invitationUrl: buildInvitationUrl(created.token),
		};
	} catch (error) {
		return throwPlatformOnboardingError(error);
	}
}

export async function rotatePlatformOnboarding(
	actorUserId: string,
	input: RotatePlatformOnboardingInput,
) {
	try {
		const created = await rotateOnboardingInvitationRecord({
			...input,
			actorUserId,
			source: "web",
		});
		return {
			id: created.id,
			expiresAt: created.expiresAt.toISOString(),
			invitationUrl: buildInvitationUrl(created.token),
		};
	} catch (error) {
		return throwPlatformOnboardingError(error);
	}
}

export async function revokePlatformOnboarding(
	actorUserId: string,
	input: { invitationId: string },
) {
	try {
		const revoked = await revokeOnboardingInvitationRecord({
			...input,
			actorUserId,
			source: "web",
		});
		return { id: revoked.id, revokedAt: revoked.revokedAt.toISOString() };
	} catch (error) {
		return throwPlatformOnboardingError(error);
	}
}
