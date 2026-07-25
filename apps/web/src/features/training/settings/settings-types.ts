import type {
	Campus,
	InvitationListResult,
	MemberListResult,
} from "@easy-training/api/contracts/training";

export type Member = MemberListResult["items"][number];

export type Role = Member["role"];

export type AccessMode = Member["campusAccessMode"];

export type Invitation = InvitationListResult["items"][number];

export type CampusFormValues = {
	code: string;
	name: string;
	city: string;
	address: string;
	roomCount: string;
	capacity: string;
};

export type Confirmation =
	| { kind: "campus"; campus: Campus }
	| { kind: "member"; member: Member }
	| { kind: "revoke" | "resend"; invitation: Invitation };

export const managementRoles = new Set<Role>(["owner", "admin"]);

export const roleOptions: Array<{ value: Role; label: string }> = [
	{ value: "owner", label: "机构负责人" },
	{ value: "admin", label: "管理员" },
	{ value: "campus_manager", label: "校区负责人" },
	{ value: "consultant", label: "招生顾问" },
	{ value: "teacher", label: "教师" },
	{ value: "finance", label: "财务" },
];

export type { Campus };
