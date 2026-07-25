import type {
	ClassGroup,
	Course,
	Teacher,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { DialogFooter } from "@easy-training/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	EditorDialog,
	readFormNumber,
	readFormText,
	SelectField,
	TextField,
} from "./academic-workspace-form";
import { getEditableClassStatuses } from "./academic-workspace-types";

export function ClassEditor({
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
			name: readFormText(data, "name"),
			campusId: readFormText(data, "campusId"),
			courseId: readFormText(data, "courseId"),
			teacherId: readFormText(data, "teacherId"),
			capacity: readFormNumber(data, "capacity"),
			capacityEffectiveFrom:
				readFormText(data, "capacityEffectiveFrom") || undefined,
			startDate: readFormText(data, "startDate"),
		};
		const request = value
			? updateMutation.mutateAsync({
					id: value.id,
					data: {
						...input,
						status: readFormText(data, "status") as ClassGroup["status"],
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
					label="容量生效日期"
					name="capacityEffectiveFrom"
					type="date"
					defaultValue={new Date().toISOString().slice(0, 10)}
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
