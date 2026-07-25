import type { MergeStudentsInput } from "@easy-training/api/contracts/training";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";
import { invalidateStudentQueries } from "./students-queries";
import type { StudentSummary } from "./students-types";

export function StudentMergeDialog({
	target,
	onClose,
}: {
	target: StudentSummary;
	onClose: () => void;
}) {
	const [search, setSearch] = useState("");
	const [source, setSource] = useState<StudentSummary | null>(null);
	const [fieldSources, setFieldSources] = useState<
		MergeStudentsInput["fieldSources"]
	>({
		name: "target",
		campusId: "target",
		birthDate: "target",
		status: "target",
		ownerUserId: "target",
		primaryContactId: "",
	});
	const candidatesQuery = useQuery({
		queryKey: ["student-merge-candidates", search],
		queryFn: () =>
			client.training.students.list({
				query: search.trim() || undefined,
				status: "all",
				pageSize: 10,
			}),
	});
	const previewQuery = useQuery({
		...orpc.training.students.mergePreview.queryOptions({
			input: {
				sourceStudentId: source?.id ?? target.id,
				targetStudentId: target.id,
			},
		}),
		enabled: source !== null,
	});
	useEffect(() => {
		const preview = previewQuery.data;
		if (!preview) return;
		const targetPrimary = preview.contacts.find(
			(contact) =>
				contact.studentId === target.id &&
				contact.isPrimary &&
				!contact.duplicateOfContactId,
		);
		setFieldSources((current) => ({
			...current,
			primaryContactId: targetPrimary?.id ?? preview.contacts[0]?.id ?? "",
		}));
	}, [previewQuery.data, target.id]);
	const mutation = useMutation(
		orpc.training.students.merge.mutationOptions({
			onSuccess: () => {
				toast.success("学员档案已合并，来源档案已冻结为只读映射。");
				void invalidateStudentQueries();
				onClose();
			},
		}),
	);
	const preview = previewQuery.data;
	const eligibleContacts =
		preview?.contacts.filter((contact) => !contact.duplicateOfContactId) ?? [];
	function merge() {
		if (!preview || !source || !fieldSources.primaryContactId) return;
		mutation.mutate({
			sourceStudentId: source.id,
			targetStudentId: target.id,
			expectedSourceVersion: preview.source.version,
			expectedTargetVersion: preview.target.version,
			requestId: crypto.randomUUID(),
			fieldSources,
		});
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !mutation.isPending && onClose()}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>合并学员档案</DialogTitle>
					<DialogDescription>
						主档案为“{target.name}
						”。合并会迁移可安全归并的业务关联，来源档案将变为只读映射；已完成课次、考勤和财务事实不会删除。
					</DialogDescription>
				</DialogHeader>
				{!source ? (
					<div className="grid gap-3">
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="搜索要合并进此主档案的来源学员"
						/>
						{candidatesQuery.isPending ? <Skeleton className="h-20" /> : null}
						{(candidatesQuery.data?.items ?? [])
							.filter((candidate) => candidate.id !== target.id)
							.map((candidate) => (
								<Button
									key={candidate.id}
									variant="outline"
									className="h-auto justify-start p-3 text-left"
									onClick={() => setSource(candidate)}
								>
									<span>
										{candidate.name} · {candidate.campusName} ·{" "}
										{candidate.primaryContactPhoneMasked}
									</span>
								</Button>
							))}
						{!candidatesQuery.isPending &&
						(candidatesQuery.data?.items ?? []).filter(
							(candidate) => candidate.id !== target.id,
						).length === 0 ? (
							<p className="border p-3 text-muted-foreground text-sm">
								暂无可选来源学员。
							</p>
						) : null}
					</div>
				) : previewQuery.isPending ? (
					<Skeleton className="h-48" />
				) : previewQuery.isError || !preview ? (
					<div className="grid gap-3 border p-3 text-sm">
						<p>合并预览加载失败：{previewQuery.error?.message}</p>
						<Button variant="outline" onClick={() => setSource(null)}>
							重新选择
						</Button>
					</div>
				) : (
					<div className="grid gap-4">
						{preview.blockingReasons.length > 0 ? (
							<div className="border border-destructive/50 bg-destructive/5 p-3 text-destructive text-sm">
								{preview.blockingReasons.includes("ACTIVE_COURSE_ENROLLMENT")
									? "两份档案存在同课程有效报名，请先通过续费、转课、退班或财务流程单独处理。"
									: "两份档案在同一课次均有考勤，不能自动合并。"}
							</div>
						) : null}
						<div className="grid gap-3 sm:grid-cols-2">
							{(
								[
									["name", "姓名"],
									["campusId", "所属校区"],
									["birthDate", "出生日期"],
									["status", "档案状态"],
								] as const
							).map(([field, label]) => (
								<Field key={field}>
									<FieldLabel>{label}</FieldLabel>
									<Select
										value={fieldSources[field]}
										onValueChange={(value) =>
											value &&
											setFieldSources((current) => ({
												...current,
												[field]: value as "source" | "target",
											}))
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="target">
												保留主档案：{String(preview.target[field] ?? "未填写")}
											</SelectItem>
											<SelectItem value="source">
												采用来源：{String(preview.source[field] ?? "未填写")}
											</SelectItem>
										</SelectContent>
									</Select>
								</Field>
							))}
						</div>
						<Field>
							<FieldLabel>负责人</FieldLabel>
							<Select
								value={fieldSources.ownerUserId}
								onValueChange={(ownerUserId) =>
									ownerUserId &&
									setFieldSources((current) => ({
										...current,
										ownerUserId: ownerUserId as "source" | "target",
									}))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="target">
										保留主档案：{preview.target.ownerName ?? "未分配"}
									</SelectItem>
									<SelectItem value="source">
										采用来源：{preview.source.ownerName ?? "未分配"}
									</SelectItem>
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel>合并后的主要联系人</FieldLabel>
							<Select
								value={fieldSources.primaryContactId}
								onValueChange={(primaryContactId) =>
									primaryContactId &&
									setFieldSources((current) => ({
										...current,
										primaryContactId,
									}))
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="选择主要联系人" />
								</SelectTrigger>
								<SelectContent>
									{eligibleContacts.map((contact) => (
										<SelectItem key={contact.id} value={contact.id}>
											{contact.name} · {contact.phone}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<p className="text-muted-foreground text-xs">
							联系人按手机号去重，标签自动并集。提交后不能恢复来源档案为独立可写档案。
						</p>
					</div>
				)}
				<DialogFooter className="flex-col-reverse sm:flex-row">
					<Button
						variant="outline"
						disabled={mutation.isPending}
						onClick={onClose}
					>
						取消
					</Button>
					{source ? (
						<Button
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => setSource(null)}
						>
							上一步
						</Button>
					) : null}
					{preview ? (
						<Button
							variant="destructive"
							disabled={
								mutation.isPending ||
								preview.blockingReasons.length > 0 ||
								!fieldSources.primaryContactId
							}
							onClick={merge}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon className="animate-spin" />
							) : null}
							确认合并
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
