const roleLabels = {
	owner: "机构负责人",
	admin: "管理员",
	campus_manager: "校区负责人",
	consultant: "课程顾问",
	teacher: "教师",
	finance: "财务",
} as const;

export function formatMemberRole(role: string): string {
	return roleLabels[role as keyof typeof roleLabels] ?? role;
}
