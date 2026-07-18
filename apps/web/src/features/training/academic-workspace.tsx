import type {
	ClassGroup,
	Course,
	Lesson,
	Teacher,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { Field, FieldLabel } from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	CircleAlertIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	PowerIcon,
	SchoolIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import { formatCentsToCurrency, formatDateTime } from "./format";

type AcademicTab = "classes" | "lessons" | "courses" | "teachers";
type Editor =
	| { kind: "course"; value: Course | null }
	| { kind: "teacher"; value: Teacher | null }
	| { kind: "class"; value: ClassGroup | null }
	| { kind: "lesson"; value: ClassGroup | null }
	| null;

const tabs: Array<{ id: AcademicTab; label: string }> = [
	{ id: "classes", label: "班级" },
	{ id: "lessons", label: "课次" },
	{ id: "courses", label: "课程" },
	{ id: "teachers", label: "教师" },
];

export function AcademicWorkspace({
	initialTab,
	organizationId,
	sessionUserId,
	role,
}: {
	initialTab: AcademicTab;
	organizationId: string;
	sessionUserId: string | undefined;
	role: string;
}) {
	const [editor, setEditor] = useState<Editor>(null);
	const [cancelTarget, setCancelTarget] = useState<Lesson | null>(null);
	const [campusId, setCampusId] = useState<string | undefined>();
	const [classStatus, setClassStatus] = useState<string>("all");
	const canManageCatalog = role === "owner" || role === "admin";
	const context = { organizationId, sessionUserId };
	const campusesOptions = orpc.training.campuses.list.queryOptions({
		input: { includeInactive: false },
	});
	const coursesOptions = orpc.training.teaching.courses.list.queryOptions({
		input: { includeInactive: true },
	});
	const teachersOptions = orpc.training.teaching.teachers.list.queryOptions();
	const classesInput = {
		campusId,
		status:
			classStatus === "all"
				? undefined
				: (classStatus as "recruiting" | "running" | "paused" | "completed"),
	};
	const classesOptions = orpc.training.teaching.classes.list.queryOptions({
		input: classesInput,
	});
	const lessonsOptions = orpc.training.teaching.lessons.list.queryOptions({
		input: { campusId },
	});
	const campusesQuery = useQuery({
		...campusesOptions,
		queryKey: [...campusesOptions.queryKey, context],
	});
	const coursesQuery = useQuery({
		...coursesOptions,
		queryKey: [...coursesOptions.queryKey, context],
	});
	const teachersQuery = useQuery({
		...teachersOptions,
		queryKey: [...teachersOptions.queryKey, context],
	});
	const classesQuery = useQuery({
		...classesOptions,
		queryKey: [...classesOptions.queryKey, context, classesInput],
	});
	const lessonsQuery = useQuery({
		...lessonsOptions,
		queryKey: [...lessonsOptions.queryKey, context, { campusId }],
	});

	function refresh() {
		return invalidateAcademicQueries();
	}
	const createAction =
		initialTab === "lessons"
			? {
					label: "新增课次",
					onClick: () => setEditor({ kind: "lesson", value: null }),
				}
			: initialTab === "courses" && canManageCatalog
				? {
						label: "新建课程",
						onClick: () => setEditor({ kind: "course", value: null }),
					}
				: initialTab === "teachers" && canManageCatalog
					? {
							label: "新建教师",
							onClick: () => setEditor({ kind: "teacher", value: null }),
						}
					: {
							label: "新建班级",
							onClick: () => setEditor({ kind: "class", value: null }),
						};

	return (
		<div className="flex min-w-0 flex-col gap-5">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-muted-foreground text-sm">教务管理</p>
					<h1 className="mt-1 font-semibold text-2xl">班级与排课</h1>
					<p className="mt-1 text-muted-foreground text-xs">
						课次时间统一按中国标准时间处理
					</p>
				</div>
				<Button onClick={createAction.onClick}>
					<PlusIcon data-icon="inline-start" /> {createAction.label}
				</Button>
			</section>
			<nav
				className="flex max-w-full gap-1 overflow-x-auto border-b"
				aria-label="教务功能"
			>
				{tabs
					.filter(
						(item) =>
							canManageCatalog ||
							(item.id !== "courses" && item.id !== "teachers"),
					)
					.map((item) => (
						<Link
							key={item.id}
							to="/academic"
							search={{ tab: item.id }}
							className={`shrink-0 border-b-2 px-3 py-2 text-sm ${initialTab === item.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
						>
							{item.label}
						</Link>
					))}
			</nav>
			{initialTab === "classes" ? (
				<ClassesPanel
					campuses={campusesQuery.data?.items ?? []}
					classes={classesQuery.data?.items ?? []}
					isPending={classesQuery.isPending}
					isError={classesQuery.isError}
					campusId={campusId}
					status={classStatus}
					onCampusChange={setCampusId}
					onStatusChange={setClassStatus}
					onEdit={(value) => setEditor({ kind: "class", value })}
					onSchedule={(value) => setEditor({ kind: "lesson", value })}
					onCreate={() => setEditor({ kind: "class", value: null })}
					onRetry={() => void classesQuery.refetch()}
				/>
			) : null}
			{initialTab === "lessons" ? (
				<LessonsPanel
					campuses={campusesQuery.data?.items ?? []}
					lessons={lessonsQuery.data?.items ?? []}
					isPending={lessonsQuery.isPending}
					isError={lessonsQuery.isError}
					campusId={campusId}
					onCampusChange={setCampusId}
					onSchedule={() => setEditor({ kind: "lesson", value: null })}
					onCancel={setCancelTarget}
					onRetry={() => void lessonsQuery.refetch()}
				/>
			) : null}
			{initialTab === "courses" && canManageCatalog ? (
				<CoursesPanel
					courses={coursesQuery.data?.items ?? []}
					isPending={coursesQuery.isPending}
					isError={coursesQuery.isError}
					onCreate={() => setEditor({ kind: "course", value: null })}
					onEdit={(value) => setEditor({ kind: "course", value })}
					onRetry={() => void coursesQuery.refetch()}
				/>
			) : null}
			{initialTab === "teachers" && canManageCatalog ? (
				<TeachersPanel
					teachers={teachersQuery.data?.items ?? []}
					campuses={campusesQuery.data?.items ?? []}
					isPending={teachersQuery.isPending}
					isError={teachersQuery.isError}
					onCreate={() => setEditor({ kind: "teacher", value: null })}
					onEdit={(value) => setEditor({ kind: "teacher", value })}
					onRetry={() => void teachersQuery.refetch()}
				/>
			) : null}
			{editor?.kind === "course" ? (
				<CourseEditor
					value={editor.value}
					onClose={() => setEditor(null)}
					onSaved={refresh}
				/>
			) : null}
			{editor?.kind === "teacher" ? (
				<TeacherEditor
					value={editor.value}
					campuses={campusesQuery.data?.items ?? []}
					onClose={() => setEditor(null)}
					onSaved={refresh}
				/>
			) : null}
			{editor?.kind === "class" ? (
				<ClassEditor
					value={editor.value}
					campuses={campusesQuery.data?.items ?? []}
					courses={
						coursesQuery.data?.items.filter((course) => course.isActive) ?? []
					}
					teachers={teachersQuery.data?.items ?? []}
					onClose={() => setEditor(null)}
					onSaved={refresh}
				/>
			) : null}
			{editor?.kind === "lesson" ? (
				<LessonEditor
					defaultClass={editor.value}
					classes={classesQuery.data?.items ?? []}
					onClose={() => setEditor(null)}
					onSaved={refresh}
				/>
			) : null}
			{cancelTarget ? (
				<CancelLessonDialog
					lesson={cancelTarget}
					onClose={() => setCancelTarget(null)}
					onSaved={refresh}
				/>
			) : null}
		</div>
	);
}

function invalidateAcademicQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.courses.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.teachers.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.lessons.list.key(),
		}),
	]);
}

function ClassesPanel({
	campuses,
	classes,
	isPending,
	isError,
	campusId,
	status,
	onCampusChange,
	onStatusChange,
	onEdit,
	onSchedule,
	onCreate,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	classes: ClassGroup[];
	isPending: boolean;
	isError: boolean;
	campusId: string | undefined;
	status: string;
	onCampusChange: (value: string | undefined) => void;
	onStatusChange: (value: string) => void;
	onEdit: (item: ClassGroup) => void;
	onSchedule: (item: ClassGroup) => void;
	onCreate: () => void;
	onRetry: () => void;
}) {
	return (
		<>
			<FilterBar
				campuses={campuses}
				campusId={campusId}
				onCampusChange={onCampusChange}
			>
				<FilterSelect
					label="班级状态"
					value={status}
					onValueChange={onStatusChange}
					items={[{ value: "all", label: "全部状态" }, ...classStatuses]}
				/>
			</FilterBar>
			<PanelState
				pending={isPending}
				error={isError}
				empty={classes.length === 0}
				emptyTitle="还没有班级"
				emptyDescription="完成课程与教师维护后，即可在授权校区开班。"
				onRetry={onRetry}
				onCreate={onCreate}
			>
				<div className="grid gap-2">
					{classes.map((item) => (
						<article
							key={item.id}
							className="grid gap-3 border p-3 md:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(0,1fr))_auto] md:items-center"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{item.name}</p>
								<p className="mt-1 truncate text-muted-foreground text-xs">
									{item.courseName} · {item.teacherName}
								</p>
							</div>
							<DataCell label="校区" value={item.campusName} />
							<DataCell
								label="报名"
								value={`${item.enrollmentCount} / ${item.capacity} 人`}
							/>
							<DataCell label="开班" value={item.startDate} />
							<div>
								<StatusBadge status={item.status} />
								<p className="mt-1 truncate text-muted-foreground text-xs">
									{item.scheduleText}
								</p>
							</div>
							<div className="flex gap-1">
								<Button
									size="icon-sm"
									variant="ghost"
									aria-label={`编辑${item.name}`}
									onClick={() => onEdit(item)}
								>
									<PencilIcon />
								</Button>
								<Button
									size="sm"
									variant="outline"
									disabled={
										item.status === "paused" || item.status === "completed"
									}
									onClick={() => onSchedule(item)}
								>
									<CalendarClockIcon data-icon="inline-start" />
									排课
								</Button>
							</div>
						</article>
					))}
				</div>
			</PanelState>
		</>
	);
}

function LessonsPanel({
	campuses,
	lessons,
	isPending,
	isError,
	campusId,
	onCampusChange,
	onSchedule,
	onCancel,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	lessons: Lesson[];
	isPending: boolean;
	isError: boolean;
	campusId: string | undefined;
	onCampusChange: (value: string | undefined) => void;
	onSchedule: () => void;
	onCancel: (item: Lesson) => void;
	onRetry: () => void;
}) {
	const scheduled = lessons.filter((item) => item.status === "scheduled");
	return (
		<>
			<FilterBar
				campuses={campuses}
				campusId={campusId}
				onCampusChange={onCampusChange}
			>
				<p className="self-center text-muted-foreground text-xs">
					已排 {scheduled.length} 节，取消课次仍保留审计记录。
				</p>
			</FilterBar>
			<PanelState
				pending={isPending}
				error={isError}
				empty={lessons.length === 0}
				emptyTitle="近期没有课次"
				emptyDescription="从班级发起单节排课，系统会校验教师与教室冲突。"
				onRetry={onRetry}
				onCreate={onSchedule}
			>
				<div className="grid gap-2">
					{lessons.map((item) => (
						<article
							key={item.id}
							className="grid gap-3 border p-3 md:grid-cols-[10rem_minmax(12rem,1fr)_repeat(3,minmax(0,1fr))_auto] md:items-center"
						>
							<div>
								<p className="font-medium text-sm">
									{formatDateTime(item.startsAt)}
								</p>
								<p className="text-muted-foreground text-xs">
									至 {formatDateTime(item.endsAt)}
								</p>
							</div>
							<div className="min-w-0">
								<p className="truncate font-medium">{item.className}</p>
								<p className="truncate text-muted-foreground text-xs">
									{item.courseName} · {item.teacherName}
								</p>
							</div>
							<DataCell
								label="校区 / 教室"
								value={`${item.campusName} / ${item.room}`}
							/>
							<div>
								<StatusBadge status={item.status} />
								{item.cancellationReason ? (
									<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
										{item.cancellationReason}
									</p>
								) : null}
							</div>
							<div className="hidden md:block" />
							<div>
								{item.status === "scheduled" ? (
									<Button
										size="sm"
										variant="destructive"
										onClick={() => onCancel(item)}
									>
										取消课次
									</Button>
								) : null}
							</div>
						</article>
					))}
				</div>
			</PanelState>
		</>
	);
}

function CoursesPanel({
	courses,
	isPending,
	isError,
	onCreate,
	onEdit,
	onRetry,
}: {
	courses: Course[];
	isPending: boolean;
	isError: boolean;
	onCreate: () => void;
	onEdit: (item: Course) => void;
	onRetry: () => void;
}) {
	return (
		<PanelState
			pending={isPending}
			error={isError}
			empty={courses.length === 0}
			emptyTitle="还没有课程产品"
			emptyDescription="课程是开班与报名的基础，请先建立课程目录。"
			onRetry={onRetry}
			onCreate={onCreate}
		>
			<div className="grid gap-2">
				{courses.map((item) => (
					<article
						key={item.id}
						className="grid gap-3 border p-3 md:grid-cols-[minmax(14rem,1.4fr)_repeat(3,minmax(0,1fr))_auto] md:items-center"
					>
						<div className="min-w-0">
							<p className="truncate font-medium">{item.name}</p>
							<p className="truncate text-muted-foreground text-xs">
								{item.code} · {categoryLabels[item.category]} · {item.level}
							</p>
						</div>
						<DataCell
							label="课包"
							value={`${item.lessonsPerPackage} 课次 / ${item.durationMinutes} 分钟`}
						/>
						<DataCell
							label="标准价"
							value={formatCentsToCurrency(item.listPriceInCents)}
						/>
						<div>
							<StatusBadge status={item.isActive ? "active" : "inactive"} />
							<p className="mt-1 truncate text-muted-foreground text-xs">
								{item.tags.join(" · ") || "无标签"}
							</p>
						</div>
						<div className="flex gap-1">
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={`编辑${item.name}`}
								onClick={() => onEdit(item)}
							>
								<PencilIcon />
							</Button>
							<CoursePowerButton course={item} />
						</div>
					</article>
				))}
			</div>
		</PanelState>
	);
}

function TeachersPanel({
	teachers,
	campuses,
	isPending,
	isError,
	onCreate,
	onEdit,
	onRetry,
}: {
	teachers: Teacher[];
	campuses: Array<{ id: string; name: string }>;
	isPending: boolean;
	isError: boolean;
	onCreate: () => void;
	onEdit: (item: Teacher) => void;
	onRetry: () => void;
}) {
	const campusNames = new Map(campuses.map((item) => [item.id, item.name]));
	return (
		<PanelState
			pending={isPending}
			error={isError}
			empty={teachers.length === 0}
			emptyTitle="还没有教师档案"
			emptyDescription="为教师分配可授课校区后，才能在班级中选择主讲教师。"
			onRetry={onRetry}
			onCreate={onCreate}
		>
			<div className="grid gap-2">
				{teachers.map((item) => (
					<article
						key={item.id}
						className="grid gap-3 border p-3 md:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(0,1fr))_auto] md:items-center"
					>
						<div>
							<p className="font-medium">{item.name}</p>
							<p className="text-muted-foreground text-xs">
								{item.phone ?? "未登记手机号"}
							</p>
						</div>
						<DataCell label="科目" value={item.subjects.join(" · ")} />
						<DataCell
							label="周容量"
							value={`${item.weeklyCapacityHours} 小时`}
						/>
						<DataCell
							label="授课校区"
							value={item.campusIds
								.map((id) => campusNames.get(id) ?? "已移除校区")
								.join(" · ")}
						/>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label={`编辑${item.name}`}
							onClick={() => onEdit(item)}
						>
							<PencilIcon />
						</Button>
					</article>
				))}
			</div>
		</PanelState>
	);
}

function FilterBar({
	campuses,
	campusId,
	onCampusChange,
	children,
}: {
	campuses: Array<{ id: string; name: string }>;
	campusId: string | undefined;
	onCampusChange: (value: string | undefined) => void;
	children?: React.ReactNode;
}) {
	return (
		<section className="flex flex-wrap gap-3 border p-3">
			<FilterSelect
				label="校区"
				value={campusId ?? "all"}
				onValueChange={(value) =>
					onCampusChange(value === "all" ? undefined : value)
				}
				items={[
					{ value: "all", label: "全部校区" },
					...campuses.map((item) => ({ value: item.id, label: item.name })),
				]}
			/>
			{children}
		</section>
	);
}
function FilterSelect({
	label,
	value,
	onValueChange,
	items,
}: {
	label: string;
	value: string;
	onValueChange: (value: string) => void;
	items: Array<{ value: string; label: string }>;
}) {
	return (
		<div className="w-full sm:min-w-44 sm:flex-1">
			<span className="mb-1 block text-muted-foreground text-xs">{label}</span>
			<Select
				value={value}
				onValueChange={(next) => onValueChange(next ?? "all")}
			>
				<SelectTrigger className="w-full sm:w-auto" aria-label={label}>
					<SelectValue>
						{() => items.find((item) => item.value === value)?.label ?? label}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
function PanelState({
	pending,
	error,
	empty,
	emptyTitle,
	emptyDescription,
	onRetry,
	onCreate,
	children,
}: {
	pending: boolean;
	error: boolean;
	empty: boolean;
	emptyTitle: string;
	emptyDescription: string;
	onRetry: () => void;
	onCreate: () => void;
	children: React.ReactNode;
}) {
	if (pending)
		return (
			<div className="grid gap-2">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton className="h-20" key={index} />
				))}
			</div>
		);
	if (error)
		return (
			<Empty className="min-h-64 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CircleAlertIcon />
					</EmptyMedia>
					<EmptyTitle>数据加载失败</EmptyTitle>
					<EmptyDescription>请检查网络后重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onRetry}>重试</Button>
			</Empty>
		);
	if (empty)
		return (
			<Empty className="min-h-64 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SchoolIcon />
					</EmptyMedia>
					<EmptyTitle>{emptyTitle}</EmptyTitle>
					<EmptyDescription>{emptyDescription}</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onCreate}>
					<PlusIcon data-icon="inline-start" />
					新建
				</Button>
			</Empty>
		);
	return <>{children}</>;
}
function DataCell({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground text-xs md:hidden">{label}</p>
			<p className="truncate text-sm">{value}</p>
		</div>
	);
}
function StatusBadge({ status }: { status: string }) {
	const label = statusLabels[status] ?? status;
	const variant =
		status === "cancelled" || status === "inactive" || status === "completed"
			? "outline"
			: status === "paused"
				? "secondary"
				: "default";
	return <Badge variant={variant}>{label}</Badge>;
}

function CoursePowerButton({ course }: { course: Course }) {
	const mutation = useMutation(
		orpc.training.teaching.courses.setActive.mutationOptions({
			onSuccess: () => {
				toast.success(course.isActive ? "课程已停用" : "课程已启用");
				void invalidateAcademicQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			disabled={mutation.isPending}
			aria-label={course.isActive ? `停用${course.name}` : `启用${course.name}`}
			onClick={() =>
				mutation.mutate({ id: course.id, isActive: !course.isActive })
			}
		>
			<PowerIcon />
		</Button>
	);
}

function CourseEditor({
	value,
	onClose,
	onSaved,
}: {
	value: Course | null;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const createMutation = useMutation(
		orpc.training.teaching.courses.create.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.courses.update.mutationOptions(),
	);
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const input = {
			code: text(data, "code"),
			name: text(data, "name"),
			category: text(data, "category") as Course["category"],
			level: text(data, "level"),
			durationMinutes: number(data, "durationMinutes"),
			listPriceInCents: Math.round(number(data, "price") * 100),
			lessonsPerPackage: number(data, "lessonsPerPackage"),
			tags: text(data, "tags")
				.split(/[,，]/u)
				.map((item) => item.trim())
				.filter(Boolean),
		};
		const request = value
			? updateMutation.mutateAsync({ id: value.id, data: input })
			: createMutation.mutateAsync(input);
		void request
			.then(async () => {
				toast.success(value ? "课程已更新" : "课程已创建");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title={value ? "编辑课程" : "新建课程"}
			description="课程停用后不能新建班级或用于新的报名。"
			pending={pending}
			onClose={onClose}
		>
			<form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
				<TextField
					label="课程编码"
					name="code"
					defaultValue={value?.code}
					required
				/>
				<TextField
					label="课程名称"
					name="name"
					defaultValue={value?.name}
					required
				/>
				<SelectField
					label="类别"
					name="category"
					defaultValue={value?.category ?? "language"}
					items={Object.entries(categoryLabels).map(([value, label]) => ({
						value,
						label,
					}))}
				/>
				<TextField
					label="级别"
					name="level"
					defaultValue={value?.level}
					required
				/>
				<TextField
					label="单次时长（分钟）"
					name="durationMinutes"
					type="number"
					defaultValue={value?.durationMinutes ?? 60}
					required
				/>
				<TextField
					label="课包课次"
					name="lessonsPerPackage"
					type="number"
					defaultValue={value?.lessonsPerPackage ?? 12}
					required
				/>
				<TextField
					label="标准价（元）"
					name="price"
					type="number"
					step="0.01"
					defaultValue={
						value ? (value.listPriceInCents / 100).toFixed(2) : "0.00"
					}
					required
				/>
				<TextField
					label="标签（逗号分隔）"
					name="tags"
					defaultValue={value?.tags.join("，")}
				/>
				<DialogFooter className="sm:col-span-2">
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button type="submit" disabled={pending}>
						{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
						保存课程
					</Button>
				</DialogFooter>
			</form>
		</EditorDialog>
	);
}

function TeacherEditor({
	value,
	campuses,
	onClose,
	onSaved,
}: {
	value: Teacher | null;
	campuses: Array<{ id: string; name: string }>;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const createMutation = useMutation(
		orpc.training.teaching.teachers.create.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.teachers.update.mutationOptions(),
	);
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const campusIds = data.getAll("campusId").map(String);
		const input = {
			name: text(data, "name"),
			phone: text(data, "phone") || null,
			subjects: text(data, "subjects")
				.split(/[,，]/u)
				.map((item) => item.trim())
				.filter(Boolean),
			weeklyCapacityHours: number(data, "weeklyCapacityHours"),
			campusIds,
		};
		const request = value
			? updateMutation.mutateAsync({ id: value.id, data: input })
			: createMutation.mutateAsync(input);
		void request
			.then(async () => {
				toast.success(value ? "教师已更新" : "教师已创建");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title={value ? "编辑教师" : "新建教师"}
			description="教师只能被分配到可授课校区的班级。"
			pending={pending}
			onClose={onClose}
		>
			<form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
				<TextField
					label="姓名"
					name="name"
					defaultValue={value?.name}
					required
				/>
				<TextField
					label="手机号（可选）"
					name="phone"
					defaultValue={value?.phone ?? ""}
				/>
				<TextField
					label="任教科目（逗号分隔）"
					name="subjects"
					defaultValue={value?.subjects.join("，")}
					required
				/>
				<TextField
					label="周容量（小时）"
					name="weeklyCapacityHours"
					type="number"
					defaultValue={value?.weeklyCapacityHours ?? 20}
					required
				/>
				<fieldset className="sm:col-span-2">
					<legend className="mb-2 font-medium text-sm">可授课校区</legend>
					<div className="grid gap-2 sm:grid-cols-2">
						{campuses.map((campus) => (
							<label
								key={campus.id}
								className="flex items-center gap-2 border p-2 text-sm"
							>
								<input
									type="checkbox"
									name="campusId"
									value={campus.id}
									defaultChecked={value?.campusIds.includes(campus.id)}
								/>
								{campus.name}
							</label>
						))}
					</div>
				</fieldset>
				<DialogFooter className="sm:col-span-2">
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button type="submit" disabled={pending}>
						保存教师
					</Button>
				</DialogFooter>
			</form>
		</EditorDialog>
	);
}

function ClassEditor({
	value,
	campuses,
	courses,
	teachers,
	onClose,
	onSaved,
}: {
	value: ClassGroup | null;
	campuses: Array<{ id: string; name: string }>;
	courses: Course[];
	teachers: Teacher[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const createMutation = useMutation(
		orpc.training.teaching.classes.create.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.classes.update.mutationOptions(),
	);
	const pending = createMutation.isPending || updateMutation.isPending;
	const [selectedCampusId, setSelectedCampusId] = useState(
		value?.campusId ?? campuses[0]?.id ?? "",
	);
	const eligibleTeachers = teachers.filter((item) =>
		item.campusIds.includes(selectedCampusId),
	);
	const locked = Boolean(
		value && (value.enrollmentCount > 0 || value.scheduleText !== "排课待定"),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const input = {
			name: text(data, "name"),
			campusId: text(data, "campusId"),
			courseId: text(data, "courseId"),
			teacherId: text(data, "teacherId"),
			capacity: number(data, "capacity"),
			status: text(data, "status") as ClassGroup["status"],
			startDate: text(data, "startDate"),
		};
		const request = value
			? updateMutation.mutateAsync({ id: value.id, data: input })
			: createMutation.mutateAsync(input);
		void request
			.then(async () => {
				toast.success(value ? "班级已更新" : "班级已创建");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title={value ? "编辑班级" : "新建班级"}
			description={
				locked
					? "已有报名或课次时不能变更课程与校区。"
					: "班级需绑定启用课程、校区和主讲教师。"
			}
			pending={pending}
			onClose={onClose}
		>
			<form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
				<TextField
					label="班级名称"
					name="name"
					defaultValue={value?.name}
					required
				/>
				<SelectField
					label="班级状态"
					name="status"
					defaultValue={value?.status ?? "recruiting"}
					items={classStatuses}
				/>
				<SelectField
					label="校区"
					name="campusId"
					defaultValue={selectedCampusId}
					onValueChange={setSelectedCampusId}
					disabled={locked}
					items={campuses.map((item) => ({ value: item.id, label: item.name }))}
				/>
				<SelectField
					label="课程"
					name="courseId"
					defaultValue={value?.courseId ?? courses[0]?.id ?? ""}
					disabled={locked}
					items={courses.map((item) => ({
						value: item.id,
						label: `${item.name} · ${item.durationMinutes} 分钟`,
					}))}
				/>
				<SelectField
					label="主讲教师"
					name="teacherId"
					defaultValue={value?.teacherId ?? eligibleTeachers[0]?.id ?? ""}
					items={eligibleTeachers.map((item) => ({
						value: item.id,
						label: item.name,
					}))}
				/>
				<TextField
					label="容量"
					name="capacity"
					type="number"
					defaultValue={value?.capacity ?? 20}
					required
				/>
				<TextField
					label="开班日期"
					name="startDate"
					type="date"
					defaultValue={value?.startDate}
					required
				/>
				<DialogFooter className="sm:col-span-2">
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button
						type="submit"
						disabled={
							pending || courses.length === 0 || eligibleTeachers.length === 0
						}
					>
						保存班级
					</Button>
				</DialogFooter>
			</form>
			{eligibleTeachers.length === 0 ? (
				<p className="text-destructive text-xs">
					所选校区没有可授课教师，请先维护教师档案。
				</p>
			) : null}
		</EditorDialog>
	);
}

function LessonEditor({
	defaultClass,
	classes,
	onClose,
	onSaved,
}: {
	defaultClass: ClassGroup | null;
	classes: ClassGroup[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const mutation = useMutation(
		orpc.training.teaching.lessons.create.mutationOptions(),
	);
	const [classId, setClassId] = useState(
		defaultClass?.id ??
			classes.find(
				(item) => item.status === "recruiting" || item.status === "running",
			)?.id ??
			"",
	);
	const selected = classes.find((item) => item.id === classId);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const startsAt = toShanghaiIso(text(data, "startsAt"));
		const endsAt = toShanghaiIso(text(data, "endsAt"));
		if (!startsAt || !endsAt) {
			toast.error("请填写有效的课次时间");
			return;
		}
		void mutation
			.mutateAsync({
				classGroupId: classId,
				room: text(data, "room"),
				startsAt,
				endsAt,
			})
			.then(async () => {
				toast.success("课次已排入课表");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title="新增课次"
			description="课次继承班级的校区与主讲教师；变更请取消后重新创建。"
			pending={mutation.isPending}
			onClose={onClose}
		>
			<form className="grid gap-3" onSubmit={submit}>
				<SelectField
					label="班级"
					name="classGroupId"
					defaultValue={classId}
					onValueChange={setClassId}
					items={classes
						.filter(
							(item) =>
								item.status === "recruiting" || item.status === "running",
						)
						.map((item) => ({
							value: item.id,
							label: `${item.name} · ${item.courseName}`,
						}))}
				/>
				{selected ? (
					<div className="grid gap-1 border bg-muted/30 p-3 text-sm">
						<p>
							{selected.campusName} · {selected.teacherName}
						</p>
						<p className="text-muted-foreground text-xs">
							标准时长 {selected.courseName} 以服务端规则为准
						</p>
					</div>
				) : null}
				<div className="grid gap-3 sm:grid-cols-2">
					<TextField
						label="开始时间"
						name="startsAt"
						type="datetime-local"
						required
					/>
					<TextField
						label="结束时间"
						name="endsAt"
						type="datetime-local"
						required
					/>
				</div>
				<TextField label="教室" name="room" placeholder="例如 A201" required />
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button type="submit" disabled={mutation.isPending || !selected}>
						创建课次
					</Button>
				</DialogFooter>
			</form>
		</EditorDialog>
	);
}

function CancelLessonDialog({
	lesson,
	onClose,
	onSaved,
}: {
	lesson: Lesson;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const mutation = useMutation(
		orpc.training.teaching.lessons.cancel.mutationOptions(),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		void mutation
			.mutateAsync({ id: lesson.id, reason: text(data, "reason") || null })
			.then(async () => {
				toast.success("课次已取消");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title="取消课次"
			description={`${lesson.className} · ${formatDateTime(lesson.startsAt)} · ${lesson.campusName} ${lesson.room}`}
			pending={mutation.isPending}
			onClose={onClose}
		>
			<form className="grid gap-3" onSubmit={submit}>
				<TextField label="取消原因（可选）" name="reason" />
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={mutation.isPending}
						onClick={onClose}
					>
						返回
					</Button>
					<Button
						type="submit"
						variant="destructive"
						disabled={mutation.isPending}
					>
						确认取消
					</Button>
				</DialogFooter>
			</form>
		</EditorDialog>
	);
}

function EditorDialog({
	title,
	description,
	pending,
	onClose,
	children,
}: {
	title: string;
	description: string;
	pending: boolean;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	);
}
function TextField({
	label,
	name,
	defaultValue,
	type = "text",
	required,
	step,
	placeholder,
}: {
	label: string;
	name: string;
	defaultValue?: string | number;
	type?: string;
	required?: boolean;
	step?: string;
	placeholder?: string;
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Input
				name={name}
				type={type}
				defaultValue={defaultValue}
				required={required}
				step={step}
				placeholder={placeholder}
			/>
		</Field>
	);
}
function SelectField({
	label,
	name,
	defaultValue,
	items,
	onValueChange,
	disabled,
}: {
	label: string;
	name: string;
	defaultValue: string;
	items: Array<{ value: string; label: string }>;
	onValueChange?: (value: string) => void;
	disabled?: boolean;
}) {
	const [value, setValue] = useState(defaultValue);
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Select
				value={value}
				onValueChange={(next) => {
					if (next !== null) {
						setValue(next);
						onValueChange?.(next);
					}
				}}
				disabled={disabled}
			>
				<SelectTrigger>
					<SelectValue placeholder={`选择${label}`}>
						{() =>
							items.find((item) => item.value === value)?.label ??
							`选择${label}`
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<input type="hidden" name={name} value={value} />
		</Field>
	);
}
function text(data: FormData, name: string) {
	return String(data.get(name) ?? "").trim();
}
function number(data: FormData, name: string) {
	return Number(text(data, name));
}
function toShanghaiIso(value: string) {
	if (!value) return null;
	const date = new Date(`${value}:00+08:00`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const categoryLabels: Record<Course["category"], string> = {
	language: "语言",
	stem: "科学",
	art: "艺术",
	exam: "应试",
	sports: "运动",
};
const classStatuses: Array<{
	value: ClassGroup["status"] | "all";
	label: string;
}> = [
	{ value: "recruiting", label: "招生中" },
	{ value: "running", label: "进行中" },
	{ value: "paused", label: "已暂停" },
	{ value: "completed", label: "已结课" },
];
const statusLabels: Record<string, string> = {
	recruiting: "招生中",
	running: "进行中",
	paused: "已暂停",
	completed: "已结课",
	scheduled: "已排课",
	cancelled: "已取消",
	active: "已启用",
	inactive: "已停用",
};
