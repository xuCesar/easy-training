import { toast } from "sonner";
import type {
	Campus,
	CampusFormValues,
	Confirmation,
	Invitation,
} from "./settings-types";
import { type AccessMode, type Role, roleOptions } from "./settings-types";

export function toCampusValues(campus: Campus | null): CampusFormValues {
	return {
		code: campus?.code ?? "",
		name: campus?.name ?? "",
		city: campus?.city ?? "",
		address: campus?.address ?? "",
		roomCount: String(campus?.roomCount ?? 0),
		capacity: String(campus?.capacity ?? 0),
	};
}

export function toCampusInput(values: CampusFormValues) {
	return {
		code: values.code,
		name: values.name,
		city: values.city,
		address: values.address,
		roomCount: Number(values.roomCount),
		capacity: Number(values.capacity),
	};
}

export function toFormErrors(
	issues: Array<{ path: PropertyKey[]; message: string }>,
): Partial<Record<keyof CampusFormValues, string>> {
	const errors: Partial<Record<keyof CampusFormValues, string>> = {};
	for (const issue of issues) {
		const field = issue.path.at(-1);
		if (
			typeof field === "string" &&
			field in
				{
					code: true,
					name: true,
					city: true,
					address: true,
					roomCount: true,
					capacity: true,
				}
		)
			errors[field as keyof CampusFormValues] ??= issue.message;
	}
	return errors;
}

export function roleLabel(role: Role): string {
	return (
		roleOptions.find((option) => option.value === role)?.label ?? "机构成员"
	);
}

export function accessLabel(mode: AccessMode, count: number): string {
	return mode === "all" ? "全部校区" : `指定校区（${count} 个）`;
}

export function isActiveInvitation(invitation: Invitation): boolean {
	return (
		!invitation.claimedAt &&
		!invitation.revokedAt &&
		new Date(invitation.expiresAt).getTime() > Date.now()
	);
}

export function canRevoke(invitation: Invitation): boolean {
	return isActiveInvitation(invitation);
}

export function canResend(invitation: Invitation): boolean {
	return isActiveInvitation(invitation);
}

export function confirmationDetails(confirmation: Confirmation) {
	if (confirmation.kind === "campus") {
		const action = confirmation.campus.isActive ? "停用" : "启用";
		return {
			title: `${action}校区`,
			description: confirmation.campus.isActive
				? `停用“${confirmation.campus.name}”后，历史数据仍可读取，但不能再用于新的业务写入。`
				: `确认重新启用“${confirmation.campus.name}”？`,
			action,
			destructive: confirmation.campus.isActive,
		};
	}
	if (confirmation.kind === "member")
		return {
			title: "移除成员",
			description: `确认移除 ${confirmation.member.email} 吗？该成员将立即失去当前机构访问权限。`,
			action: "移除成员",
			destructive: true,
		};
	if (confirmation.kind === "revoke")
		return {
			title: "撤销邀请",
			description: "确认撤销这条邀请吗？该链接将不能再被领取。",
			action: "撤销邀请",
			destructive: true,
		};
	return {
		title: "重发邀请",
		description: "将撤销此前仍有效的邀请，并生成一条新的邀请链接。",
		action: "生成新链接",
		destructive: false,
	};
}

export function toInvitationUrl(token: string): string {
	return `${window.location.origin}/invite#token=${token}`;
}

export function showMutationError(error: unknown) {
	toast.error(
		error instanceof Error ? error.message : "操作失败，请稍后重试。",
	);
}

export async function copyInvitationUrl(url: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(url);
		toast.success("邀请链接已复制");
	} catch {
		toast.error("复制失败，请手动复制链接。");
	}
}
