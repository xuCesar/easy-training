import type {
	Campus,
	ClassGroup,
	Course,
	Invoice,
	Lead,
	Lesson,
	OperationTask,
	Student,
	Teacher,
	TrainingSnapshot,
} from "@easy-training/api/contracts/training";
import {
	Banknote,
	Bell,
	BookOpen,
	CalendarDays,
	GraduationCap,
	LayoutDashboard,
	MapPinned,
	Menu,
	Search,
	Settings2,
	UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "./components/Badge";
import { Button } from "./components/Button";
import { DataTable, type DataTableColumn } from "./components/DataTable";
import { MetricCard } from "./components/MetricCard";
import { Panel } from "./components/Panel";
import { ProgressBar } from "./components/ProgressBar";
import {
	formatCurrency,
	formatDate,
	formatDateTime,
	formatPercent,
} from "./format";
import { deriveInsights } from "./insights";
import {
	classStatusLabel,
	classStatusTone,
	invoiceStatusLabel,
	invoiceStatusTone,
	leadStageLabel,
	leadStageTone,
	studentStatusLabel,
	studentStatusTone,
	taskPriorityLabel,
	taskPriorityTone,
} from "./labels";

import "./training.css";

type AppView =
	| "dashboard"
	| "leads"
	| "students"
	| "classes"
	| "schedule"
	| "finance"
	| "settings";

interface NavigationItem {
	id: AppView;
	label: string;
	icon: typeof LayoutDashboard;
}

const navigationItems: NavigationItem[] = [
	{ id: "dashboard", label: "运营工作台", icon: LayoutDashboard },
	{ id: "leads", label: "招生线索", icon: UsersRound },
	{ id: "students", label: "学员中心", icon: GraduationCap },
	{ id: "classes", label: "课程班级", icon: BookOpen },
	{ id: "schedule", label: "排课教务", icon: CalendarDays },
	{ id: "finance", label: "财务收款", icon: Banknote },
	{ id: "settings", label: "校区配置", icon: Settings2 },
];

interface TrainingDashboardProps {
	snapshot: TrainingSnapshot;
}

export function TrainingDashboard({ snapshot }: TrainingDashboardProps) {
	const [activeView, setActiveView] = useState<AppView>("dashboard");
	const [query, setQuery] = useState("");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const insights = useMemo(() => deriveInsights(snapshot), [snapshot]);
	const todayLabel = useMemo(
		() =>
			new Intl.DateTimeFormat("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
			}).format(new Date()),
		[],
	);

	const pageTitle =
		navigationItems.find((item) => item.id === activeView)?.label ??
		"运营工作台";

	return (
		<div className="app-shell">
			<aside
				className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"}
				aria-label="主导航"
			>
				<div className="brand">
					<div className="brand-mark">ET</div>
					<div>
						<strong>Easy Training</strong>
						<span>教培运营系统</span>
					</div>
				</div>

				<nav className="nav-list">
					{navigationItems.map((item) => {
						const Icon = item.icon;
						return (
							<button
								aria-current={activeView === item.id ? "page" : undefined}
								className={
									activeView === item.id ? "nav-item active" : "nav-item"
								}
								key={item.id}
								onClick={() => {
									setActiveView(item.id);
									setSidebarOpen(false);
								}}
								type="button"
							>
								<Icon aria-hidden="true" size={18} />
								<span>{item.label}</span>
							</button>
						);
					})}
				</nav>

				<div className="sidebar-summary">
					<MapPinned aria-hidden="true" size={18} />
					<div>
						<strong>{snapshot.campuses.length} 个校区</strong>
						<span>统一课程、学员与财务口径</span>
					</div>
				</div>
			</aside>

			<main className="main-area">
				<header className="topbar">
					<button
						className="icon-button mobile-only"
						type="button"
						aria-label={sidebarOpen ? "关闭菜单" : "打开菜单"}
						aria-expanded={sidebarOpen}
						onClick={() => setSidebarOpen((open) => !open)}
					>
						<Menu size={20} />
					</button>
					<div>
						<p>今天 · {todayLabel}</p>
						<h1>{pageTitle}</h1>
					</div>
					<label className="search-box">
						<Search aria-hidden="true" size={18} />
						<input
							aria-label="搜索学员、线索、班级或账单"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索学员、线索、班级..."
							value={query}
						/>
					</label>
					<button className="icon-button" type="button" aria-label="查看提醒">
						<Bell size={20} />
					</button>
				</header>

				<ViewRenderer
					activeView={activeView}
					query={query}
					snapshot={snapshot}
					insights={insights}
				/>
			</main>
		</div>
	);
}

interface ViewRendererProps {
	activeView: AppView;
	query: string;
	snapshot: TrainingSnapshot;
	insights: ReturnType<typeof deriveInsights>;
}

function ViewRenderer({
	activeView,
	query,
	snapshot,
	insights,
}: ViewRendererProps) {
	switch (activeView) {
		case "leads":
			return (
				<LeadsView
					leads={filterRows(snapshot.leads, query, (lead) => [
						lead.name,
						lead.phone,
						lead.source,
						lead.interestedCourse,
					])}
				/>
			);
		case "students":
			return (
				<StudentsView
					campuses={snapshot.campuses}
					courses={snapshot.courses}
					students={filterRows(snapshot.students, query, (student) => [
						student.name,
						student.guardian,
						student.phone,
					])}
				/>
			);
		case "classes":
			return (
				<ClassesView
					campuses={snapshot.campuses}
					classes={filterRows(snapshot.classGroups, query, (classGroup) => [
						classGroup.name,
						classGroup.scheduleText,
					])}
					courses={snapshot.courses}
					teachers={snapshot.teachers}
				/>
			);
		case "schedule":
			return (
				<ScheduleView
					campuses={snapshot.campuses}
					classes={snapshot.classGroups}
					lessons={snapshot.lessons}
					teachers={snapshot.teachers}
				/>
			);
		case "finance":
			return (
				<FinanceView
					courses={snapshot.courses}
					insights={insights}
					invoices={snapshot.invoices}
					students={snapshot.students}
				/>
			);
		case "settings":
			return (
				<SettingsView
					campuses={snapshot.campuses}
					courses={snapshot.courses}
					teachers={snapshot.teachers}
				/>
			);
		default:
			return <DashboardView snapshot={snapshot} insights={insights} />;
	}
}

interface DashboardViewProps {
	snapshot: TrainingSnapshot;
	insights: ReturnType<typeof deriveInsights>;
}

function DashboardView({ snapshot, insights }: DashboardViewProps) {
	return (
		<div className="content-stack">
			<section className="metric-grid" aria-label="关键经营指标">
				{insights.metrics.map((metric) => (
					<MetricCard key={metric.label} metric={metric} />
				))}
			</section>

			<div className="two-column-grid">
				<Panel title="今日待办" description="按招生、教务、财务和学员服务聚合">
					<TaskList tasks={snapshot.tasks} />
				</Panel>

				<Panel
					title="经营健康度"
					description="从招生转化、满班率、出勤和回款看风险"
				>
					<div className="progress-list">
						<ProgressBar
							value={insights.utilizationRate}
							label="班级满班率"
							tone="green"
						/>
						<ProgressBar
							value={insights.averageAttendanceRate}
							label="平均出勤率"
							tone="blue"
						/>
						<ProgressBar
							value={
								1 -
								insights.invoiceStatusCounts.overdue /
									Math.max(snapshot.invoices.length, 1)
							}
							label="账款健康度"
							tone="amber"
						/>
					</div>
				</Panel>
			</div>

			<div className="two-column-grid wide-left">
				<UpcomingLessonsPanel
					campuses={snapshot.campuses}
					classes={snapshot.classGroups}
					lessons={snapshot.lessons}
					teachers={snapshot.teachers}
				/>
				<EnrollmentFunnelPanel leads={snapshot.leads} />
			</div>
		</div>
	);
}

function LeadsView({ leads }: { leads: Lead[] }) {
	const columns: DataTableColumn<Lead>[] = [
		{
			key: "name",
			header: "线索",
			render: (lead) => (
				<div className="cell-title">
					<strong>{lead.name}</strong>
					<span>{lead.phone}</span>
				</div>
			),
		},
		{ key: "source", header: "来源", render: (lead) => lead.source },
		{
			key: "course",
			header: "意向课程",
			render: (lead) => lead.interestedCourse,
		},
		{
			key: "stage",
			header: "阶段",
			render: (lead) => (
				<Badge tone={leadStageTone[lead.stage]}>
					{leadStageLabel[lead.stage]}
				</Badge>
			),
		},
		{ key: "owner", header: "负责人", render: (lead) => lead.owner },
		{
			key: "follow",
			header: "下次跟进",
			render: (lead) => formatDateTime(lead.nextFollowAt),
		},
		{ key: "note", header: "备注", render: (lead) => lead.note },
	];

	return (
		<Panel
			title="招生线索池"
			description="统一承接投放、转介绍、到访和试听后的转化动作"
			action={<Button>新增线索</Button>}
		>
			<DataTable columns={columns} rows={leads} getRowKey={(lead) => lead.id} />
		</Panel>
	);
}

interface StudentsViewProps {
	campuses: Campus[];
	courses: Course[];
	students: Student[];
}

function StudentsView({ campuses, courses, students }: StudentsViewProps) {
	const columns: DataTableColumn<Student>[] = [
		{
			key: "name",
			header: "学员",
			render: (student) => (
				<div className="cell-title">
					<strong>{student.name}</strong>
					<span>
						{student.age} 岁 · {student.guardian}
					</span>
				</div>
			),
		},
		{ key: "phone", header: "联系方式", render: (student) => student.phone },
		{
			key: "campus",
			header: "校区",
			render: (student) => findName(campuses, student.campusId),
		},
		{
			key: "courses",
			header: "课程",
			render: (student) =>
				student.enrolledCourseIds.map((id) => findName(courses, id)).join("、"),
		},
		{
			key: "status",
			header: "状态",
			render: (student) => (
				<Badge tone={studentStatusTone[student.status]}>
					{studentStatusLabel[student.status]}
				</Badge>
			),
		},
		{
			key: "remaining",
			header: "剩余课时",
			align: "right",
			render: (student) => `${student.remainingLessons} 节`,
		},
		{
			key: "balance",
			header: "账户余额",
			align: "right",
			render: (student) => formatCurrency(student.balance),
		},
		{
			key: "attendance",
			header: "最近到课",
			render: (student) => formatDateTime(student.lastAttendanceAt),
		},
	];

	return (
		<Panel
			title="学员中心"
			description="围绕在读、试听、风险和续费管理学员生命周期"
			action={<Button>新建学员</Button>}
		>
			<DataTable
				columns={columns}
				rows={students}
				getRowKey={(student) => student.id}
			/>
		</Panel>
	);
}

interface ClassesViewProps {
	campuses: Campus[];
	classes: ClassGroup[];
	courses: Course[];
	teachers: Teacher[];
}

function ClassesView({
	campuses,
	classes,
	courses,
	teachers,
}: ClassesViewProps) {
	const columns: DataTableColumn<ClassGroup>[] = [
		{
			key: "name",
			header: "班级",
			render: (classGroup) => (
				<div className="cell-title">
					<strong>{classGroup.name}</strong>
					<span>{findName(courses, classGroup.courseId)}</span>
				</div>
			),
		},
		{
			key: "campus",
			header: "校区",
			render: (classGroup) => findName(campuses, classGroup.campusId),
		},
		{
			key: "teacher",
			header: "主讲",
			render: (classGroup) => findName(teachers, classGroup.teacherId),
		},
		{
			key: "schedule",
			header: "上课时间",
			render: (classGroup) => classGroup.scheduleText,
		},
		{
			key: "capacity",
			header: "满班进度",
			render: (classGroup) => (
				<ProgressBar
					value={classGroup.enrolled / classGroup.capacity}
					label={`${classGroup.enrolled}/${classGroup.capacity}`}
				/>
			),
		},
		{
			key: "status",
			header: "状态",
			render: (classGroup) => (
				<Badge tone={classStatusTone[classGroup.status]}>
					{classStatusLabel[classGroup.status]}
				</Badge>
			),
		},
		{
			key: "startDate",
			header: "开班日期",
			render: (classGroup) => formatDate(classGroup.startDate),
		},
	];

	return (
		<Panel
			title="课程与班级"
			description="复用课程产品，按校区、教师和容量开设班级"
			action={<Button>开设班级</Button>}
		>
			<DataTable
				columns={columns}
				rows={classes}
				getRowKey={(classGroup) => classGroup.id}
			/>
		</Panel>
	);
}

interface ScheduleViewProps {
	campuses: Campus[];
	classes: ClassGroup[];
	lessons: Lesson[];
	teachers: Teacher[];
}

function ScheduleView({
	campuses,
	classes,
	lessons,
	teachers,
}: ScheduleViewProps) {
	return (
		<div className="content-stack">
			<UpcomingLessonsPanel
				campuses={campuses}
				classes={classes}
				lessons={lessons}
				teachers={teachers}
			/>
			<Panel
				title="教师负载"
				description="避免优秀老师过载，同时给低负载老师安排补位机会"
			>
				<div className="teacher-grid">
					{teachers.map((teacher) => (
						<article className="teacher-card" key={teacher.id}>
							<div>
								<h3>{teacher.name}</h3>
								<p>{teacher.subjects.join("、")}</p>
							</div>
							<ProgressBar
								value={teacher.scheduledHours / teacher.weeklyCapacity}
								label={`${teacher.scheduledHours}/${teacher.weeklyCapacity} 小时`}
								tone={
									teacher.scheduledHours / teacher.weeklyCapacity > 0.9
										? "red"
										: "blue"
								}
							/>
							<span>满意度 {formatPercent(teacher.satisfaction)}</span>
						</article>
					))}
				</div>
			</Panel>
		</div>
	);
}

interface FinanceViewProps {
	courses: Course[];
	insights: ReturnType<typeof deriveInsights>;
	invoices: Invoice[];
	students: Student[];
}

function FinanceView({
	courses,
	insights,
	invoices,
	students,
}: FinanceViewProps) {
	const columns: DataTableColumn<Invoice>[] = [
		{ key: "id", header: "账单号", render: (invoice) => invoice.id },
		{
			key: "student",
			header: "学员",
			render: (invoice) => findName(students, invoice.studentId),
		},
		{
			key: "course",
			header: "课程",
			render: (invoice) => findName(courses, invoice.courseId),
		},
		{
			key: "amount",
			header: "应收",
			align: "right",
			render: (invoice) => formatCurrency(invoice.amount),
		},
		{
			key: "paid",
			header: "已收",
			align: "right",
			render: (invoice) => formatCurrency(invoice.paidAmount),
		},
		{
			key: "status",
			header: "状态",
			render: (invoice) => (
				<Badge tone={invoiceStatusTone[invoice.status]}>
					{invoiceStatusLabel[invoice.status]}
				</Badge>
			),
		},
		{
			key: "due",
			header: "到期日",
			render: (invoice) => formatDate(invoice.dueDate),
		},
	];

	return (
		<div className="content-stack">
			<section className="metric-grid" aria-label="财务指标">
				<MetricCard
					metric={{
						label: "账单实收",
						value: formatCurrency(insights.monthlyRevenue),
						helper: "来自当前账单样例",
						tone: "success",
					}}
				/>
				<MetricCard
					metric={{
						label: "待收金额",
						value: formatCurrency(insights.receivableAmount),
						helper: "含未到期与逾期",
						tone: "warning",
					}}
				/>
				<MetricCard
					metric={{
						label: "逾期账单",
						value: String(insights.invoiceStatusCounts.overdue),
						helper: "需优先跟进",
						tone: "danger",
					}}
				/>
			</section>
			<Panel
				title="账单与收款"
				description="按学员、课程、到期日和收款状态管理回款"
				action={<Button>创建账单</Button>}
			>
				<DataTable
					columns={columns}
					rows={invoices}
					getRowKey={(invoice) => invoice.id}
				/>
			</Panel>
		</div>
	);
}

interface SettingsViewProps {
	campuses: Campus[];
	courses: Course[];
	teachers: Teacher[];
}

function SettingsView({ campuses, courses, teachers }: SettingsViewProps) {
	return (
		<div className="settings-grid">
			<Panel
				title="校区档案"
				description="多校区复用同一套课程、学员和财务模型"
			>
				<div className="card-list">
					{campuses.map((campus) => (
						<article className="info-card" key={campus.id}>
							<h3>{campus.name}</h3>
							<p>
								{campus.city} · {campus.address}
							</p>
							<span>负责人：{campus.manager}</span>
							<span>
								{campus.rooms} 间教室 · 容量 {campus.capacity} 人
							</span>
						</article>
					))}
				</div>
			</Panel>

			<Panel
				title="课程产品库"
				description="把课程作为可复用产品，再挂到不同班级和校区"
			>
				<div className="card-list">
					{courses.map((course) => (
						<article className="info-card" key={course.id}>
							<h3>{course.name}</h3>
							<p>
								{course.level} · {course.durationMinutes} 分钟/课次
							</p>
							<span>
								{formatCurrency(course.listPrice)} / {course.lessonsPerPackage}{" "}
								节
							</span>
							<div className="tag-row">
								{course.tags.map((tag) => (
									<Badge key={tag} tone="blue">
										{tag}
									</Badge>
								))}
							</div>
						</article>
					))}
				</div>
			</Panel>

			<Panel
				title="教师资源"
				description="教师可跨校区授权，排课时按负载与科目匹配"
			>
				<div className="card-list">
					{teachers.map((teacher) => (
						<article className="info-card" key={teacher.id}>
							<h3>{teacher.name}</h3>
							<p>{teacher.subjects.join("、")}</p>
							<span>周容量 {teacher.weeklyCapacity} 小时</span>
							<span>满意度 {formatPercent(teacher.satisfaction)}</span>
						</article>
					))}
				</div>
			</Panel>
		</div>
	);
}

function UpcomingLessonsPanel({
	campuses,
	classes,
	lessons,
	teachers,
}: ScheduleViewProps) {
	const columns: DataTableColumn<Lesson>[] = [
		{
			key: "time",
			header: "时间",
			render: (lesson) => (
				<div className="cell-title">
					<strong>{formatDateTime(lesson.startsAt)}</strong>
					<span>{lesson.room}</span>
				</div>
			),
		},
		{
			key: "class",
			header: "班级",
			render: (lesson) => findName(classes, lesson.classId),
		},
		{
			key: "teacher",
			header: "教师",
			render: (lesson) => findName(teachers, lesson.teacherId),
		},
		{
			key: "campus",
			header: "校区",
			render: (lesson) => findName(campuses, lesson.campusId),
		},
		{
			key: "attendance",
			header: "预计出勤",
			align: "right",
			render: (lesson) => formatPercent(lesson.attendanceRate),
		},
	];

	return (
		<Panel title="近期课表" description="用于前台签到、教室资源和教师提醒">
			<DataTable
				columns={columns}
				rows={lessons}
				getRowKey={(lesson) => lesson.id}
			/>
		</Panel>
	);
}

function EnrollmentFunnelPanel({ leads }: { leads: Lead[] }) {
	const stages = ["new", "contacted", "trialBooked", "enrolled"] as const;
	const maxCount = Math.max(
		...stages.map(
			(stage) => leads.filter((lead) => lead.stage === stage).length,
		),
		1,
	);

	return (
		<Panel title="招生漏斗" description="查看从线索到报名的关键流失点">
			<div className="funnel-list">
				{stages.map((stage) => {
					const count = leads.filter((lead) => lead.stage === stage).length;
					return (
						<div className="funnel-item" key={stage}>
							<div>
								<span>{leadStageLabel[stage]}</span>
								<strong>{count}</strong>
							</div>
							<div className="funnel-track">
								<span style={{ width: `${(count / maxCount) * 100}%` }} />
							</div>
						</div>
					);
				})}
			</div>
		</Panel>
	);
}

function TaskList({ tasks }: { tasks: OperationTask[] }) {
	return (
		<div className="task-list">
			{tasks.map((task) => (
				<article className="task-item" key={task.id}>
					<div>
						<h3>{task.title}</h3>
						<p>
							{task.module} · {task.relatedName} · {formatDateTime(task.dueAt)}
						</p>
					</div>
					<div className="task-meta">
						<Badge tone={taskPriorityTone[task.priority]}>
							{taskPriorityLabel[task.priority]}
						</Badge>
						<span>{task.owner}</span>
					</div>
				</article>
			))}
		</div>
	);
}

function findName(
	items: Array<{ id: string; name: string }>,
	id: string,
): string {
	return items.find((item) => item.id === id)?.name ?? "未知";
}

function filterRows<T>(
	rows: T[],
	query: string,
	pickFields: (row: T) => string[],
): T[] {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return rows;
	}

	return rows.filter((row) =>
		pickFields(row).some((field) =>
			field.toLowerCase().includes(normalizedQuery),
		),
	);
}
