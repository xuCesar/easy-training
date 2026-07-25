import type {
	ClassEnrollment,
	ClassGroup,
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
import { Input } from "@easy-training/ui/components/input";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	EditorDialog,
	formatAffectedLessonsDescription,
} from "./academic-workspace-form";

function MemberList({
	title,
	items,
	empty,
	actionLabel,
	disabled,
	onAction,
	secondaryAction,
}: {
	title: string;
	items: ClassEnrollment[];
	empty: string;
	actionLabel: string;
	disabled: boolean;
	onAction: (item: ClassEnrollment) => void;
	secondaryAction?: (item: ClassEnrollment) => {
		label: string;
		onAction: () => void;
	};
}) {
	return (
		<section className="grid gap-2">
			<h3 className="font-medium text-sm">{title}</h3>
			{items.length === 0 ? (
				<p className="border p-3 text-muted-foreground text-sm">{empty}</p>
			) : (
				<div className="grid gap-2">
					{items.map((item) => (
						<div
							key={item.enrollmentId}
							className="flex items-center justify-between gap-3 border p-3"
						>
							<div className="min-w-0">
								<p className="truncate text-sm">{item.studentName}</p>
								<p className="truncate text-muted-foreground text-xs">
									剩余 {item.remainingLessons} 课时
									{item.className ? ` · 当前：${item.className}` : ""}
								</p>
							</div>
							<div className="flex shrink-0 gap-2">
								{secondaryAction ? (
									<Button
										size="sm"
										variant="outline"
										disabled={disabled}
										onClick={() => secondaryAction(item).onAction()}
									>
										{secondaryAction(item).label}
									</Button>
								) : null}
								<Button
									size="sm"
									variant={actionLabel === "移出" ? "outline" : "default"}
									disabled={
										disabled ||
										(actionLabel === "入班" && item.status === "frozen")
									}
									onClick={() => onAction(item)}
								>
									{actionLabel}
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

export function ClassMembersDialog({
	classGroup,
	onClose,
	onSaved,
}: {
	classGroup: ClassGroup;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const options = orpc.training.teaching.classes.enrollments.queryOptions({
		input: { id: classGroup.id },
	});
	const query = useQuery(options);
	const mutation = useMutation(
		orpc.training.enrollments.lifecycle.mutationOptions(),
	);
	const [pendingAction, setPendingAction] = useState<{
		item: ClassEnrollment;
		kind: "freeze" | "resume" | "withdrawClass" | "assignClass";
		requestId: string;
	} | null>(null);
	const [reason, setReason] = useState("");
	const items = query.data?.items ?? [];
	const members = items.filter((item) => item.classGroupId === classGroup.id);
	const candidates = items.filter(
		(item) => item.classGroupId !== classGroup.id,
	);
	const canAssign =
		classGroup.status === "recruiting" || classGroup.status === "running";
	function requestAction(
		item: ClassEnrollment,
		kind: "freeze" | "resume" | "withdrawClass" | "assignClass",
	) {
		setReason("");
		setPendingAction({ item, kind, requestId: crypto.randomUUID() });
	}
	function submitAction() {
		if (!pendingAction) return;
		const { item, kind, requestId } = pendingAction;
		if (kind !== "assignClass" && !reason.trim()) return;
		const action =
			kind === "assignClass"
				? { kind, classGroupId: classGroup.id }
				: { kind, reason: reason.trim() };
		void mutation
			.mutateAsync({
				enrollmentId: item.enrollmentId,
				expectedVersion: item.version,
				requestId,
				action,
			})
			.then(async () => {
				toast.success(
					kind === "freeze"
						? "报名已冻结，仅影响之后的待上课次"
						: kind === "resume"
							? "报名已复课，仅从现在之后的课次恢复"
							: kind === "withdrawClass"
								? "已退班，报名与剩余课时保持不变"
								: "已更新后续课次的班级归属",
				);
				setPendingAction(null);
				await onSaved();
			})
			.catch((error: Error) => {
				toast.error(error.message, {
					description: formatAffectedLessonsDescription(error),
				});
			});
	}
	const pendingReasonRequired = pendingAction?.kind !== "assignClass";
	const actionTitle =
		pendingAction?.kind === "freeze"
			? "冻结报名"
			: pendingAction?.kind === "resume"
				? "复课"
				: pendingAction?.kind === "withdrawClass"
					? "确认退班"
					: "确认分班";
	return (
		<EditorDialog
			title={`成员管理 · ${classGroup.name}`}
			description={`${classGroup.courseName} · ${classGroup.campusName} · ${classGroup.enrollmentCount}/${classGroup.capacity} 人`}
			pending={mutation.isPending}
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
					<p>成员数据加载失败。</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						重试
					</Button>
				</div>
			) : null}
			{!query.isPending && !query.isError ? (
				<div className="grid gap-5">
					<MemberList
						title="当前成员"
						items={members}
						empty="当前班级还没有学员。"
						actionLabel="移出"
						disabled={mutation.isPending}
						onAction={(item) => requestAction(item, "withdrawClass")}
						secondaryAction={(item) =>
							item.status === "frozen"
								? {
										label: "复课",
										onAction: () => requestAction(item, "resume"),
									}
								: {
										label: "冻结",
										onAction: () => requestAction(item, "freeze"),
									}
						}
					/>
					<MemberList
						title="可入班报名"
						items={candidates}
						empty={
							canAssign
								? "没有同课程、同校区的可入班报名。"
								: "当前班级状态不允许新增成员。"
						}
						actionLabel="入班"
						disabled={mutation.isPending || !canAssign}
						onAction={(item) => requestAction(item, "assignClass")}
					/>
				</div>
			) : null}
			<Dialog
				open={pendingAction !== null}
				onOpenChange={(open) =>
					!open && !mutation.isPending && setPendingAction(null)
				}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{actionTitle}</DialogTitle>
						<DialogDescription>
							{pendingAction?.kind === "assignClass"
								? "仅更新此刻之后的待上课次；历史考勤、课消和收款不会改变。"
								: "本操作只影响此刻之后的待上课次，不会改写已完成课次、考勤、课消或收款。"}
						</DialogDescription>
					</DialogHeader>
					{pendingReasonRequired ? (
						<Field>
							<FieldLabel htmlFor="enrollment-lifecycle-reason">
								操作原因
							</FieldLabel>
							<Input
								id="enrollment-lifecycle-reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								maxLength={500}
								placeholder="请填写原因"
							/>
						</Field>
					) : null}
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => setPendingAction(null)}
						>
							取消
						</Button>
						<Button
							disabled={
								mutation.isPending || (pendingReasonRequired && !reason.trim())
							}
							onClick={submitAction}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							确认
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</EditorDialog>
	);
}
