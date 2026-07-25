import type { ClassGroup, Lesson } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	keepPreviousData,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";
import {
	CoursesPanel,
	TeachersPanel,
} from "./academic/academic-catalog-panels";
import { ClassEditor } from "./academic/academic-class-editor";
import { ClassMembersDialog } from "./academic/academic-class-members-dialog";
import { CourseEditor } from "./academic/academic-course-editor";
import { LessonAttendanceDialog } from "./academic/academic-lesson-attendance-dialog";
import {
	CancelLessonDialog,
	LessonEditor,
} from "./academic/academic-lesson-editor";
import { TeacherEditor } from "./academic/academic-teacher-editor";
import { invalidateAcademicQueries } from "./academic/academic-workspace-queries";
import {
	type AcademicEditor,
	type AcademicTab,
	academicTabs,
} from "./academic/academic-workspace-types";
import { ClassesPanel } from "./academic-classes-panel";
import { LessonsPanel } from "./academic-lessons-panel";
import { BulkRescheduleDialog } from "./bulk-reschedule-dialog";
import { ClassPauseDialog } from "./class-pause-dialog";
import { MakeupLessonDialog } from "./makeup-lesson-dialog";
import { RoomsPanel } from "./rooms-panel";
import { ScheduleRulesDialog } from "./schedule-rules-dialog";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "./target-navigation";

export function AcademicWorkspace({
	initialTab,
	initialLessonId,
	initialCourseId,
	initialClassGroupId,
	onTargetClear,
	organizationId,
	sessionUserId,
	role,
}: {
	initialTab: AcademicTab;
	initialLessonId?: string;
	initialCourseId?: string;
	initialClassGroupId?: string;
	onTargetClear: () => void;
	organizationId: string;
	sessionUserId: string | undefined;
	role: string;
}) {
	const [editor, setEditor] = useState<AcademicEditor>(null);
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
	const isClassesTab = initialTab === "classes";
	const isLessonsTab = initialTab === "lessons";
	const isRoomsTab = initialTab === "rooms";
	const isCoursesTab = initialTab === "courses";
	const isTeachersTab = initialTab === "teachers";
	const needsCampuses =
		isClassesTab ||
		isLessonsTab ||
		isRoomsTab ||
		(isTeachersTab && canManageCatalog) ||
		editor?.kind === "class" ||
		editor?.kind === "teacher";
	const needsCourses =
		isCoursesTab || editor?.kind === "class" || Boolean(initialCourseId);
	const needsTeachers =
		(isTeachersTab && canManageCatalog) ||
		editor?.kind === "class" ||
		bulkRescheduleTarget !== null;
	const needsClassrooms =
		isRoomsTab ||
		editor?.kind === "lesson" ||
		scheduleRulesTarget !== null ||
		bulkRescheduleTarget !== null;
	const needsBindableTeacherMembers =
		canManageCatalog && editor?.kind === "teacher";
	const needsClasses =
		isClassesTab || editor?.kind === "lesson" || scheduleRulesTarget !== null;
	const needsLessons =
		isLessonsTab ||
		makeupSourceLesson !== null ||
		bulkRescheduleTarget !== null;
	const campusesOptions = orpc.training.campuses.list.queryOptions({
		input: { includeInactive: false },
	});
	const coursesOptions = orpc.training.teaching.courses.list.queryOptions({
		input: { includeInactive: true, targetId: initialCourseId },
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
		targetId: initialClassGroupId,
	};
	const classesOptions = orpc.training.teaching.classes.list.queryOptions({
		input: classesInput,
	});
	const lessonsInput = { campusId, targetId: initialLessonId };
	const lessonsOptions = orpc.training.teaching.lessons.list.queryOptions({
		input: lessonsInput,
	});
	const campusesQuery = useQuery({
		...campusesOptions,
		queryKey: [...campusesOptions.queryKey, context],
		enabled: needsCampuses,
	});
	const coursesQuery = useQuery({
		...coursesOptions,
		queryKey: [...coursesOptions.queryKey, context],
		enabled: needsCourses,
	});
	const teachersQuery = useQuery({
		...teachersOptions,
		queryKey: [...teachersOptions.queryKey, context],
		enabled: needsTeachers,
	});
	const classroomsQuery = useQuery({
		...classroomsOptions,
		queryKey: [...classroomsOptions.queryKey, context],
		enabled: needsClassrooms,
	});
	const bindableTeacherMembersQuery = useQuery({
		...bindableTeacherMembersOptions,
		queryKey: [...bindableTeacherMembersOptions.queryKey, context],
		enabled: needsBindableTeacherMembers,
	});
	const classesQuery = useInfiniteQuery({
		queryKey: [...classesOptions.queryKey, context, classesInput],
		queryFn: ({ pageParam }) =>
			client.training.teaching.classes.list({
				...classesInput,
				cursor: pageParam ?? undefined,
				pageSize: 20,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		placeholderData: keepPreviousData,
		enabled: needsClasses,
	});
	const lessonsQuery = useInfiniteQuery({
		queryKey: [...lessonsOptions.queryKey, context, lessonsInput],
		queryFn: ({ pageParam }) =>
			client.training.teaching.lessons.list({
				...lessonsInput,
				cursor: pageParam ?? undefined,
				pageSize: 20,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		placeholderData: keepPreviousData,
		enabled: needsLessons,
	});
	const classItems =
		classesQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const lessonItems =
		lessonsQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const targetQuery =
		initialTab === "courses" && initialCourseId
			? coursesQuery
			: initialTab === "classes" && initialClassGroupId
				? classesQuery
				: initialTab === "lessons" && initialLessonId
					? lessonsQuery
					: null;
	useEffect(() => {
		if (!targetQuery?.isError || !isUnavailableTargetError(targetQuery.error))
			return;
		toast.error(unavailableTargetMessage);
		onTargetClear();
	}, [onTargetClear, targetQuery?.error, targetQuery?.isError]);
	useEffect(() => {
		const targetId =
			initialTab === "lessons"
				? initialLessonId
				: initialTab === "classes"
					? initialClassGroupId
					: initialCourseId;
		if (!targetId || targetQuery?.isPending) return;
		const elementPrefix = initialTab === "lessons" ? "lesson" : initialTab;
		document
			.getElementById(`${elementPrefix}-${targetId}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [
		initialClassGroupId,
		initialCourseId,
		initialLessonId,
		initialTab,
		targetQuery?.isPending,
	]);

	function refresh() {
		return invalidateAcademicQueries();
	}
	const createAction =
		initialTab === "lessons"
			? {
					label: "新增课次",
					onClick: () => setEditor({ kind: "lesson", value: null }),
				}
			: initialTab === "rooms" ||
					(initialTab === "courses" && !canManageCatalog)
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
				{academicTabs
					.filter((item) => canManageCatalog || item.id !== "teachers")
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
			{initialCourseId || initialClassGroupId || initialLessonId ? (
				<div className="flex items-center justify-between gap-3 border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
					<span>已定位全局搜索目标</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={onTargetClear}
					>
						取消定位
					</Button>
				</div>
			) : null}
			{initialTab === "classes" ? (
				<ClassesPanel
					campuses={campusesQuery.data?.items ?? []}
					classes={classItems}
					lessons={lessonItems}
					lessonsReady={lessonsQuery.isSuccess}
					isLessonsPending={needsLessons && lessonsQuery.isPending}
					isPending={classesQuery.isPending && !classesQuery.data}
					isError={classesQuery.isError}
					hasNextPage={classesQuery.hasNextPage}
					isFetchingNextPage={classesQuery.isFetchingNextPage}
					campusId={campusId}
					status={classStatus}
					highlightedClassGroupId={initialClassGroupId}
					onCampusChange={setCampusId}
					onStatusChange={setClassStatus}
					onEdit={(value) => setEditor({ kind: "class", value })}
					onSchedule={(value) => setEditor({ kind: "lesson", value })}
					onManageMembers={setClassMembersTarget}
					onChangeStatus={(classGroup, action) =>
						setClassStatusTarget({ classGroup, action })
					}
					onCreate={() => setEditor({ kind: "class", value: null })}
					onLoadMore={() => void classesQuery.fetchNextPage()}
					onRetry={() => void classesQuery.refetch()}
				/>
			) : null}
			{initialTab === "rooms" ? (
				<RoomsPanel
					campuses={campusesQuery.data?.items ?? []}
					rooms={classroomsQuery.data?.items ?? []}
					isPending={classroomsQuery.isPending}
					isError={classroomsQuery.isError}
					campusId={campusId}
					onCampusChange={setCampusId}
					onRetry={() => void classroomsQuery.refetch()}
					onSaved={refresh}
				/>
			) : null}
			{initialTab === "lessons" ? (
				<LessonsPanel
					campuses={campusesQuery.data?.items ?? []}
					lessons={lessonItems}
					isPending={lessonsQuery.isPending && !lessonsQuery.data}
					isError={lessonsQuery.isError}
					hasNextPage={lessonsQuery.hasNextPage}
					isFetchingNextPage={lessonsQuery.isFetchingNextPage}
					campusId={campusId}
					highlightedLessonId={initialLessonId}
					onCampusChange={setCampusId}
					onSchedule={() => setEditor({ kind: "lesson", value: null })}
					onCancel={setCancelTarget}
					onTakeAttendance={setAttendanceTarget}
					onBulkReschedule={setBulkRescheduleTarget}
					onArrangeMakeup={setMakeupSourceLesson}
					onLoadMore={() => void lessonsQuery.fetchNextPage()}
					onRetry={() => void lessonsQuery.refetch()}
				/>
			) : null}
			{initialTab === "courses" ? (
				<CoursesPanel
					courses={coursesQuery.data?.items ?? []}
					highlightedCourseId={initialCourseId}
					canManage={canManageCatalog}
					isPending={coursesQuery.isPending}
					isError={coursesQuery.isError}
					onCreate={
						canManageCatalog
							? () => setEditor({ kind: "course", value: null })
							: undefined
					}
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
					classes={classItems}
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
					lessons={lessonItems}
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
