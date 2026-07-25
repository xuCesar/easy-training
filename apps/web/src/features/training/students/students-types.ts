import type {
	StudentListResult,
	StudentStatus,
} from "@easy-training/api/contracts/training";

export type StudentSummary = StudentListResult["items"][number];

export type StudentFormValues = {
	name: string;
	campusId: string;
	ownerUserId: string | null;
	birthDate: string;
	status: StudentStatus;
	contacts: Array<{
		id?: string;
		name: string;
		phone: string;
		relationship: string;
		isPrimary: boolean;
	}>;
	tagIds: string[];
};

export type EditorTarget = "new" | StudentSummary | null;

export const studentStatuses: Array<{ value: StudentStatus; label: string }> = [
	{ value: "trial", label: "试听" },
	{ value: "active", label: "在读" },
	{ value: "paused", label: "暂停" },
	{ value: "atRisk", label: "需关注" },
	{ value: "graduated", label: "已归档" },
];
