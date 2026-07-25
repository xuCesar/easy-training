import type {
	BindableTeacherMember,
	Teacher,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { DialogFooter } from "@easy-training/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	EditorDialog,
	readFormNumber,
	readFormText,
	SelectField,
	TextField,
} from "./academic-workspace-form";

export function TeacherEditor({
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
		const boundUserId = readFormText(data, "boundUserId");
		const input = {
			name: readFormText(data, "name"),
			phone: readFormText(data, "phone") || null,
			subjects: readFormText(data, "subjects")
				.split(/[,，]/u)
				.map((item) => item.trim())
				.filter(Boolean),
			weeklyCapacityHours: readFormNumber(data, "weeklyCapacityHours"),
			capacityEffectiveFrom:
				readFormText(data, "capacityEffectiveFrom") || undefined,
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
				<TextField
					label="容量生效日期"
					name="capacityEffectiveFrom"
					type="date"
					defaultValue={new Date().toISOString().slice(0, 10)}
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
