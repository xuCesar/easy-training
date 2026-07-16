import type {
	InvoiceStatus,
	LeadStage,
	StudentStatus,
	TrainingSnapshot,
} from "@easy-training/api/contracts/training";

export interface DashboardMetric {
	label: string;
	value: string;
	helper: string;
	tone: "primary" | "success" | "warning" | "danger";
}

export interface DerivedInsights {
	metrics: DashboardMetric[];
	leadStageCounts: Record<LeadStage, number>;
	studentStatusCounts: Record<StudentStatus, number>;
	invoiceStatusCounts: Record<InvoiceStatus, number>;
	monthlyRevenue: number;
	receivableAmount: number;
	averageAttendanceRate: number;
	utilizationRate: number;
}

const leadStages: LeadStage[] = [
	"new",
	"contacted",
	"trialBooked",
	"enrolled",
	"lost",
];
const studentStatuses: StudentStatus[] = [
	"active",
	"trial",
	"paused",
	"graduated",
	"atRisk",
];
const invoiceStatuses: InvoiceStatus[] = [
	"paid",
	"pending",
	"overdue",
	"refunded",
];

export function deriveInsights(snapshot: TrainingSnapshot): DerivedInsights {
	const leadStageCounts = countBy(
		snapshot.leads.map((lead) => lead.stage),
		leadStages,
	);
	const studentStatusCounts = countBy(
		snapshot.students.map((student) => student.status),
		studentStatuses,
	);
	const invoiceStatusCounts = countBy(
		snapshot.invoices.map((invoice) => invoice.status),
		invoiceStatuses,
	);

	const monthlyRevenue = snapshot.invoices.reduce(
		(sum, invoice) => sum + invoice.paidAmount,
		0,
	);
	const receivableAmount = snapshot.invoices.reduce(
		(sum, invoice) => sum + Math.max(invoice.amount - invoice.paidAmount, 0),
		0,
	);
	const completedLessons = snapshot.lessons.filter(
		(lesson) => lesson.status === "completed",
	);
	const averageAttendanceRate =
		completedLessons.reduce((sum, lesson) => sum + lesson.attendanceRate, 0) /
		Math.max(completedLessons.length, 1);
	const totalCapacity = snapshot.classGroups.reduce(
		(sum, group) => sum + group.capacity,
		0,
	);
	const totalEnrolled = snapshot.classGroups.reduce(
		(sum, group) => sum + group.enrolled,
		0,
	);
	const utilizationRate = totalEnrolled / Math.max(totalCapacity, 1);

	return {
		metrics: [
			{
				label: "在读学员",
				value: String(
					snapshot.students.filter((student) => student.status === "active")
						.length,
				),
				helper: `${studentStatusCounts.trial} 位试听学员待转化`,
				tone: "primary",
			},
			{
				label: "招生线索",
				value: String(snapshot.leads.length),
				helper: `${leadStageCounts.new + leadStageCounts.contacted} 条待继续跟进`,
				tone: "warning",
			},
			{
				label: "班级满班率",
				value: `${Math.round(utilizationRate * 100)}%`,
				helper: `${snapshot.classGroups.length} 个班级持续运营`,
				tone: "success",
			},
			{
				label: "待收款",
				value: `¥${Math.round(receivableAmount / 1000)}k`,
				helper: `${invoiceStatusCounts.overdue} 笔已逾期`,
				tone: invoiceStatusCounts.overdue > 0 ? "danger" : "primary",
			},
		],
		leadStageCounts,
		studentStatusCounts,
		invoiceStatusCounts,
		monthlyRevenue,
		receivableAmount,
		averageAttendanceRate,
		utilizationRate,
	};
}

function countBy<T extends string>(values: T[], keys: T[]): Record<T, number> {
	const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		T,
		number
	>;

	for (const value of values) {
		counts[value] += 1;
	}

	return counts;
}
