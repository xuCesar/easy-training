import type { StudentStatus } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { Input } from "@easy-training/ui/components/input";
import {
	useInfiniteQuery,
	useMutation,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import {
	DownloadIcon,
	LoaderCircleIcon,
	PlusIcon,
	SearchIcon,
	TagsIcon,
	UploadIcon,
	UserPlusIcon,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { IndependentEnrollmentDialog } from "@/features/training/independent-enrollment-dialog";
import { useOrganization } from "@/features/training/organization-context";
import { StudentTimelineSheet } from "@/features/training/student-timeline-sheet";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "@/features/training/target-navigation";
import { downloadCsv } from "@/features/training/ui/download-csv";
import { FilterSelect } from "@/features/training/ui/filter-select";
import { client, orpc } from "@/utils/orpc";
import { StudentBulkOperationDialog } from "./students/students-bulk-dialog";
import { StudentEditor } from "./students/students-editor";
import { EnrollmentBulkOperationDialog } from "./students/students-enrollment-bulk-dialog";
import { StudentImportDialog } from "./students/students-import-dialog";
import { StudentMergeDialog } from "./students/students-merge-dialog";
import { StudentResults } from "./students/students-results";
import { TagManager } from "./students/students-tag-manager";
import {
	type EditorTarget,
	type StudentSummary,
	studentStatuses,
} from "./students/students-types";

export function StudentsPage({
	sessionUserId,
	studentId,
	onClearStudentId,
}: {
	sessionUserId: string | undefined;
	studentId?: string;
	onClearStudentId: () => void;
}) {
	const { organization } = useOrganization();
	const [search, setSearch] = useState("");
	const [campusId, setCampusId] = useState<string | null>(null);
	const [status, setStatus] = useState<"all" | StudentStatus>("all");
	const [tagId, setTagId] = useState<string | null>(null);
	const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorTarget>(null);
	const [independentEnrollmentOpen, setIndependentEnrollmentOpen] =
		useState(false);
	const [tagsOpen, setTagsOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [selectedStudents, setSelectedStudents] = useState<StudentSummary[]>(
		[],
	);
	const [bulkAction, setBulkAction] = useState<
		"owner" | "addTag" | "removeTag" | "assignClass" | "withdrawClass" | null
	>(null);
	const [mergeTarget, setMergeTarget] = useState<StudentSummary | null>(null);
	const [timelineTarget, setTimelineTarget] = useState<StudentSummary | null>(
		null,
	);
	const deferredSearch = useDeferredValue(search.trim());
	const queryContext = { organizationId: organization.id, sessionUserId };
	const campusesOptions = orpc.training.campuses.list.queryOptions({
		input: { includeInactive: true },
	});
	const tagsOptions = orpc.training.students.tags.list.queryOptions({
		input: { includeInactive: true },
	});
	const campusesQuery = useQuery({
		...campusesOptions,
		queryKey: [...campusesOptions.queryKey, queryContext],
	});
	const tagsQuery = useQuery({
		...tagsOptions,
		queryKey: [...tagsOptions.queryKey, queryContext],
	});
	const ownerCandidateQueries = useQueries({
		queries: (campusesQuery.data?.items ?? [])
			.filter((campus) => !campusId || campus.id === campusId)
			.map((campus) => ({
				...orpc.training.students.ownerCandidates.queryOptions({
					input: { campusId: campus.id },
				}),
				queryKey: [
					"student-owner-filter-candidates",
					organization.id,
					sessionUserId,
					campus.id,
				],
			})),
	});
	const ownerFilterItems = useMemo(() => {
		const candidates = ownerCandidateQueries.flatMap(
			(query) => query.data?.items ?? [],
		);
		return Array.from(
			new Map(
				candidates.map((candidate) => [candidate.userId, candidate]),
			).values(),
		).map((candidate) => ({
			value: candidate.userId,
			label: candidate.name,
		}));
	}, [ownerCandidateQueries]);
	const targetStudentQuery = useQuery({
		...orpc.training.students.get.queryOptions({
			input: { id: studentId ?? "" },
		}),
		enabled: Boolean(studentId),
		queryKey: ["training-student-target", organization.id, studentId],
		retry: false,
	});
	useEffect(() => {
		if (targetStudentQuery.data) setTimelineTarget(targetStudentQuery.data);
	}, [targetStudentQuery.data]);
	useEffect(() => {
		if (
			!studentId ||
			!targetStudentQuery.isError ||
			!isUnavailableTargetError(targetStudentQuery.error)
		)
			return;
		toast.error(unavailableTargetMessage);
		onClearStudentId();
	}, [
		onClearStudentId,
		studentId,
		targetStudentQuery.error,
		targetStudentQuery.isError,
	]);
	const filters = useMemo(
		() => ({
			query: deferredSearch || undefined,
			campusId: campusId ?? undefined,
			status,
			tagId: tagId ?? undefined,
			ownerUserId: ownerUserId ?? undefined,
			pageSize: 20,
		}),
		[campusId, deferredSearch, ownerUserId, status, tagId],
	);
	const listQuery = useInfiniteQuery({
		queryKey: [
			...orpc.training.students.list.key(),
			{ organizationId: organization.id, sessionUserId, filters },
		],
		queryFn: ({ pageParam }) =>
			client.training.students.list({
				...filters,
				cursor: pageParam ?? undefined,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const total = listQuery.data?.pages[0]?.total ?? 0;
	const isFiltered = Boolean(
		search || campusId || tagId || ownerUserId || status !== "all",
	);
	const canManageTags =
		organization.role === "owner" || organization.role === "admin";
	const canExport = ["owner", "admin", "campus_manager"].includes(
		organization.role,
	);
	const canBulkManage = canExport;
	const templateMutation = useMutation({
		mutationFn: () => client.training.students.importTemplate(),
		onSuccess: ({ csv, fileName }) => {
			downloadCsv(csv, fileName);
			toast.success("学员导入模板已开始下载");
		},
		onError: () => toast.error("暂时无法下载学员导入模板"),
	});
	const exportMutation = useMutation(
		orpc.training.students.export.mutationOptions({
			onSuccess: ({ csv, fileName }) => {
				downloadCsv(csv, fileName);
				toast.success("学员导出已开始下载");
			},
			onError: () => toast.error("暂时无法导出学员，请稍后重试"),
		}),
	);

	function clearFilters() {
		setSearch("");
		setCampusId(null);
		setStatus("all");
		setTagId(null);
		setOwnerUserId(null);
	}

	function toggleStudentSelection(student: StudentSummary, checked: boolean) {
		setSelectedStudents((current) => {
			if (!checked) return current.filter((item) => item.id !== student.id);
			if (current.some((item) => item.id === student.id)) return current;
			if (current.length >= 200) {
				toast.error("单次最多选择 200 位学员");
				return current;
			}
			return [...current, student];
		});
	}

	return (
		<div className="flex min-w-0 flex-col gap-5">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-muted-foreground text-sm">学员档案</p>
					<h1 className="mt-1 font-semibold text-2xl">学员中心</h1>
					<p className="mt-1 text-muted-foreground text-xs" aria-live="polite">
						已加载 {items.length} / {total} 位学员
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						disabled={templateMutation.isPending}
						onClick={() => templateMutation.mutate()}
					>
						<DownloadIcon data-icon="inline-start" />
						下载模板
					</Button>
					<Button variant="outline" onClick={() => setImportOpen(true)}>
						<UploadIcon data-icon="inline-start" />
						导入
					</Button>
					{canExport ? (
						<Button
							variant="outline"
							disabled={exportMutation.isPending}
							onClick={() =>
								exportMutation.mutate({
									query: deferredSearch || undefined,
									campusId: campusId ?? undefined,
									status,
									tagId: tagId ?? undefined,
									ownerUserId: ownerUserId ?? undefined,
									limit: 5_000,
								})
							}
						>
							{exportMutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<DownloadIcon data-icon="inline-start" />
							)}
							导出
						</Button>
					) : null}
					<Button
						variant="outline"
						onClick={() => setIndependentEnrollmentOpen(true)}
					>
						<UserPlusIcon data-icon="inline-start" />
						办理报名
					</Button>
					{canManageTags ? (
						<Button variant="outline" onClick={() => setTagsOpen(true)}>
							<TagsIcon data-icon="inline-start" />
							管理标签
						</Button>
					) : null}
					<Button onClick={() => setEditor("new")}>
						<PlusIcon data-icon="inline-start" />
						新增学员
					</Button>
				</div>
			</section>
			<section className="grid gap-3 border p-3 md:grid-cols-2 xl:grid-cols-5">
				<div className="relative md:col-span-2 xl:col-span-1">
					<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="搜索学员"
						className="pl-8"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="搜索学员、主要联系人或手机号"
					/>
				</div>
				<FilterSelect
					label="按校区筛选"
					value={campusId ?? "all"}
					onValueChange={(value) => setCampusId(value === "all" ? null : value)}
					items={[
						{ value: "all", label: "全部校区" },
						...(campusesQuery.data?.items ?? []).map((campus) => ({
							value: campus.id,
							label: campus.name,
						})),
					]}
				/>
				<FilterSelect
					label="按状态筛选"
					value={status}
					onValueChange={(value) => setStatus(value as "all" | StudentStatus)}
					items={[{ value: "all", label: "全部状态" }, ...studentStatuses]}
				/>
				<FilterSelect
					label="按标签筛选"
					value={tagId ?? "all"}
					onValueChange={(value) => setTagId(value === "all" ? null : value)}
					items={[
						{ value: "all", label: "全部标签" },
						...(tagsQuery.data?.items ?? []).map((tag) => ({
							value: tag.id,
							label: tag.name,
						})),
					]}
				/>
				<FilterSelect
					label="按负责人筛选"
					value={ownerUserId ?? "all"}
					onValueChange={(value) =>
						setOwnerUserId(value === "all" ? null : value)
					}
					items={[
						{ value: "all", label: "全部负责人" },
						{ value: "unassigned", label: "未分配" },
						...ownerFilterItems,
					]}
				/>
				{isFiltered ? (
					<Button
						type="button"
						variant="ghost"
						className="md:col-span-2 md:justify-self-end xl:col-span-5"
						onClick={clearFilters}
					>
						清除筛选
					</Button>
				) : null}
			</section>
			{canBulkManage && selectedStudents.length > 0 ? (
				<section className="flex flex-wrap items-center gap-2 border bg-muted/30 p-3">
					<p className="mr-auto text-sm">
						已选择 {selectedStudents.length} 位学员
					</p>
					<Button variant="outline" onClick={() => setBulkAction("owner")}>
						调整负责人
					</Button>
					<Button variant="outline" onClick={() => setBulkAction("addTag")}>
						添加标签
					</Button>
					<Button variant="outline" onClick={() => setBulkAction("removeTag")}>
						移除标签
					</Button>
					<Button
						variant="outline"
						onClick={() => setBulkAction("assignClass")}
					>
						分配班级
					</Button>
					<Button
						variant="outline"
						onClick={() => setBulkAction("withdrawClass")}
					>
						移出班级
					</Button>
					<Button variant="ghost" onClick={() => setSelectedStudents([])}>
						清空选择
					</Button>
				</section>
			) : null}
			<StudentResults
				items={items}
				isFiltered={isFiltered}
				isPending={listQuery.isPending}
				isError={listQuery.isError}
				onRetry={() => void listQuery.refetch()}
				onEdit={setEditor}
				onTimeline={setTimelineTarget}
				selectedIds={new Set(selectedStudents.map((student) => student.id))}
				onToggleSelected={canBulkManage ? toggleStudentSelection : undefined}
			/>
			{listQuery.hasNextPage ? (
				<div className="flex justify-center">
					<Button
						variant="outline"
						disabled={listQuery.isFetchingNextPage}
						onClick={() => void listQuery.fetchNextPage()}
					>
						{listQuery.isFetchingNextPage ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : null}
						{listQuery.isFetchingNextPage ? "正在加载更多" : "加载更多"}
					</Button>
				</div>
			) : null}
			{editor ? (
				<StudentEditor
					key={editor === "new" ? "new" : editor.id}
					editor={editor}
					campuses={campusesQuery.data?.items ?? []}
					tags={tagsQuery.data?.items ?? []}
					onClose={() => setEditor(null)}
				/>
			) : null}
			{mergeTarget ? (
				<StudentMergeDialog
					target={mergeTarget}
					onClose={() => setMergeTarget(null)}
				/>
			) : null}
			{timelineTarget ? (
				<StudentTimelineSheet
					student={timelineTarget}
					organizationId={organization.id}
					sessionUserId={sessionUserId}
					onMerge={
						canManageTags ? () => setMergeTarget(timelineTarget) : undefined
					}
					onClose={() => {
						setTimelineTarget(null);
						if (studentId) onClearStudentId();
					}}
				/>
			) : null}
			{independentEnrollmentOpen ? (
				<IndependentEnrollmentDialog
					onClose={() => setIndependentEnrollmentOpen(false)}
				/>
			) : null}
			{canManageTags ? (
				<TagManager
					open={tagsOpen}
					tags={tagsQuery.data?.items ?? []}
					onOpenChange={setTagsOpen}
				/>
			) : null}
			<StudentImportDialog open={importOpen} onOpenChange={setImportOpen} />
			{bulkAction &&
			bulkAction !== "assignClass" &&
			bulkAction !== "withdrawClass" ? (
				<StudentBulkOperationDialog
					action={bulkAction}
					students={selectedStudents}
					ownerItems={ownerFilterItems}
					tags={tagsQuery.data?.items.filter((tag) => tag.isActive) ?? []}
					onClose={() => setBulkAction(null)}
					onSuccess={() => {
						setBulkAction(null);
						setSelectedStudents([]);
					}}
				/>
			) : null}
			{bulkAction === "assignClass" || bulkAction === "withdrawClass" ? (
				<EnrollmentBulkOperationDialog
					action={bulkAction}
					students={selectedStudents}
					onClose={() => setBulkAction(null)}
					onSuccess={() => {
						setBulkAction(null);
						setSelectedStudents([]);
					}}
				/>
			) : null}
		</div>
	);
}
