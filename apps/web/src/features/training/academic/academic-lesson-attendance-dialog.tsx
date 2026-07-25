import type {
	Lesson,
	LessonAttendance,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { DialogFooter } from "@easy-training/ui/components/dialog";
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
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { formatDateTime } from "../format";
import { EditorDialog, readFormText } from "./academic-workspace-form";
import {
	type AttendanceStatus,
	attendanceStatusLabels,
} from "./academic-workspace-types";

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
					note: readFormText(form, `note:${item.enrollmentId}`) || null,
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

export function LessonAttendanceDialog({
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
