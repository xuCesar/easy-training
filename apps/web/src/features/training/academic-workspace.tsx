import type {
	BindableTeacherMember,
	ClassEnrollment,
	ClassGroup,
	Classroom,
	Course,
	Lesson,
	LessonAttendance,
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
	ClipboardCheckIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	PowerIcon,
	SchoolIcon,
	UsersRoundIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import { BulkRescheduleDialog } from "./bulk-reschedule-dialog";
import { ClassPauseDialog } from "./class-pause-dialog";
import { formatCentsToCurrency, formatDateTime } from "./format";
import { MakeupLessonDialog } from "./makeup-lesson-dialog";
import { RoomsPanel } from "./rooms-panel";
import { ScheduleRulesDialog } from "./schedule-rules-dialog";

type AcademicTab = "classes" | "lessons" | "rooms" | "courses" | "teachers";
type Editor =
	| { kind: "course"; value: Course | null }
	| { kind: "teacher"; value: Teacher | null }
	| { kind: "class"; value: ClassGroup | null }
	| { kind: "lesson"; value: ClassGroup | null }
	| null;

const tabs: Array<{ id: AcademicTab; label: string }> = [
	{ id: "classes", label: "班级" },
	{ id: "lessons", label: "课次" },
	{ id: "rooms", label: "教室" },
	{ id: "courses", label: "课程" },
	{ id: "teachers", label: "教师" },
];

export function AcademicWorkspace({
	initialTab,
	initialLessonId,
	organizationId,
	sessionUserId,
	role,
}: {
	initialTab: AcademicTab;
	initialLessonId?: string;
	organizationId: string;
	sessionUserId: string | undefined;
	role: string;
}) {
	const [editor, setEditor] = useState<Editor>(null);
	const [cancelTarget, setCancelTarget] = useState<Lesson | null>(null);
	const [classMembersTarget, setClassMembersTarget] =
		useState<ClassGroup | null>(null);
	const [attendanceTarget, setAttendanceTarget] = useState<Lesson | null>(null);
	const [makeupSourceLesson, setMakeupSourceLesson] = useState<Lesson | null>(
		null,
	);
	const [scheduleRulesTarget, setScheduleRulesTarget] =
		useState<ClassGroup | null>(null);
	const [bulkRescheduleTarget, setBulkRescheduleTarget] = useState<
		Lesson[] | null
	>(null);
	const [classStatusTarget, setClassStatusTarget] = useState<{
		classGroup: ClassGroup;
		action: "pause" | "resume";
	} | null>(null);
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
	const classroomsOptions = orpc.training.teaching.classrooms.list.queryOptions(
		{
			input: { includeInactive: true },
		},
	);
	const bindableTeacherMembersOptions =
		orpc.training.teaching.teachers.bindableMembers.queryOptions();
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
	const classroomsQuery = useQuery({
		...classroomsOptions,
		queryKey: [...classroomsOptions.queryKey, context],
	});
	const bindableTeacherMembersQuery = useQuery({
		...bindableTeacherMembersOptions,
		queryKey: [...bindableTeacherMembersOptions.queryKey, context],
		enabled: canManageCatalog,
	});
	const classesQuery = useQuery({
		...classesOptions,
		queryKey: [...classesOptions.queryKey, context, classesInput],
	});
	const lessonsQuery = useQuery({
		...lessonsOptions,
		queryKey: [...lessonsOptions.queryKey, context, { campusId }],
	});
	useEffect(() => {
		if (!initialLessonId || initialTab !== "lessons" || lessonsQuery.isPending)
			return;
		document
			.getElementById(`lesson-${initialLessonId}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [initialLessonId, initialTab, lessonsQuery.isPending]);

	function refresh() {
		return invalidateAcademicQueries();
	}
	const createAction =
		initialTab === "lessons"
			? {
					label: "新增课次",
					onClick: () => setEditor({ kind: "lesson", value: null }),
				}
			: initialTab === "rooms"
				? null
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
				{createAction ? (
					<Button onClick={createAction.onClick}>
						<PlusIcon data-icon="inline-start" /> {createAction.label}
					</Button>
				) : null}
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
					lessons={lessonsQuery.data?.items ?? []}
					isLessonsPending={lessonsQuery.isPending}
					isPending={classesQuery.isPending}
					isError={classesQuery.isError}
					campusId={campusId}
					status={classStatus}
					onCampusChange={setCampusId}
					onStatusChange={setClassStatus}
					onEdit={(value) => setEditor({ kind: "class", value })}
					onSchedule={(value) => setEditor({ kind: "lesson", value })}
					onManageMembers={setClassMembersTarget}
					onChangeStatus={(classGroup, action) =>
						setClassStatusTarget({ classGroup, action })
					}
					onCreate={() => setEditor({ kind: "class", value: null })}
					onRetry={() => void classesQuery.refetch()}
				/>
			) : null}
			{initialTab === "rooms" ? (
				<RoomsPanel
					campuses={campusesQuery.data?.items ?? []}
					rooms={classroomsQuery.data?.items ?? []}
					isPending={classroomsQuery.isPending}
					isError={classroomsQuery.isError}
					onRetry={() => void classroomsQuery.refetch()}
					onSaved={refresh}
				/>
			) : null}
			{initialTab === "lessons" ? (
				<LessonsPanel
					campuses={campusesQuery.data?.items ?? []}
					lessons={lessonsQuery.data?.items ?? []}
					isPending={lessonsQuery.isPending}
					isError={lessonsQuery.isError}
					campusId={campusId}
					highlightedLessonId={initialLessonId}
					onCampusChange={setCampusId}
					onSchedule={() => setEditor({ kind: "lesson", value: null })}
					onCancel={setCancelTarget}
					onTakeAttendance={setAttendanceTarget}
					onBulkReschedule={setBulkRescheduleTarget}
					onArrangeMakeup={setMakeupSourceLesson}
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
					bindableMembers={bindableTeacherMembersQuery.data?.items ?? []}
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
					classrooms={classroomsQuery.data?.items ?? []}
					onClose={() => setEditor(null)}
					onSaved={refresh}
					onStartRecurring={(classGroup) => {
						setEditor(null);
						setScheduleRulesTarget(classGroup);
					}}
				/>
			) : null}
			{cancelTarget ? (
				<CancelLessonDialog
					lesson={cancelTarget}
					onClose={() => setCancelTarget(null)}
					onSaved={refresh}
				/>
			) : null}
			{classMembersTarget ? (
				<ClassMembersDialog
					classGroup={classMembersTarget}
					onClose={() => setClassMembersTarget(null)}
					onSaved={refresh}
				/>
			) : null}
			{attendanceTarget ? (
				<LessonAttendanceDialog
					lesson={attendanceTarget}
					onClose={() => setAttendanceTarget(null)}
					onSaved={refresh}
				/>
			) : null}
			{makeupSourceLesson ? (
				<MakeupLessonDialog
					sourceLesson={makeupSourceLesson}
					lessons={lessonsQuery.data?.items ?? []}
					onClose={() => setMakeupSourceLesson(null)}
					onSaved={refresh}
				/>
			) : null}
			{scheduleRulesTarget ? (
				<ScheduleRulesDialog
					classGroup={scheduleRulesTarget}
					classrooms={classroomsQuery.data?.items ?? []}
					onClose={() => setScheduleRulesTarget(null)}
					onSaved={refresh}
				/>
			) : null}
			{bulkRescheduleTarget ? (
				<BulkRescheduleDialog
					lessons={bulkRescheduleTarget}
					teachers={teachersQuery.data?.items ?? []}
					classrooms={classroomsQuery.data?.items ?? []}
					onClose={() => setBulkRescheduleTarget(null)}
					onSaved={refresh}
				/>
			) : null}
			{classStatusTarget ? (
				<ClassPauseDialog
					classGroup={classStatusTarget.classGroup}
					action={classStatusTarget.action}
					onClose={() => setClassStatusTarget(null)}
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
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.enrollments.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.lessons.attendance.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classrooms.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.makeups.list.key(),
		}),
	]);
}

function ClassesPanel({
	campuses,
	classes,
	lessons,
	isLessonsPending,
	isPending,
	isError,
	campusId,
	status,
	onCampusChange,
	onStatusChange,
	onEdit,
	onSchedule,
	onManageMembers,
	onChangeStatus,
	onCreate,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	classes: ClassGroup[];
	lessons: Lesson[];
	isLessonsPending: boolean;
	isPending: boolean;
	isError: boolean;
	campusId: string | undefined;
	status: string;
	onCampusChange: (value: string | undefined) => void;
	onStatusChange: (value: string) => void;
	onEdit: (item: ClassGroup) => void;
	onSchedule: (item: ClassGroup) => void;
	onManageMembers: (item: ClassGroup) => void;
	onChangeStatus: (item: ClassGroup, action: "pause" | "resume") => void;
	onCreate: () => void;
	onRetry: () => void;
}) {
	const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
	const now = new Date();
	const lessonsByClassId = new Map<string, Lesson[]>();
	for (const item of lessons) {
		const current = lessonsByClassId.get(item.classGroupId) ?? [];
		current.push(item);
		lessonsByClassId.set(item.classGroupId, current);
	}

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
					{classes.map((item) => {
						const classLessons = lessonsByClassId.get(item.id) ?? [];
						const scheduledLessons = classLessons.filter(
							(lesson) => lesson.status === "scheduled",
						);
						const futureLessons = scheduledLessons
							.filter((lesson) => new Date(lesson.startsAt) > now)
							.sort(
								(left, right) =>
									new Date(left.startsAt).getTime() -
									new Date(right.startsAt).getTime(),
							);
						const visibleFutureLessons = futureLessons.slice(0, 3);
						const isExpanded = expandedClassId === item.id;
						return (
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
									{isLessonsPending ? (
										<p className="mt-1 text-muted-foreground text-xs">
											课次加载中…
										</p>
									) : (
										<button
											type="button"
											className="mt-1 max-w-full cursor-pointer text-left text-muted-foreground text-xs hover:text-foreground"
											onClick={() =>
												setExpandedClassId((current) =>
													current === item.id ? null : item.id,
												)
											}
											aria-expanded={isExpanded}
											aria-controls={`class-lessons-${item.id}`}
										>
											已排 {scheduledLessons.length} 节
											{futureLessons[0]
												? ` · 下次 ${formatDateTime(futureLessons[0].startsAt)}`
												: ""}
										</button>
									)}
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
										size="icon-sm"
										variant="ghost"
										aria-label={`管理${item.name}成员`}
										onClick={() => onManageMembers(item)}
									>
										<UsersRoundIcon />
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
									{item.status === "running" || item.status === "paused" ? (
										<Button
											size="sm"
											variant={
												item.status === "running" ? "destructive" : "outline"
											}
											onClick={() =>
												onChangeStatus(
													item,
													item.status === "running" ? "pause" : "resume",
												)
											}
										>
											<PowerIcon />{" "}
											{item.status === "running" ? "停课" : "复课"}
										</Button>
									) : null}
								</div>
								{isExpanded ? (
									<div
										id={`class-lessons-${item.id}`}
										className="grid gap-2 border-t pt-3 md:col-span-full"
									>
										<div className="flex items-center justify-between gap-2">
											<p className="font-medium text-sm">未来待上课次</p>
											<p className="text-muted-foreground text-xs">
												共 {futureLessons.length} 节，显示最近{" "}
												{visibleFutureLessons.length} 节
											</p>
										</div>
										{visibleFutureLessons.length === 0 ? (
											<p className="text-muted-foreground text-sm">
												暂无未来待上课次
											</p>
										) : (
											visibleFutureLessons.map((lesson) => (
												<div
													key={lesson.id}
													className="grid gap-1 border p-2 text-sm sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_auto] sm:items-center"
												>
													<p className="font-medium">
														{formatDateTime(lesson.startsAt)}
													</p>
													<p className="text-muted-foreground text-xs">
														{lesson.teacherName} · {lesson.room}
													</p>
													<StatusBadge status={lesson.status} />
												</div>
											))
										)}
									</div>
								) : null}
							</article>
						);
					})}
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
	highlightedLessonId,
	onCampusChange,
	onSchedule,
	onCancel,
	onTakeAttendance,
	onBulkReschedule,
	onArrangeMakeup,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	lessons: Lesson[];
	isPending: boolean;
	isError: boolean;
	campusId: string | undefined;
	highlightedLessonId?: string;
	onCampusChange: (value: string | undefined) => void;
	onSchedule: () => void;
	onCancel: (item: Lesson) => void;
	onTakeAttendance: (item: Lesson) => void;
	onBulkReschedule: (items: Lesson[]) => void;
	onArrangeMakeup: (item: Lesson) => void;
	onRetry: () => void;
}) {
	const scheduled = lessons.filter((item) => item.status === "scheduled");
	const future = scheduled.filter(
		(item) =>
			new Date(item.startsAt) > new Date() && item.classStatus !== "paused",
	);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const selected = future.filter((item) => selectedIds.includes(item.id));
	return (
		<>
			<FilterBar
				campuses={campuses}
				campusId={campusId}
				onCampusChange={onCampusChange}
			>
				<div className="flex w-full flex-wrap items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
					<p className="flex h-10 items-center border px-3 text-muted-foreground text-xs">
						<span className="font-medium text-foreground">
							已排 {scheduled.length} 节
						</span>
						<span className="ml-2">取消课次仍保留审计记录。</span>
					</p>
					<Button
						size="sm"
						variant="outline"
						className="h-10"
						disabled={selected.length === 0}
						onClick={() => onBulkReschedule(selected)}
					>
						批量调课（{selected.length}）
					</Button>
				</div>
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
							id={`lesson-${item.id}`}
							className={`grid gap-3 border p-3 md:grid-cols-[10rem_minmax(12rem,1fr)_repeat(3,minmax(0,1fr))_auto] md:items-center ${highlightedLessonId === item.id ? "border-primary ring-2 ring-primary/30" : ""}`}
						>
							<label className="flex items-center gap-2 text-xs md:col-span-full">
								<input
									type="checkbox"
									checked={selectedIds.includes(item.id)}
									disabled={!future.some((lesson) => lesson.id === item.id)}
									onChange={(event) =>
										setSelectedIds((current) =>
											event.target.checked
												? [...current, item.id]
												: current.filter((id) => id !== item.id),
										)
									}
								/>
								选择未来课次
							</label>
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
								{item.classStatus === "paused" ? (
									<p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
										{item.pausedOverdue
											? "班级暂停中，该课次已过期，需恢复后重新安排"
											: "班级暂停中，课次操作已冻结"}
									</p>
								) : null}
								{item.cancellationReason ? (
									<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
										{item.cancellationReason}
									</p>
								) : null}
							</div>
							<div className="hidden md:block" />
							<div className="flex flex-wrap gap-1">
								{item.status === "scheduled" &&
								item.classStatus !== "paused" ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onTakeAttendance(item)}
									>
										<ClipboardCheckIcon data-icon="inline-start" />
										点名结课
									</Button>
								) : null}
								{item.status === "completed" ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onArrangeMakeup(item)}
									>
										安排补课
									</Button>
								) : null}
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
		<div className="w-full sm:w-44">
			<span className="mb-1 block text-muted-foreground text-xs">{label}</span>
			<Select
				value={value}
				onValueChange={(next) => onValueChange(next ?? "all")}
			>
				<SelectTrigger className="h-10 w-full sm:w-auto" aria-label={label}>
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

function getAffectedLessons(error: unknown): Array<{
	className: string;
	startsAt: string;
	roomName: string;
	occupancy: number;
	capacity: number;
}> {
	if (!error || typeof error !== "object") return [];
	const data = (error as { data?: unknown }).data;
	if (!data || typeof data !== "object") return [];
	const values = (data as { affectedLessons?: unknown }).affectedLessons;
	if (!Array.isArray(values)) return [];
	return values.filter(
		(
			value,
		): value is {
			className: string;
			startsAt: string;
			roomName: string;
			occupancy: number;
			capacity: number;
		} =>
			Boolean(
				value &&
					typeof value === "object" &&
					typeof (value as { className?: unknown }).className === "string" &&
					typeof (value as { startsAt?: unknown }).startsAt === "string" &&
					typeof (value as { roomName?: unknown }).roomName === "string" &&
					typeof (value as { occupancy?: unknown }).occupancy === "number" &&
					typeof (value as { capacity?: unknown }).capacity === "number",
			),
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
	bindableMembers,
	onClose,
	onSaved,
}: {
	value: Teacher | null;
	campuses: Array<{ id: string; name: string }>;
	bindableMembers: BindableTeacherMember[];
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
		const boundUserId = text(data, "boundUserId");
		const input = {
			name: text(data, "name"),
			phone: text(data, "phone") || null,
			subjects: text(data, "subjects")
				.split(/[,，]/u)
				.map((item) => item.trim())
				.filter(Boolean),
			weeklyCapacityHours: number(data, "weeklyCapacityHours"),
			campusIds,
			boundUserId: boundUserId === "unbound" ? null : boundUserId,
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
				<SelectField
					label="绑定教师账号（可选）"
					name="boundUserId"
					defaultValue={value?.userId ?? "unbound"}
					items={[
						{ value: "unbound", label: "暂不绑定" },
						...bindableMembers
							.filter(
								(item) =>
									item.boundTeacherId === null ||
									item.boundTeacherId === value?.id,
							)
							.map((item) => ({
								value: item.userId,
								label: `${item.name} · ${item.email}`,
							})),
					]}
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
			startDate: text(data, "startDate"),
		};
		const request = value
			? updateMutation.mutateAsync({
					id: value.id,
					data: {
						...input,
						status: text(data, "status") as ClassGroup["status"],
					},
				})
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
				{value ? (
					<div className="grid gap-1">
						<SelectField
							label="班级状态"
							name="status"
							defaultValue={value.status}
							items={getEditableClassStatuses(value.status)}
						/>
						<p className="text-muted-foreground text-xs">
							停课与复课请从班级列表使用专用操作。
						</p>
					</div>
				) : null}
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
	classrooms,
	onClose,
	onSaved,
	onStartRecurring,
}: {
	defaultClass: ClassGroup | null;
	classes: ClassGroup[];
	classrooms: Classroom[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
	onStartRecurring: (classGroup: ClassGroup) => void;
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
	const [scheduleMode, setScheduleMode] = useState<"single" | "recurring">(
		"single",
	);
	const selected = classes.find((item) => item.id === classId);
	const eligibleRooms = classrooms.filter(
		(item) => item.isActive && item.campusId === selected?.campusId,
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const startsAt = toShanghaiIso(text(data, "startsAt"));
		const endsAt = toShanghaiIso(text(data, "endsAt"));
		const roomId = text(data, "roomId");
		const room = eligibleRooms.find((item) => item.id === roomId);
		if (!startsAt || !endsAt) {
			toast.error("请填写有效的课次时间");
			return;
		}
		if (!room) {
			toast.error("请选择启用中的教室");
			return;
		}
		void mutation
			.mutateAsync({
				classGroupId: classId,
				room: room.name,
				roomId: room.id,
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
			title="排课"
			description={
				scheduleMode === "single"
					? "单次排课用于临时加课；课次继承班级的校区与主讲教师。"
					: "周期排课会先维护每周规则，再预览、调节冲突并批量生成课次。"
			}
			pending={mutation.isPending}
			onClose={onClose}
		>
			<div className="inline-flex w-full rounded-md border p-1 sm:w-auto">
				<Button
					size="sm"
					variant={scheduleMode === "single" ? "default" : "ghost"}
					onClick={() => setScheduleMode("single")}
				>
					单次排课
				</Button>
				<Button
					size="sm"
					variant={scheduleMode === "recurring" ? "default" : "ghost"}
					onClick={() => setScheduleMode("recurring")}
				>
					周期排课
				</Button>
			</div>
			{scheduleMode === "single" ? (
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
					<SelectField
						key={selected?.campusId ?? "no-campus"}
						label="教室"
						name="roomId"
						defaultValue={eligibleRooms[0]?.id ?? ""}
						items={eligibleRooms.map((item) => ({
							value: item.id,
							label: `${item.name} · ${item.capacity} 人`,
						}))}
					/>
					{selected && eligibleRooms.length === 0 ? (
						<p className="text-destructive text-xs">
							所选校区没有启用中的教室，请先维护教室资源。
						</p>
					) : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							取消
						</Button>
						<Button
							type="submit"
							disabled={
								mutation.isPending || !selected || eligibleRooms.length === 0
							}
						>
							创建课次
						</Button>
					</DialogFooter>
				</form>
			) : (
				<div className="grid gap-3">
					<SelectField
						label="班级"
						name="recurringClassGroupId"
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
								可在下一步创建、修改或停用周期规则，并先预览冲突。
							</p>
						</div>
					) : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							取消
						</Button>
						<Button
							type="button"
							disabled={!selected}
							onClick={() => selected && onStartRecurring(selected)}
						>
							进入周期排课
						</Button>
					</DialogFooter>
				</div>
			)}
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

function ClassMembersDialog({
	classGroup,
	onClose,
	onSaved,
}: {
	classGroup: ClassGroup;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const options = orpc.training.teaching.classes.enrollments.queryOptions({
		input: { id: classGroup.id },
	});
	const query = useQuery(options);
	const mutation = useMutation(
		orpc.training.enrollments.lifecycle.mutationOptions(),
	);
	const [pendingAction, setPendingAction] = useState<{
		item: ClassEnrollment;
		kind: "freeze" | "resume" | "withdrawClass" | "assignClass";
	} | null>(null);
	const [reason, setReason] = useState("");
	const items = query.data?.items ?? [];
	const members = items.filter((item) => item.classGroupId === classGroup.id);
	const candidates = items.filter(
		(item) => item.classGroupId !== classGroup.id,
	);
	const canAssign =
		classGroup.status === "recruiting" || classGroup.status === "running";
	function requestAction(
		item: ClassEnrollment,
		kind: "freeze" | "resume" | "withdrawClass" | "assignClass",
	) {
		setReason("");
		setPendingAction({ item, kind });
	}
	function submitAction() {
		if (!pendingAction) return;
		const { item, kind } = pendingAction;
		if (kind !== "assignClass" && !reason.trim()) return;
		const action =
			kind === "assignClass"
				? { kind, classGroupId: classGroup.id }
				: { kind, reason: reason.trim() };
		void mutation
			.mutateAsync({
				enrollmentId: item.enrollmentId,
				expectedVersion: item.version,
				requestId: crypto.randomUUID(),
				action,
			})
			.then(async () => {
				toast.success(
					kind === "freeze"
						? "报名已冻结，仅影响之后的待上课次"
						: kind === "resume"
							? "报名已复课，仅从现在之后的课次恢复"
							: kind === "withdrawClass"
								? "已退班，报名与剩余课时保持不变"
								: "已更新后续课次的班级归属",
				);
				setPendingAction(null);
				await onSaved();
			})
			.catch((error: Error) => {
				const affectedLessons = getAffectedLessons(error);
				toast.error(error.message, {
					description: affectedLessons.length
						? `${affectedLessons
								.slice(0, 2)
								.map(
									(lesson) =>
										`${lesson.className} · ${formatDateTime(lesson.startsAt)} · ${lesson.roomName}（${lesson.occupancy}/${lesson.capacity} 人）`,
								)
								.join("；")}。请先到课次管理调课或取消。`
						: undefined,
				});
			});
	}
	const pendingReasonRequired = pendingAction?.kind !== "assignClass";
	const actionTitle =
		pendingAction?.kind === "freeze"
			? "冻结报名"
			: pendingAction?.kind === "resume"
				? "复课"
				: pendingAction?.kind === "withdrawClass"
					? "确认退班"
					: "确认分班";
	return (
		<EditorDialog
			title={`成员管理 · ${classGroup.name}`}
			description={`${classGroup.courseName} · ${classGroup.campusName} · ${classGroup.enrollmentCount}/${classGroup.capacity} 人`}
			pending={mutation.isPending}
			onClose={onClose}
		>
			{query.isPending ? (
				<div className="grid gap-2">
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
				</div>
			) : null}
			{query.isError ? (
				<div className="grid gap-3 border p-3 text-sm">
					<p>成员数据加载失败。</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						重试
					</Button>
				</div>
			) : null}
			{!query.isPending && !query.isError ? (
				<div className="grid gap-5">
					<MemberList
						title="当前成员"
						items={members}
						empty="当前班级还没有学员。"
						actionLabel="移出"
						disabled={mutation.isPending}
						onAction={(item) => requestAction(item, "withdrawClass")}
						secondaryAction={(item) =>
							item.status === "frozen"
								? {
										label: "复课",
										onAction: () => requestAction(item, "resume"),
									}
								: {
										label: "冻结",
										onAction: () => requestAction(item, "freeze"),
									}
						}
					/>
					<MemberList
						title="可入班报名"
						items={candidates}
						empty={
							canAssign
								? "没有同课程、同校区的可入班报名。"
								: "当前班级状态不允许新增成员。"
						}
						actionLabel="入班"
						disabled={mutation.isPending || !canAssign}
						onAction={(item) => requestAction(item, "assignClass")}
					/>
				</div>
			) : null}
			<Dialog
				open={pendingAction !== null}
				onOpenChange={(open) =>
					!open && !mutation.isPending && setPendingAction(null)
				}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{actionTitle}</DialogTitle>
						<DialogDescription>
							{pendingAction?.kind === "assignClass"
								? "仅更新此刻之后的待上课次；历史考勤、课消和收款不会改变。"
								: "本操作只影响此刻之后的待上课次，不会改写已完成课次、考勤、课消或收款。"}
						</DialogDescription>
					</DialogHeader>
					{pendingReasonRequired ? (
						<Field>
							<FieldLabel htmlFor="enrollment-lifecycle-reason">
								操作原因
							</FieldLabel>
							<Input
								id="enrollment-lifecycle-reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								maxLength={500}
								placeholder="请填写原因"
							/>
						</Field>
					) : null}
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => setPendingAction(null)}
						>
							取消
						</Button>
						<Button
							disabled={
								mutation.isPending || (pendingReasonRequired && !reason.trim())
							}
							onClick={submitAction}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							确认
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</EditorDialog>
	);
}

function MemberList({
	title,
	items,
	empty,
	actionLabel,
	disabled,
	onAction,
	secondaryAction,
}: {
	title: string;
	items: ClassEnrollment[];
	empty: string;
	actionLabel: string;
	disabled: boolean;
	onAction: (item: ClassEnrollment) => void;
	secondaryAction?: (item: ClassEnrollment) => {
		label: string;
		onAction: () => void;
	};
}) {
	return (
		<section className="grid gap-2">
			<h3 className="font-medium text-sm">{title}</h3>
			{items.length === 0 ? (
				<p className="border p-3 text-muted-foreground text-sm">{empty}</p>
			) : (
				<div className="grid gap-2">
					{items.map((item) => (
						<div
							key={item.enrollmentId}
							className="flex items-center justify-between gap-3 border p-3"
						>
							<div className="min-w-0">
								<p className="truncate text-sm">{item.studentName}</p>
								<p className="truncate text-muted-foreground text-xs">
									剩余 {item.remainingLessons} 课时
									{item.className ? ` · 当前：${item.className}` : ""}
								</p>
							</div>
							<div className="flex shrink-0 gap-2">
								{secondaryAction ? (
									<Button
										size="sm"
										variant="outline"
										disabled={disabled}
										onClick={() => secondaryAction(item).onAction()}
									>
										{secondaryAction(item).label}
									</Button>
								) : null}
								<Button
									size="sm"
									variant={actionLabel === "移出" ? "outline" : "default"}
									disabled={
										disabled ||
										(actionLabel === "入班" && item.status === "frozen")
									}
									onClick={() => onAction(item)}
								>
									{actionLabel}
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function LessonAttendanceDialog({
	lesson,
	onClose,
	onSaved,
}: {
	lesson: Lesson;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const options = orpc.training.teaching.lessons.attendance.queryOptions({
		input: { id: lesson.id },
	});
	const query = useQuery(options);
	return (
		<EditorDialog
			title="点名并结课"
			description={`${lesson.className} · ${formatDateTime(lesson.startsAt)} · 到课和迟到各扣 1 课时。`}
			pending={false}
			onClose={onClose}
		>
			{query.isPending ? (
				<div className="grid gap-2">
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
				</div>
			) : null}
			{query.isError ? (
				<div className="grid gap-3 border p-3 text-sm">
					<p>点名名单加载失败。</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						重试
					</Button>
				</div>
			) : null}
			{query.data ? (
				<LessonAttendanceForm
					data={query.data}
					onClose={onClose}
					onSaved={onSaved}
				/>
			) : null}
		</EditorDialog>
	);
}

function LessonAttendanceForm({
	data,
	onClose,
	onSaved,
}: {
	data: LessonAttendance;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const mutation = useMutation(
		orpc.training.teaching.lessons.complete.mutationOptions(),
	);
	const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(
		() =>
			Object.fromEntries(
				data.members.map((item) => [
					item.enrollmentId,
					item.status ?? "present",
				]),
			),
	);
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		void mutation
			.mutateAsync({
				id: data.lesson.id,
				attendance: data.members.map((item) => ({
					enrollmentId: item.enrollmentId,
					status: statuses[item.enrollmentId] ?? "present",
					note: text(form, `note:${item.enrollmentId}`) || null,
				})),
			})
			.then(async () => {
				toast.success("考勤已登记，课次已结课");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<form className="grid gap-3" onSubmit={submit}>
			{data.members.length === 0 ? (
				<p className="border p-3 text-muted-foreground text-sm">
					当前班级没有成员，无法完成结课。
				</p>
			) : (
				data.members.map((item) => (
					<div
						key={item.enrollmentId}
						className="grid gap-2 border p-3 sm:grid-cols-[minmax(9rem,1fr)_9rem_minmax(10rem,1fr)] sm:items-center"
					>
						<div className="min-w-0">
							<p className="truncate text-sm">{item.studentName}</p>
							<p className="text-muted-foreground text-xs">
								剩余 {item.remainingLessons} 课时
							</p>
						</div>
						<AttendanceStatusSelect
							value={statuses[item.enrollmentId] ?? "present"}
							onValueChange={(status) =>
								setStatuses((current) => ({
									...current,
									[item.enrollmentId]: status,
								}))
							}
						/>
						<Input
							name={`note:${item.enrollmentId}`}
							defaultValue={item.note ?? ""}
							placeholder="备注（可选）"
						/>
					</div>
				))
			)}
			<DialogFooter>
				<Button
					type="button"
					variant="outline"
					disabled={mutation.isPending}
					onClick={onClose}
				>
					取消
				</Button>
				<Button
					type="submit"
					disabled={mutation.isPending || data.members.length === 0}
				>
					{mutation.isPending ? (
						<LoaderCircleIcon className="animate-spin" />
					) : null}
					确认结课
				</Button>
			</DialogFooter>
		</form>
	);
}

type AttendanceStatus = "present" | "absent" | "late" | "leave";

function AttendanceStatusSelect({
	value,
	onValueChange,
}: {
	value: AttendanceStatus;
	onValueChange: (value: AttendanceStatus) => void;
}) {
	return (
		<Select
			value={value}
			onValueChange={(next) => {
				if (next) onValueChange(next as AttendanceStatus);
			}}
		>
			<SelectTrigger aria-label="考勤状态">
				<SelectValue>{() => attendanceStatusLabels[value]}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{Object.entries(attendanceStatusLabels).map(([status, label]) => (
					<SelectItem key={status} value={status}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
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
const attendanceStatusLabels: Record<AttendanceStatus, string> = {
	present: "到课",
	absent: "缺勤",
	late: "迟到",
	leave: "请假",
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

function getEditableClassStatuses(
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
