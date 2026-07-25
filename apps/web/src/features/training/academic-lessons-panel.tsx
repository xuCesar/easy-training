import type { Lesson } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { ClipboardCheckIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import {
	DataCell,
	FilterBar,
	PanelState,
	StatusBadge,
} from "./academic-workspace-shared";
import { formatDateTime } from "./format";

export function LessonsPanel({
	campuses,
	lessons,
	isPending,
	isError,
	hasNextPage,
	isFetchingNextPage,
	campusId,
	highlightedLessonId,
	onCampusChange,
	onSchedule,
	onCancel,
	onTakeAttendance,
	onBulkReschedule,
	onArrangeMakeup,
	onLoadMore,
	onRetry,
}: {
	campuses: Array<{ id: string; name: string }>;
	lessons: Lesson[];
	isPending: boolean;
	isError: boolean;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	campusId: string | undefined;
	highlightedLessonId?: string;
	onCampusChange: (value: string | undefined) => void;
	onSchedule: () => void;
	onCancel: (item: Lesson) => void;
	onTakeAttendance: (item: Lesson) => void;
	onBulkReschedule: (items: Lesson[]) => void;
	onArrangeMakeup: (item: Lesson) => void;
	onLoadMore: () => void;
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
							加载更多课次
						</Button>
					) : null}
				</div>
			</PanelState>
		</>
	);
}
