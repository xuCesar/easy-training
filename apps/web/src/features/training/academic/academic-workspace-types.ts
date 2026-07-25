import type {
	ClassGroup,
	Course,
	Teacher,
} from "@easy-training/api/contracts/training";

export type AcademicTab =
	| "classes"
	| "lessons"
	| "rooms"
	| "courses"
	| "teachers";

export type AcademicEditor =
	| { kind: "course"; value: Course | null }
	| { kind: "teacher"; value: Teacher | null }
	| { kind: "class"; value: ClassGroup | null }
	| { kind: "lesson"; value: ClassGroup | null }
	| null;

export const academicTabs: Array<{ id: AcademicTab; label: string }> = [
	{ id: "classes", label: "班级" },
	{ id: "lessons", label: "课次" },
	{ id: "rooms", label: "教室" },
	{ id: "courses", label: "课程" },
	{ id: "teachers", label: "教师" },
];

export const categoryLabels: Record<Course["category"], string> = {
	language: "语言",
	stem: "科学",
	art: "艺术",
	exam: "应试",
	sports: "运动",
};

export const classStatuses: Array<{
	value: ClassGroup["status"] | "all";
	label: string;
}> = [
	{ value: "recruiting", label: "招生中" },
	{ value: "running", label: "进行中" },
	{ value: "paused", label: "已暂停" },
	{ value: "completed", label: "已结课" },
];

export function getEditableClassStatuses(
	status: ClassGroup["status"],
): Array<{ value: ClassGroup["status"]; label: string }> {
	const allowedStatuses: Record<ClassGroup["status"], ClassGroup["status"][]> =
		{
			recruiting: ["recruiting", "running"],
			running: ["running", "completed"],
			paused: ["paused", "completed"],
			completed: ["completed"],
		};
	return classStatuses.filter(
		(item): item is { value: ClassGroup["status"]; label: string } =>
			item.value !== "all" && allowedStatuses[status].includes(item.value),
	);
}

export type AttendanceStatus = "present" | "absent" | "late" | "leave";

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
	present: "到课",
	absent: "缺勤",
	late: "迟到",
	leave: "请假",
};
