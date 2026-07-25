import type { ClassGroup, Lesson } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	CalendarClockIcon,
	LoaderCircleIcon,
	PencilIcon,
	PowerIcon,
	UsersRoundIcon,
} from "lucide-react";
import { useState } from "react";
import {
	DataCell,
	FilterBar,
	PanelState,
	StatusBadge,
} from "./academic-workspace-shared";
import { formatDateTime } from "./format";
import { FilterSelect } from "./ui/filter-select";

const classStatuses: Array<{
	value: ClassGroup["status"] | "all";
	label: string;
}> = [
	{ value: "recruiting", label: "招生中" },
	{ value: "running", label: "进行中" },
	{ value: "paused", label: "已暂停" },
	{ value: "completed", label: "已结课" },
];

export function ClassesPanel({
	campuses,
	classes,
	lessons,
	lessonsReady,
	isLessonsPending,
	isPending,
	isError,
	hasNextPage,
	isFetchingNextPage,
	campusId,
	status,
	highlightedClassGroupId,
	onCampusChange,
	onStatusChange,
	onEdit,
	onSchedule,
	onManageMembers,
	onChangeStatus,
	onCreate,
	onLoadMore,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	classes: ClassGroup[];
	lessons: Lesson[];
	lessonsReady: boolean;
	isLessonsPending: boolean;
	isPending: boolean;
	isError: boolean;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	campusId: string | undefined;
	status: string;
	highlightedClassGroupId?: string;
	onCampusChange: (value: string | undefined) => void;
	onStatusChange: (value: string) => void;
	onEdit: (item: ClassGroup) => void;
	onSchedule: (item: ClassGroup) => void;
	onManageMembers: (item: ClassGroup) => void;
	onChangeStatus: (item: ClassGroup, action: "pause" | "resume") => void;
	onCreate?: () => void;
	onLoadMore: () => void;
	onRetry: () => void;
}) {
	const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
	const now = new Date();
	const lessonsByClassId = new Map<string, Lesson[]>();
	if (lessonsReady) {
		for (const item of lessons) {
			const current = lessonsByClassId.get(item.classGroupId) ?? [];
			current.push(item);
			lessonsByClassId.set(item.classGroupId, current);
		}
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
					showLabel
					containerClassName="w-full sm:w-[200px]"
					className="h-10 w-full"
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
								id={`classes-${item.id}`}
								className={`grid scroll-mt-20 gap-3 border p-3 md:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(0,1fr))_auto] md:items-center ${highlightedClassGroupId === item.id ? "ring-2 ring-primary" : ""}`}
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
									) : lessonsReady ? (
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
									) : null}
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
					{hasNextPage ? (
						<Button
							type="button"
							variant="outline"
							disabled={isFetchingNextPage}
							onClick={onLoadMore}
						>
							{isFetchingNextPage ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							加载更多班级
						</Button>
					) : null}
				</div>
			</PanelState>
		</>
	);
}
