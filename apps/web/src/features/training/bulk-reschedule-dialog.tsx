import type { Lesson, Teacher } from "@easy-training/api/contracts/training";
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
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { useMutation } from "@tanstack/react-query";
import {
	CheckIcon,
	CircleXIcon,
	EllipsisIcon,
	RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

type DraftItem = {
	id: string;
	expectedVersion: number;
	startsAt: string;
	teacherId: string;
	room: string;
	conflicts: Array<"teacher" | "room" | "time">;
	isConflictChecked: boolean;
};

export function BulkRescheduleDialog({
	lessons,
	teachers,
	onClose,
	onSaved,
}: {
	lessons: Lesson[];
	teachers: Teacher[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [items, setItems] = useState<DraftItem[]>(
		lessons.map((lesson) => ({
			id: lesson.id,
			expectedVersion: lesson.version,
			startsAt: lesson.startsAt,
			teacherId: lesson.teacherId,
			room: lesson.room,
			conflicts: [],
			isConflictChecked: false,
		})),
	);
	const [offsetMinutes, setOffsetMinutes] = useState(0);
	const [bulkTeacherId, setBulkTeacherId] = useState("");
	const previewMutation = useMutation(
		orpc.training.teaching.lessons.previewBulkUpdate.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.lessons.bulkUpdate.mutationOptions(),
	);

	function applyOffset() {
		setItems((current) =>
			current.map((item, index) => ({
				...item,
				startsAt: new Date(
					new Date(lessons[index]?.startsAt ?? item.startsAt).getTime() +
						offsetMinutes * 60_000,
				).toISOString(),
				conflicts: [],
				isConflictChecked: false,
			})),
		);
	}

	function preview() {
		void previewMutation
			.mutateAsync({ items: stripConflicts(items) })
			.then((result) => {
				setItems(
					result.items.map((item) => ({
						id: item.id,
						expectedVersion: item.expectedVersion,
						startsAt: item.proposed.startsAt,
						teacherId: item.proposed.teacherId,
						room: item.proposed.room,
						conflicts: item.conflicts,
						isConflictChecked: true,
					})),
				);
				const conflictCount = result.items.filter(
					(item) => item.conflicts.length > 0,
				).length;
				if (conflictCount === 0) {
					toast.success("冲突检测完成，当前课次均可提交。");
				} else {
					toast.error(
						`冲突检测完成，${conflictCount} 节课次存在教师或教室冲突。`,
					);
				}
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function submit() {
		if (items.some((item) => !item.isConflictChecked)) {
			toast.error("修改后请先检测冲突");
			return;
		}
		if (items.some((item) => item.conflicts.length > 0)) {
			toast.error("请先消除全部教师和教室冲突");
			return;
		}
		void updateMutation
			.mutateAsync({
				requestId: crypto.randomUUID(),
				items: stripConflicts(items),
			})
			.then(async (result) => {
				toast.success(`已调整 ${result.lessonIds.length} 节未来课次`);
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>批量调整未来课次</DialogTitle>
					<DialogDescription>
						统一设置后仍可逐节修正；只有全部无冲突时才会原子提交。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-end gap-2 border p-3">
					<div className="grid gap-1 text-sm">
						<span>统一时间偏移（分钟）</span>
						<Input
							type="number"
							value={offsetMinutes}
							onChange={(event) => setOffsetMinutes(Number(event.target.value))}
						/>
					</div>
					<Button variant="outline" onClick={applyOffset}>
						应用偏移
					</Button>
					<BulkTeacherSelect
						teachers={teachers}
						value={bulkTeacherId}
						onSelect={(teacherId) => {
							setBulkTeacherId(teacherId);
							setItems((current) =>
								current.map((item) => ({
									...item,
									teacherId,
									conflicts: [],
									isConflictChecked: false,
								})),
							);
						}}
					/>
					<div className="grid gap-1 text-sm">
						<span>统一教室</span>
						<Input
							placeholder="输入后回车"
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								const room = event.currentTarget.value.trim();
								if (room)
									setItems((current) =>
										current.map((item) => ({
											...item,
											room,
											conflicts: [],
											isConflictChecked: false,
										})),
									);
							}}
						/>
					</div>
				</div>
				<div className="grid max-h-[48vh] gap-2 overflow-y-auto">
					{items.map((item, index) => {
						const lesson = lessons.find((value) => value.id === item.id);
						const hasTeacherConflict = item.conflicts.includes("teacher");
						const hasTimeConflict = item.conflicts.includes("time");
						const hasRoomConflict = item.conflicts.includes("room");
						const eligible = teachers.filter(
							(teacher) =>
								lesson?.campusId && teacher.campusIds.includes(lesson.campusId),
						);
						return (
							<div
								key={item.id}
								className="grid gap-2 border p-2 md:grid-cols-[minmax(10rem,1fr)_1fr_1fr_1fr_auto] md:items-end"
							>
								<p className="text-sm">
									<span className="font-medium">{lesson?.className}</span>
									<br />
									<span className="text-muted-foreground text-xs">
										{lesson?.campusName}
									</span>
								</p>
								<div className="grid gap-1 text-xs">
									<span>开始时间</span>
									<Input
										type="datetime-local"
										aria-invalid={hasTimeConflict}
										value={toLocalInput(item.startsAt)}
										onChange={(event) =>
											updateItem(setItems, index, {
												startsAt: toShanghaiIso(event.target.value),
												conflicts: [],
											})
										}
									/>
								</div>
								<div className="grid gap-1 text-xs">
									<span>教师</span>
									<Select
										value={item.teacherId}
										onValueChange={(value) =>
											value &&
											updateItem(setItems, index, {
												teacherId: value,
												conflicts: [],
											})
										}
									>
										<SelectTrigger aria-invalid={hasTeacherConflict}>
											<SelectValue>
												{() =>
													eligible.find(
														(teacher) => teacher.id === item.teacherId,
													)?.name ?? "选择教师"
												}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{eligible.map((teacher) => (
												<SelectItem key={teacher.id} value={teacher.id}>
													{teacher.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-1 text-xs">
									<span>教室</span>
									<Input
										value={item.room}
										aria-invalid={hasRoomConflict}
										onChange={(event) =>
											updateItem(setItems, index, {
												room: event.target.value,
												conflicts: [],
											})
										}
									/>
								</div>
								<div className="flex gap-1">
									{!item.isConflictChecked ? (
										<Badge
											variant="outline"
											className="h-8 w-8 border-yellow-500 p-0 text-yellow-700 dark:text-yellow-400 [&>svg]:size-4!"
											aria-label="待检测"
											title="待检测"
										>
											<EllipsisIcon />
										</Badge>
									) : item.conflicts.length === 0 ? (
										<Badge
											variant="outline"
											className="h-8 w-8 border-emerald-600 p-0 text-emerald-700 dark:text-emerald-400 [&>svg]:size-4!"
											aria-label="无冲突"
											title="无冲突"
										>
											<CheckIcon />
										</Badge>
									) : (
										<Badge
											variant="destructive"
											className="h-8 w-8 p-0 [&>svg]:size-4!"
											aria-label="存在冲突"
											title="存在冲突"
										>
											<CircleXIcon />
										</Badge>
									)}
								</div>
							</div>
						);
					})}
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={preview}
						disabled={previewMutation.isPending}
					>
						<RefreshCwIcon
							className={previewMutation.isPending ? "animate-spin" : undefined}
						/>
						{previewMutation.isPending ? "检测中…" : "检测冲突"}
					</Button>
					<Button
						onClick={submit}
						disabled={
							updateMutation.isPending ||
							previewMutation.isPending ||
							items.some((item) => !item.isConflictChecked) ||
							items.some((item) => item.conflicts.length > 0)
						}
					>
						确认批量调整
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function BulkTeacherSelect({
	teachers,
	value,
	onSelect,
}: {
	teachers: Teacher[];
	value: string;
	onSelect: (teacherId: string) => void;
}) {
	return (
		<div className="grid gap-1 text-sm">
			<span>统一教师</span>
			<Select value={value} onValueChange={(next) => next && onSelect(next)}>
				<SelectTrigger className="min-w-40">
					<SelectValue>
						{() =>
							teachers.find((teacher) => teacher.id === value)?.name ??
							"选择教师"
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{teachers.map((teacher) => (
						<SelectItem key={teacher.id} value={teacher.id}>
							{teacher.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function stripConflicts(items: DraftItem[]) {
	return items.map(
		({
			conflicts: _conflicts,
			isConflictChecked: _isConflictChecked,
			...item
		}) => item,
	);
}

function updateItem(
	setter: React.Dispatch<React.SetStateAction<DraftItem[]>>,
	index: number,
	patch: Partial<DraftItem>,
) {
	setter((current) =>
		current.map((item, itemIndex) =>
			itemIndex === index
				? { ...item, ...patch, isConflictChecked: false }
				: item,
		),
	);
}

function toLocalInput(value: string) {
	const parts = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(value));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toShanghaiIso(value: string) {
	return new Date(`${value}:00+08:00`).toISOString();
}
