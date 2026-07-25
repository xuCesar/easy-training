import type {
	PreviewStudentBulkOperationInput,
	PreviewStudentBulkOperationResult,
	StudentTag,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Field, FieldLabel } from "@easy-training/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import type { StudentSummary } from "./students-types";

export function StudentBulkOperationDialog({
	action,
	students,
	ownerItems,
	tags,
	onClose,
	onSuccess,
}: {
	action: "owner" | "addTag" | "removeTag";
	students: StudentSummary[];
	ownerItems: Array<{ value: string; label: string }>;
	tags: StudentTag[];
	onClose: () => void;
	onSuccess: () => void;
}) {
	const [value, setValue] = useState<string | null>(null);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [preview, setPreview] =
		useState<PreviewStudentBulkOperationResult | null>(null);
	const targets = students.map((student) => ({
		studentId: student.id,
		expectedVersion: student.version,
	}));
	const operationInput: PreviewStudentBulkOperationInput | null =
		action === "owner"
			? value === "unassigned"
				? { kind: "clearStudentOwner", targets }
				: value
					? { kind: "setStudentOwner", targets, ownerUserId: value }
					: null
			: value
				? {
						kind: action === "addTag" ? "addStudentTag" : "removeStudentTag",
						targets,
						tagId: value,
					}
				: null;
	const previewMutation = useMutation(
		orpc.training.students.previewBulk.mutationOptions({
			onSuccess: setPreview,
			onError: () => toast.error("批量预览失败，请刷新学员列表后重试。"),
		}),
	);
	const commitMutation = useMutation(
		orpc.training.students.commitBulk.mutationOptions({
			onSuccess: async (result) => {
				await queryClient.invalidateQueries({
					queryKey: orpc.training.students.list.key(),
				});
				toast.success(
					`批量操作完成：变更 ${result.changedCount} 位，无变化 ${result.unchangedCount} 位。`,
				);
				onSuccess();
			},
			onError: () => {
				setPreview(null);
				setRequestId(crypto.randomUUID());
				toast.error("提交时数据已变化，整批未执行。请刷新并重新预览。");
			},
		}),
	);

	function changeValue(nextValue: string | null) {
		setValue(nextValue);
		setPreview(null);
		setRequestId(crypto.randomUUID());
		previewMutation.reset();
		commitMutation.reset();
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{action === "owner"
							? "批量调整负责人"
							: action === "addTag"
								? "批量添加标签"
								: "批量移除标签"}
					</DialogTitle>
					<DialogDescription>
						将对 {students.length}{" "}
						位明确选择的学员执行操作。预览不会锁定数据，提交时会重新校验版本、权限和目标资格。
					</DialogDescription>
				</DialogHeader>
				<Field name="student-bulk-value">
					<FieldLabel>
						{action === "owner" ? "目标负责人" : "目标标签"}
					</FieldLabel>
					<Select
						value={value ?? ""}
						onValueChange={(next) => changeValue(next ?? null)}
						disabled={commitMutation.isPending}
					>
						<SelectTrigger>
							<SelectValue>
								{() =>
									action === "owner"
										? value === "unassigned"
											? "清空负责人"
											: (ownerItems.find((item) => item.value === value)
													?.label ?? "请选择负责人")
										: (tags.find((tag) => tag.id === value)?.name ??
											"请选择标签")
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{action === "owner" ? (
									<>
										<SelectItem value="unassigned">清空负责人</SelectItem>
										{ownerItems.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</>
								) : (
									tags.map((tag) => (
										<SelectItem key={tag.id} value={tag.id}>
											{tag.name}
										</SelectItem>
									))
								)}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				{preview ? (
					<div className="space-y-2 text-sm">
						<p>
							将变更 {preview.changeCount} 位，无变化 {preview.noChangeCount}{" "}
							位，阻断 {preview.blockedCount} 位。
						</p>
						<ul className="max-h-52 space-y-1 overflow-y-auto border p-3 text-xs">
							{preview.items.map((item) => (
								<li key={item.studentId}>
									{item.studentName ?? item.studentId}：
									{item.status === "change"
										? "将变更"
										: item.status === "no_change"
											? "无变化"
											: `已阻断（${item.blockerCode}）`}
								</li>
							))}
						</ul>
					</div>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					{preview ? (
						<Button
							disabled={preview.blockedCount > 0 || commitMutation.isPending}
							onClick={() => {
								if (!operationInput) return;
								commitMutation.mutate({ ...operationInput, requestId });
							}}
						>
							{commitMutation.isPending ? "正在提交" : "确认提交"}
						</Button>
					) : (
						<Button
							disabled={!operationInput || previewMutation.isPending}
							onClick={() =>
								operationInput && previewMutation.mutate(operationInput)
							}
						>
							{previewMutation.isPending ? "正在预览" : "预览变更"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
