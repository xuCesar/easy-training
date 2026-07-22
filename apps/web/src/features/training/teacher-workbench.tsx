import type {
	Lesson,
	LessonAttendance,
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
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CalendarCheckIcon,
	CircleAlertIcon,
	LoaderCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";
import { formatDateTime } from "./format";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "./target-navigation";

type AttendanceDraft = LessonAttendance["members"][number] & {
	status: "present" | "absent" | "late" | "leave";
};

const attendanceLabels = {
	present: "到课",
	late: "迟到",
	absent: "缺勤",
	leave: "请假",
} as const;

export function TeacherWorkbench({
	organizationId,
	initialLessonId,
	onTargetClear,
}: {
	organizationId: string;
	initialLessonId?: string;
	onTargetClear: () => void;
}) {
	const [target, setTarget] = useState<Lesson | null>(null);
	const now = new Date();
	const input = {
		from: new Date(now.getTime() - 14 * 86_400_000).toISOString(),
		to: new Date(now.getTime() + 60 * 86_400_000).toISOString(),
		targetId: initialLessonId,
	};
	const options = orpc.training.teaching.teacherWorkspace.lessons.queryOptions({
		input,
	});
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, { organizationId }],
	});
	useEffect(() => {
		if (
			!initialLessonId ||
			!query.isError ||
			!isUnavailableTargetError(query.error)
		)
			return;
		toast.error(unavailableTargetMessage);
		onTargetClear();
	}, [initialLessonId, onTargetClear, query.error, query.isError]);
	useEffect(() => {
		if (!initialLessonId || query.isPending) return;
		document
			.getElementById(`teacher-lesson-${initialLessonId}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [initialLessonId, query.isPending]);
	if (query.isPending)
		return <div className="min-h-64 animate-pulse border bg-muted/20" />;
	if (query.isError)
		return (
			<WorkbenchEmpty
				title="教师课表加载失败"
				description="请稍后重试。"
				error
			/>
		);
	if (!query.data?.teacher)
		return (
			<WorkbenchEmpty
				title="尚未绑定教师档案"
				description="请联系机构管理员，在教师档案中显式绑定当前教师账号。"
			/>
		);
	const lessons = query.data.lessons;
	return (
		<div className="grid gap-5">
			{initialLessonId ? (
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
			<header>
				<p className="text-muted-foreground text-sm">教师工作台</p>
				<h1 className="mt-1 font-semibold text-2xl">
					{query.data.teacher.name}的课表
				</h1>
				<p className="mt-1 text-muted-foreground text-xs">
					点名草稿不扣课时，最终结课后教学事实永久冻结。
				</p>
			</header>
			{lessons.length === 0 ? (
				<WorkbenchEmpty
					title="近期没有课次"
					description="未来 60 天和近期历史中暂无本人课次。"
				/>
			) : (
				<div className="grid gap-3 lg:grid-cols-2">
					{lessons.map((lesson) => {
						const canDraft =
							lesson.status === "scheduled" &&
							Date.now() >= new Date(lesson.startsAt).getTime() - 30 * 60_000;
						const canComplete =
							lesson.status === "scheduled" &&
							Date.now() >= new Date(lesson.endsAt).getTime();
						return (
							<article
								key={lesson.id}
								id={`teacher-lesson-${lesson.id}`}
								className={`grid scroll-mt-20 gap-3 border p-4 ${initialLessonId === lesson.id ? "ring-2 ring-primary" : ""}`}
							>
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="font-medium">{lesson.className}</p>
										<p className="text-muted-foreground text-sm">
											{lesson.courseName} · {lesson.campusName} / {lesson.room}
										</p>
									</div>
									<Badge
										variant={
											lesson.status === "scheduled" ? "default" : "outline"
										}
									>
										{lesson.status === "scheduled"
											? "待上课"
											: lesson.status === "completed"
												? "已结课"
												: "已取消"}
									</Badge>
								</div>
								<p className="text-sm">
									{formatDateTime(lesson.startsAt)} 至{" "}
									{formatDateTime(lesson.endsAt)}
								</p>
								{lesson.teachingSummary ? (
									<p className="rounded bg-muted/40 p-2 text-sm">
										教学小结：{lesson.teachingSummary}
									</p>
								) : null}
								{lesson.status === "scheduled" ? (
									<div className="flex flex-wrap gap-2">
										<Button
											size="sm"
											variant="outline"
											disabled={!canDraft}
											onClick={() => setTarget(lesson)}
										>
											{canComplete ? "点名并结课" : "保存点名草稿"}
										</Button>
										{canComplete ? (
											<QuickCompleteButton
												lesson={lesson}
												onSaved={() =>
													queryClient.invalidateQueries({
														queryKey:
															orpc.training.teaching.teacherWorkspace.lessons.key(),
													})
												}
											/>
										) : null}
									</div>
								) : null}
							</article>
						);
					})}
				</div>
			)}
			{target ? (
				<TeacherAttendanceDialog
					lesson={target}
					onClose={() => setTarget(null)}
					onSaved={async () => {
						await queryClient.invalidateQueries({
							queryKey: orpc.training.teaching.teacherWorkspace.lessons.key(),
						});
					}}
				/>
			) : null}
		</div>
	);
}

function QuickCompleteButton({
	lesson,
	onSaved,
}: {
	lesson: Lesson;
	onSaved: () => Promise<unknown>;
}) {
	const mutation = useMutation(
		orpc.training.teaching.teacherWorkspace.complete.mutationOptions(),
	);
	return (
		<Button
			size="sm"
			disabled={mutation.isPending}
			onClick={() => {
				if (
					!window.confirm(
						`确认“${lesson.className}”全员到课并结课？系统将立即产生课消。`,
					)
				)
					return;
				void mutation
					.mutateAsync({
						id: lesson.id,
						attendance: null,
						teachingSummary: null,
					})
					.then(async () => {
						toast.success("已按全勤完成结课");
						await onSaved();
					})
					.catch((error: Error) => toast.error(error.message));
			}}
		>
			全勤并结课
		</Button>
	);
}

function TeacherAttendanceDialog({
	lesson,
	onClose,
	onSaved,
}: {
	lesson: Lesson;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const options =
		orpc.training.teaching.teacherWorkspace.attendance.queryOptions({
			input: { id: lesson.id },
		});
	const query = useQuery(options);
	const [draft, setDraft] = useState<AttendanceDraft[] | null>(null);
	const [summary, setSummary] = useState(lesson.teachingSummary ?? "");
	const effective = useMemo(
		() =>
			draft ??
			query.data?.members.map((member) => ({
				...member,
				status: member.status ?? "present",
			})) ??
			[],
		[draft, query.data],
	);
	const saveMutation = useMutation(
		orpc.training.teaching.teacherWorkspace.saveDraft.mutationOptions(),
	);
	const completeMutation = useMutation(
		orpc.training.teaching.teacherWorkspace.complete.mutationOptions(),
	);
	const canComplete = Date.now() >= new Date(lesson.endsAt).getTime();
	const counts = effective.reduce<Record<string, number>>((result, item) => {
		result[item.status] = (result[item.status] ?? 0) + 1;
		return result;
	}, {});
	const payload = effective.map((item) => ({
		enrollmentId: item.enrollmentId,
		status: item.status,
		note: item.note,
	}));
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{lesson.className} · 点名</DialogTitle>
					<DialogDescription>
						默认全员到课；异常学员可单独修改。草稿不会扣课时。
					</DialogDescription>
				</DialogHeader>
				{query.isPending ? (
					<div className="h-40 animate-pulse bg-muted/30" />
				) : (
					<div className="grid gap-2">
						{effective.map((member, index) => (
							<div
								key={member.enrollmentId}
								className="grid gap-2 border p-2 sm:grid-cols-[1fr_8rem_1.5fr] sm:items-center"
							>
								<div>
									<p className="font-medium text-sm">{member.studentName}</p>
									<p className="text-muted-foreground text-xs">
										剩余 {member.remainingLessons} 课时
									</p>
								</div>
								<Select
									value={member.status}
									onValueChange={(value) =>
										value &&
										setDraft(
											effective.map((item, itemIndex) =>
												itemIndex === index
													? {
															...item,
															status: value as AttendanceDraft["status"],
														}
													: item,
											),
										)
									}
								>
									<SelectTrigger>
										<SelectValue>
											{() => attendanceLabels[member.status]}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{Object.entries(attendanceLabels).map(([value, label]) => (
											<SelectItem key={value} value={value}>
												{label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Input
									placeholder="备注（可选）"
									value={member.note ?? ""}
									onChange={(event) =>
										setDraft(
											effective.map((item, itemIndex) =>
												itemIndex === index
													? { ...item, note: event.target.value || null }
													: item,
											),
										)
									}
								/>
							</div>
						))}
					</div>
				)}
				<div className="grid gap-2 border bg-muted/20 p-3 text-sm">
					<p>
						到课 {counts.present ?? 0} · 迟到 {counts.late ?? 0} · 缺勤{" "}
						{counts.absent ?? 0} · 请假 {counts.leave ?? 0}
					</p>
					<p>预计课消 {(counts.present ?? 0) + (counts.late ?? 0)} 课时</p>
				</div>
				<div className="grid gap-1 text-sm">
					<span>教学小结（结课时保存，可选）</span>
					<Textarea
						value={summary}
						maxLength={2000}
						onChange={(event) => setSummary(event.target.value)}
					/>
				</div>
				<DialogFooter className="sticky bottom-0 bg-background py-2">
					<Button
						variant="outline"
						disabled={saveMutation.isPending || effective.length === 0}
						onClick={() =>
							void saveMutation
								.mutateAsync({ id: lesson.id, attendance: payload })
								.then(() => {
									toast.success("点名草稿已保存，不产生课消");
								})
								.catch((error: Error) => toast.error(error.message))
						}
					>
						保存草稿
					</Button>
					<Button
						disabled={
							!canComplete ||
							completeMutation.isPending ||
							effective.length === 0
						}
						onClick={() =>
							void completeMutation
								.mutateAsync({
									id: lesson.id,
									attendance: payload,
									teachingSummary: summary || null,
								})
								.then(async () => {
									toast.success("课次已结课并完成课消");
									await onSaved();
									onClose();
								})
								.catch((error: Error) => toast.error(error.message))
						}
					>
						{completeMutation.isPending ? (
							<LoaderCircleIcon className="animate-spin" />
						) : null}
						确认结课
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function WorkbenchEmpty({
	title,
	description,
	error = false,
}: {
	title: string;
	description: string;
	error?: boolean;
}) {
	return (
		<Empty className="min-h-72 border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					{error ? <CircleAlertIcon /> : <CalendarCheckIcon />}
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
