import type { Course } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { DialogFooter } from "@easy-training/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
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
import { categoryLabels } from "./academic-workspace-types";

export function CourseEditor({
	value,
	onClose,
	onSaved,
}: {
	value: Course | null;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const createMutation = useMutation(
		orpc.training.teaching.courses.create.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.courses.update.mutationOptions(),
	);
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const input = {
			code: readFormText(data, "code"),
			name: readFormText(data, "name"),
			category: readFormText(data, "category") as Course["category"],
			level: readFormText(data, "level"),
			durationMinutes: readFormNumber(data, "durationMinutes"),
			listPriceInCents: Math.round(readFormNumber(data, "price") * 100),
			lessonsPerPackage: readFormNumber(data, "lessonsPerPackage"),
			tags: readFormText(data, "tags")
				.split(/[,，]/u)
				.map((item) => item.trim())
				.filter(Boolean),
		};
		const request = value
			? updateMutation.mutateAsync({ id: value.id, data: input })
			: createMutation.mutateAsync(input);
		void request
			.then(async () => {
				toast.success(value ? "课程已更新" : "课程已创建");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<EditorDialog
			title={value ? "编辑课程" : "新建课程"}
			description="课程停用后不能新建班级或用于新的报名。"
			pending={pending}
			onClose={onClose}
		>
			<form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
				<TextField
					label="课程编码"
					name="code"
					defaultValue={value?.code}
					required
				/>
				<TextField
					label="课程名称"
					name="name"
					defaultValue={value?.name}
					required
				/>
				<SelectField
					label="类别"
					name="category"
					defaultValue={value?.category ?? "language"}
					items={Object.entries(categoryLabels).map(([value, label]) => ({
						value,
						label,
					}))}
				/>
				<TextField
					label="级别"
					name="level"
					defaultValue={value?.level}
					required
				/>
				<TextField
					label="单次时长（分钟）"
					name="durationMinutes"
					type="number"
					defaultValue={value?.durationMinutes ?? 60}
					required
				/>
				<TextField
					label="课包课次"
					name="lessonsPerPackage"
					type="number"
					defaultValue={value?.lessonsPerPackage ?? 12}
					required
				/>
				<TextField
					label="标准价（元）"
					name="price"
					type="number"
					step="0.01"
					defaultValue={
						value ? (value.listPriceInCents / 100).toFixed(2) : "0.00"
					}
					required
				/>
				<TextField
					label="标签（逗号分隔）"
					name="tags"
					defaultValue={value?.tags.join("，")}
				/>
				<DialogFooter className="sm:col-span-2">
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button type="submit" disabled={pending}>
						{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
						保存课程
					</Button>
				</DialogFooter>
			</form>
		</EditorDialog>
	);
}
