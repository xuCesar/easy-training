import type {
	PreviewEnrollmentBulkOperationInput,
	PreviewEnrollmentBulkOperationResult,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { Checkbox } from "@easy-training/ui/components/checkbox";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import type { StudentSummary } from "./students-types";

export function EnrollmentBulkOperationDialog({
	action,
	students,
	onClose,
	onSuccess,
}: {
	action: "assignClass" | "withdrawClass";
	students: StudentSummary[];
	onClose: () => void;
	onSuccess: () => void;
}) {
	const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<
		ReadonlySet<string>
	>(new Set());
	const [classGroupId, setClassGroupId] = useState<string | null>(null);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [preview, setPreview] =
		useState<PreviewEnrollmentBulkOperationResult | null>(null);
	const optionsQuery = useQuery(
		orpc.training.students.activeEnrollmentOptions.queryOptions({
			input: { studentIds: students.map((student) => student.id) },
		}),
	);
	const classesQuery = useQuery(
		orpc.training.teaching.classes.list.queryOptions({ input: {} }),
	);
	const enrollmentOptions = optionsQuery.data?.items ?? [];
	const selectedEnrollments = enrollmentOptions.filter((item) =>
		selectedEnrollmentIds.has(item.enrollmentId),
	);
	const targets = selectedEnrollments.map((item) => ({
		enrollmentId: item.enrollmentId,
		expectedVersion: item.version,
	}));
	const operationInput: PreviewEnrollmentBulkOperationInput | null =
		targets.length === 0
			? null
			: action === "assignClass"
				? classGroupId
					? { kind: "assignEnrollmentClass", targets, classGroupId }
					: null
				: { kind: "withdrawEnrollmentClass", targets };
	const firstSelected = selectedEnrollments[0];
	const availableClasses = (classesQuery.data?.items ?? []).filter(
		(item) =>
			(item.status === "recruiting" || item.status === "running") &&
			(!firstSelected ||
				(item.courseId === firstSelected.courseId &&
					item.campusId === firstSelected.studentCampusId)),
	);
	const previewMutation = useMutation(
		orpc.training.students.previewEnrollmentBulk.mutationOptions({
			onSuccess: setPreview,
			onError: () => toast.error("班级调整预览失败，请刷新报名信息后重试。"),
		}),
	);
	const commitMutation = useMutation(
		orpc.training.students.commitEnrollmentBulk.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpc.training.students.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpc.training.students.activeEnrollmentOptions.key(),
					}),
				]);
				toast.success(
					`班级批量调整完成：变更 ${result.changedCount} 项，无变化 ${result.unchangedCount} 项。`,
				);
				onSuccess();
			},
			onError: () => {
				setPreview(null);
				setRequestId(crypto.randomUUID());
				toast.error("提交时报名或容量已变化，整批未执行。请重新预览。");
			},
		}),
	);

	function resetPreview() {
		setPreview(null);
		setRequestId(crypto.randomUUID());
		previewMutation.reset();
		commitMutation.reset();
	}

	function toggleEnrollment(enrollmentId: string, checked: boolean) {
		setSelectedEnrollmentIds((current) => {
			const next = new Set(current);
			if (checked) {
				if (next.size >= 200) {
					toast.error("单次最多选择 200 条报名");
					return current;
				}
				next.add(enrollmentId);
			} else {
				next.delete(enrollmentId);
			}
			return next;
		});
		setClassGroupId(null);
		resetPreview();
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{action === "assignClass" ? "批量分配班级" : "批量移出班级"}
					</DialogTitle>
					<DialogDescription>
						请明确选择 active
						报名；同一学员有多条报名时不会自动猜测。提交时会按整批最终状态重新校验容量和重复学员。
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<p className="font-medium text-sm">选择报名</p>
					{optionsQuery.isPending ? (
						<p className="text-muted-foreground text-sm">正在加载报名…</p>
					) : optionsQuery.isError ? (
						<p className="text-destructive text-sm">报名加载失败，请重试。</p>
					) : enrollmentOptions.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							所选学员没有 active 报名。
						</p>
					) : (
						<ul className="max-h-52 space-y-2 overflow-y-auto border p-3 text-sm">
							{enrollmentOptions.map((item) => (
								<li key={item.enrollmentId} className="flex items-start gap-2">
									<Checkbox
										aria-label={`选择 ${item.studentName} 的 ${item.courseName} 报名`}
										checked={selectedEnrollmentIds.has(item.enrollmentId)}
										onCheckedChange={(checked) =>
											toggleEnrollment(item.enrollmentId, checked === true)
										}
									/>
									<div className="min-w-0">
										<p>
											{item.studentName} · {item.courseName}
										</p>
										<p className="text-muted-foreground text-xs">
											当前班级：{item.className ?? "未分班"}
										</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
				{action === "assignClass" ? (
					<Field name="enrollment-bulk-class">
						<FieldLabel>目标班级</FieldLabel>
						<Select
							value={classGroupId ?? ""}
							onValueChange={(value) => {
								setClassGroupId(value ?? null);
								resetPreview();
							}}
							disabled={
								selectedEnrollments.length === 0 || commitMutation.isPending
							}
						>
							<SelectTrigger>
								<SelectValue>
									{() =>
										availableClasses.find((item) => item.id === classGroupId)
											?.name ?? "请选择班级"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{availableClasses.map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.name}（{item.courseName}）
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
				) : null}
				{selectedEnrollments.length > 1 &&
				new Set(selectedEnrollments.map((item) => item.courseId)).size > 1 &&
				action === "assignClass" ? (
					<p className="text-destructive text-xs">
						所选报名属于不同课程，不能分配到同一班级。
					</p>
				) : null}
				{preview ? (
					<div className="space-y-2 text-sm">
						<p>
							将变更 {preview.changeCount} 项，无变化 {preview.noChangeCount}{" "}
							项，阻断 {preview.blockedCount} 项。
						</p>
						<ul className="max-h-44 space-y-1 overflow-y-auto border p-3 text-xs">
							{preview.items.map((item) => (
								<li key={item.enrollmentId}>
									{item.studentName ?? item.enrollmentId} ·{" "}
									{item.courseName ?? "未知课程"}：
									{item.status === "change"
										? `${item.beforeClassName ?? "未分班"} → ${item.afterClassName ?? "未分班"}`
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
