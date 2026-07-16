export type EntityId = string;

export type LeadStage =
	| "new"
	| "contacted"
	| "trialBooked"
	| "enrolled"
	| "lost";

export type StudentStatus =
	| "active"
	| "trial"
	| "paused"
	| "graduated"
	| "atRisk";

export type CourseCategory = "language" | "stem" | "art" | "exam" | "sports";

export type ClassStatus = "recruiting" | "running" | "paused" | "completed";

export type LessonStatus = "scheduled" | "completed" | "cancelled";

export type InvoiceStatus = "paid" | "pending" | "overdue" | "refunded";

export type TaskPriority = "high" | "medium" | "low";

export interface Campus {
	id: EntityId;
	name: string;
	city: string;
	address: string;
	manager: string;
	rooms: number;
	capacity: number;
}

export interface Lead {
	id: EntityId;
	name: string;
	phone: string;
	source: string;
	interestedCourse: string;
	stage: LeadStage;
	owner: string;
	nextFollowAt: string;
	note: string;
}

export interface Student {
	id: EntityId;
	name: string;
	guardian: string;
	phone: string;
	age: number;
	campusId: EntityId;
	status: StudentStatus;
	enrolledCourseIds: EntityId[];
	remainingLessons: number;
	balance: number;
	lastAttendanceAt: string;
}

export interface Teacher {
	id: EntityId;
	name: string;
	subjects: string[];
	campusIds: EntityId[];
	weeklyCapacity: number;
	scheduledHours: number;
	satisfaction: number;
}

export interface Course {
	id: EntityId;
	name: string;
	category: CourseCategory;
	level: string;
	durationMinutes: number;
	listPrice: number;
	lessonsPerPackage: number;
	tags: string[];
}

export interface ClassGroup {
	id: EntityId;
	name: string;
	courseId: EntityId;
	campusId: EntityId;
	teacherId: EntityId;
	status: ClassStatus;
	enrolled: number;
	capacity: number;
	scheduleText: string;
	startDate: string;
}

export interface Lesson {
	id: EntityId;
	classId: EntityId;
	teacherId: EntityId;
	campusId: EntityId;
	room: string;
	startsAt: string;
	endsAt: string;
	status: LessonStatus;
	attendanceRate: number;
}

export interface Invoice {
	id: EntityId;
	studentId: EntityId;
	courseId: EntityId;
	amount: number;
	paidAmount: number;
	status: InvoiceStatus;
	dueDate: string;
	issuedAt: string;
}

export interface OperationTask {
	id: EntityId;
	title: string;
	module: "招生" | "教务" | "财务" | "学员服务";
	owner: string;
	dueAt: string;
	priority: TaskPriority;
	relatedName: string;
}

export interface TrainingSnapshot {
	campuses: Campus[];
	leads: Lead[];
	students: Student[];
	teachers: Teacher[];
	courses: Course[];
	classGroups: ClassGroup[];
	lessons: Lesson[];
	invoices: Invoice[];
	tasks: OperationTask[];
}
