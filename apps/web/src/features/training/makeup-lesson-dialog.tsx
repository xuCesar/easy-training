import type {
	Lesson,
	MakeupLesson,
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import { formatDateTime } from "./format";

export function MakeupLessonDialog({
	sourceLesson,
	lessons,
	onClose,
	onSaved,
}: {
	sourceLesson: Lesson;
	lessons: Lesson[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [sourceEnrollmentId, setSourceEnrollmentId] = useState("");
	const [targetLessonId, setTargetLessonId] = useState("");
	const [cancelTarget, setCancelTarget] = useState<MakeupLesson | null>(null);
	const createRequestId = useRef(crypto.randomUUID());
	const attendanceOptions =
		orpc.training.teaching.lessons.attendance.queryOptions({
			input: { id: sourceLesson.id },
		});
	const makeupsOptions = orpc.training.teaching.makeups.list.queryOptions({
		input: {},
	});
	const attendanceQuery = useQuery(attendanceOptions);
	const makeupsQuery = useQuery(makeupsOptions);
	const createMutation = useMutation(
		orpc.training.teaching.makeups.create.mutationOptions(),
	);
	const cancelMutation = useMutation(
		orpc.training.teaching.makeups.cancel.mutationOptions(),
	);
	const pending = createMutation.isPending || cancelMutation.isPending;
	const eligibleMembers = (attendanceQuery.data?.members ?? []).filter(
		(member) => member.status === "absent" || member.status === "leave",
	);
	const targetLessons = lessons.filter(
		(lesson) =>
			lesson.status === "scheduled" &&
			new Date(lesson.startsAt) > new Date() &&
			lesson.id !== sourceLesson.id &&
			lesson.campusId === sourceLesson.campusId &&
			lesson.courseId === sourceLesson.courseId &&
			lesson.roomId !== null,
	);
	const relatedMakeups = (makeupsQuery.data?.items ?? []).filter(
		(item) => item.sourceLessonId === sourceLesson.id,
	);
	const memberPlaceholder = attendanceQuery.isPending
		? "正在加载考勤…"
		: attendanceQuery.isError
			? "加载失败"
			: eligibleMembers.length === 0
				? "暂无数据"
				: "选择缺勤/请假学员";
	const targetPlaceholder =
		targetLessons.length === 0 ? "暂无数据" : "选择未来课次";

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: orpc.training.teaching.makeups.list.key(),
			}),
			onSaved(),
		]);
	}

	function create() {
		if (!sourceEnrollmentId || !targetLessonId) {
			toast.error("请选择补课学员和目标课次");
			return;
		}
		void createMutation
			.mutateAsync({
				sourceLessonId: sourceLesson.id,
				sourceEnrollmentId,
				targetLessonId,
				requestId: createRequestId.current,
			})
			.then(async () => {
				toast.success("补课已安排到目标课次");
				createRequestId.current = crypto.randomUUID();
				setSourceEnrollmentId("");
				setTargetLessonId("");
				await refresh();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function cancel() {
		if (!cancelTarget) return;
		void cancelMutation
			.mutateAsync({ id: cancelTarget.id })
			.then(async () => {
				toast.success("补课安排已取消，可重新安排");
				setCancelTarget(null);
				await refresh();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	return (
		<>
			<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>安排补课</DialogTitle>
						<DialogDescription>
							从该课次的缺勤或请假学员中选择一人，加入同校区同课程的未来课次；来源事实不会改变。
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-1 border bg-muted/30 p-3 text-sm">
						<p className="font-medium">
							{sourceLesson.className} · {sourceLesson.courseName}
						</p>
						<p className="text-muted-foreground text-xs">
							{formatDateTime(sourceLesson.startsAt)} ·{" "}
							{sourceLesson.campusName} / {sourceLesson.room}
						</p>
					</div>
					<section className="mt-4 grid gap-3">
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid min-w-0 content-start gap-1.5 text-sm">
								<span className="font-medium">补课学员</span>
								<Select
									value={sourceEnrollmentId}
									disabled={
										attendanceQuery.isPending ||
										attendanceQuery.isError ||
										eligibleMembers.length === 0
									}
									onValueChange={(value) =>
										value && setSourceEnrollmentId(value)
									}
								>
									<SelectTrigger aria-label="补课学员">
										<SelectValue placeholder={memberPlaceholder} />
									</SelectTrigger>
									<SelectContent>
										{eligibleMembers.map((member) => (
											<SelectItem
												key={member.enrollmentId}
												value={member.enrollmentId}
											>
												{member.studentName} ·{" "}
												{member.status === "absent" ? "缺勤" : "请假"}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{attendanceQuery.isError ? (
									<QueryError
										message="考勤名单加载失败，无法安排补课。"
										onRetry={() => void attendanceQuery.refetch()}
									/>
								) : !attendanceQuery.isPending &&
									eligibleMembers.length === 0 ? (
									<p className="text-muted-foreground text-xs">
										该课次没有可安排补课的缺勤或请假学员。
									</p>
								) : null}
							</div>
							<div className="grid min-w-0 content-start gap-1.5 text-sm">
								<span className="font-medium">目标课次</span>
								<Select
									value={targetLessonId}
									disabled={targetLessons.length === 0}
									onValueChange={(value) => value && setTargetLessonId(value)}
								>
									<SelectTrigger aria-label="目标课次">
										<SelectValue placeholder={targetPlaceholder} />
									</SelectTrigger>
									<SelectContent>
										{targetLessons.map((lesson) => (
											<SelectItem key={lesson.id} value={lesson.id}>
												{formatDateTime(lesson.startsAt)} · {lesson.className} /{" "}
												{lesson.room}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{targetLessons.length === 0 ? (
									<p className="text-muted-foreground text-xs">
										当前没有同校区、同课程且已关联启用教室资源的未来课次。
									</p>
								) : null}
							</div>
						</div>
					</section>
					<section className="grid gap-2">
						<p className="font-medium text-sm">已有补课安排</p>
						{makeupsQuery.isError ? (
							<QueryError
								message="已有补课安排加载失败。"
								onRetry={() => void makeupsQuery.refetch()}
							/>
						) : makeupsQuery.isPending ? (
							<p className="text-muted-foreground text-sm">正在加载…</p>
						) : relatedMakeups.length === 0 ? (
							<p className="text-muted-foreground text-sm">暂无安排</p>
						) : (
							relatedMakeups.map((item) => (
								<article
									key={item.id}
									className="flex min-w-0 flex-col gap-2 border p-2 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<p className="truncate text-sm">
											{item.studentName} → {item.targetClassName}
										</p>
										<p className="truncate text-muted-foreground text-xs">
											{formatDateTime(item.targetStartsAt)}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Badge
											variant={
												item.status === "scheduled" ? "default" : "outline"
											}
										>
											{makeupStatusLabels[item.status]}
										</Badge>
										{item.status === "scheduled" ? (
											<Button
												size="sm"
												variant="destructive"
												disabled={pending}
												onClick={() => setCancelTarget(item)}
											>
												取消安排
											</Button>
										) : null}
									</div>
								</article>
							))
						)}
					</section>
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button variant="outline" disabled={pending} onClick={onClose}>
							关闭
						</Button>
						<Button
							disabled={
								pending ||
								attendanceQuery.isPending ||
								attendanceQuery.isError ||
								makeupsQuery.isPending ||
								makeupsQuery.isError ||
								!sourceEnrollmentId ||
								!targetLessonId
							}
							onClick={create}
						>
							{createMutation.isPending ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							确认安排
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{cancelTarget ? (
				<Dialog
					open
					onOpenChange={(open) =>
						!open && !cancelMutation.isPending && setCancelTarget(null)
					}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>取消补课安排</DialogTitle>
							<DialogDescription>
								确认取消 {cancelTarget.studentName} 前往“
								{cancelTarget.targetClassName}”的补课安排吗？取消后可重新安排。
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col-reverse sm:flex-row">
							<Button
								variant="outline"
								disabled={cancelMutation.isPending}
								onClick={() => setCancelTarget(null)}
							>
								返回
							</Button>
							<Button
								variant="destructive"
								disabled={cancelMutation.isPending}
								onClick={cancel}
							>
								{cancelMutation.isPending ? (
									<LoaderCircleIcon className="animate-spin" />
								) : null}
								确认取消
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : null}
		</>
	);
}

function QueryError({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-2 border border-destructive/40 p-2 text-destructive text-sm">
			<span>{message}</span>
			<Button size="sm" variant="outline" onClick={onRetry}>
				重试
			</Button>
		</div>
	);
}

const makeupStatusLabels: Record<MakeupLesson["status"], string> = {
	scheduled: "待补课",
	fulfilled: "已完成",
	needs_reschedule: "待重排",
	cancelled: "已取消",
};
