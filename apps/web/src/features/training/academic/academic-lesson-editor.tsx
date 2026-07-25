import type {
	ClassGroup,
	Classroom,
	Lesson,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { DialogFooter } from "@easy-training/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { formatDateTime } from "../format";
import {
	EditorDialog,
	readFormText,
	SelectField,
	TextField,
	toShanghaiIso,
} from "./academic-workspace-form";

export function LessonEditor({
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
		const startsAt = toShanghaiIso(readFormText(data, "startsAt"));
		const endsAt = toShanghaiIso(readFormText(data, "endsAt"));
		const roomId = readFormText(data, "roomId");
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

export function CancelLessonDialog({
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
			.mutateAsync({
				id: lesson.id,
				reason: readFormText(data, "reason") || null,
			})
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
