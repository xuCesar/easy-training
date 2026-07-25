import type {
	StudentDetail,
	StudentTag,
} from "@easy-training/api/contracts/training";
import type { StudentFormValues } from "./students-types";

export const emptyStudentForm: StudentFormValues = {
	name: "",
	campusId: "",
	ownerUserId: null,
	birthDate: "",
	status: "trial",
	contacts: [{ name: "", phone: "", relationship: "", isPrimary: true }],
	tagIds: [],
};

export function toStudentForm(student: StudentDetail): StudentFormValues {
	return {
		name: student.name,
		campusId: student.campusId,
		ownerUserId: student.ownerUserId,
		birthDate: student.birthDate ?? "",
		status: student.status,
		contacts: student.contacts.map((contact) => ({
			...contact,
			relationship: contact.relationship ?? "",
		})),
		tagIds: student.tags.map((tag) => tag.id),
	};
}

export function omitCampus(
	values: Omit<StudentFormValues, "birthDate" | "contacts"> & {
		birthDate: string | null;
		contacts: Array<{
			id?: string;
			name: string;
			phone: string;
			relationship: string | null;
			isPrimary: boolean;
		}>;
	},
) {
	const { campusId: _, ...data } = values;
	return data;
}

export function mergeTags(tags: StudentTag[], assigned: StudentTag[]) {
	return [
		...tags,
		...assigned.filter(
			(assignedTag) => !tags.some((tag) => tag.id === assignedTag.id),
		),
	];
}

export function isConflictError(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "CONFLICT" &&
		"data" in error &&
		typeof error.data === "object" &&
		error.data !== null &&
		"reason" in error.data &&
		error.data.reason === "STUDENT_VERSION_CONFLICT"
	);
}

export function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(value));
}
