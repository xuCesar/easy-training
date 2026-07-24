import {
	type Campus,
	createStudentInputSchema,
	getLeadImportRpcBodyBytes,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	type MergeStudentsInput,
	type PreviewEnrollmentBulkOperationInput,
	type PreviewEnrollmentBulkOperationResult,
	type PreviewStudentBulkOperationInput,
	type PreviewStudentBulkOperationResult,
	type PreviewStudentImportResult,
	type StudentDetail,
	type StudentListResult,
	type StudentStatus,
	type StudentTag,
	updateStudentInputSchema,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@easy-training/ui/components/table";
import {
	useInfiniteQuery,
	useMutation,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	DownloadIcon,
	HistoryIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	PowerIcon,
	SearchIcon,
	TagsIcon,
	UploadIcon,
	UserPlusIcon,
	UsersRoundIcon,
} from "lucide-react";
import {
	type FormEvent,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import { z } from "zod";
import { IndependentEnrollmentDialog } from "@/features/training/independent-enrollment-dialog";
import { useOrganization } from "@/features/training/organization-context";
import { StudentTimelineSheet } from "@/features/training/student-timeline-sheet";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "@/features/training/target-navigation";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/students")({
	validateSearch: z.object({
		studentId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
	}),
	component: StudentsRoute,
});

type StudentSummary = StudentListResult["items"][number];
type StudentFormValues = {
	name: string;
	campusId: string;
	ownerUserId: string | null;
	birthDate: string;
	status: StudentStatus;
	contacts: Array<{
		id?: string;
		name: string;
		phone: string;
		relationship: string;
		isPrimary: boolean;
	}>;
	tagIds: string[];
};
type EditorTarget = "new" | StudentSummary | null;

const studentStatuses: Array<{ value: StudentStatus; label: string }> = [
	{ value: "trial", label: "试听" },
	{ value: "active", label: "在读" },
	{ value: "paused", label: "暂停" },
	{ value: "atRisk", label: "需关注" },
	{ value: "graduated", label: "已归档" },
];

function StudentsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { organization } = useOrganization();
	const { studentId } = Route.useSearch();
	const navigate = Route.useNavigate();
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
		void navigate({ search: {}, replace: true });
	}, [
		navigate,
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
						if (studentId) void navigate({ search: {}, replace: true });
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

function downloadCsv(csv: string, fileName: string) {
	const url = URL.createObjectURL(
		new Blob([csv], { type: "text/csv;charset=utf-8" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
}

function StudentBulkOperationDialog({
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

function EnrollmentBulkOperationDialog({
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

function StudentImportDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [content, setContent] = useState<string | null>(null);
	const [requestId, setRequestId] = useState<string | null>(null);
	const [preview, setPreview] = useState<PreviewStudentImportResult | null>(
		null,
	);
	const previewMutation = useMutation(
		orpc.training.students.previewImport.mutationOptions({
			onSuccess: setPreview,
			onError: () => toast.error("无法解析 CSV，请确认使用最新模板。"),
		}),
	);
	const confirmMutation = useMutation(
		orpc.training.students.confirmImport.mutationOptions({
			onSuccess: async (result) => {
				await queryClient.invalidateQueries({
					queryKey: orpc.training.students.list.key(),
				});
				if (result.errorRows > 0) {
					setPreview({
						totalRows: result.importedRows + result.errorRows,
						validRows: result.importedRows,
						errors: result.errors,
					});
					setRequestId(null);
					toast.error(
						`已导入 ${result.importedRows} 位学员，${result.errorRows} 行未导入。`,
					);
					return;
				}
				toast.success(`已导入 ${result.importedRows} 位学员`);
				closeDialog();
			},
			onError: () => toast.error("学员导入失败，请保留文件并重试。"),
		}),
	);

	function reset() {
		setContent(null);
		setRequestId(null);
		setPreview(null);
		previewMutation.reset();
		confirmMutation.reset();
	}

	function closeDialog() {
		reset();
		onOpenChange(false);
	}

	function replaceFile(nextContent: string) {
		const nextRequestId = crypto.randomUUID();
		if (
			getLeadImportRpcBodyBytes({ content: nextContent }) >
				LEAD_IMPORT_RPC_BODY_LIMIT_BYTES ||
			getLeadImportRpcBodyBytes({
				content: nextContent,
				requestId: nextRequestId,
			}) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES
		) {
			toast.error(LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE);
			return;
		}
		setContent(nextContent);
		setRequestId(nextRequestId);
		setPreview(null);
		previewMutation.mutate({ content: nextContent });
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) onOpenChange(true);
				else closeDialog();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>导入学员</DialogTitle>
					<DialogDescription>
						仅创建新学员，不创建报名、账单或班级关系。请使用最新模板；标签必须已存在且启用。
					</DialogDescription>
				</DialogHeader>
				<Input
					type="file"
					accept=".csv,text/csv"
					disabled={previewMutation.isPending || confirmMutation.isPending}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (!file) return;
						const reader = new FileReader();
						reader.onload = () => {
							if (typeof reader.result === "string") replaceFile(reader.result);
						};
						reader.onerror = () => toast.error("无法读取所选 CSV 文件。");
						reader.readAsText(file);
					}}
				/>
				<p className="text-muted-foreground text-xs">
					状态使用 active、trial、paused、graduated 或 atRisk；多个标签用 |
					分隔。
				</p>
				{previewMutation.isPending ? (
					<p className="text-muted-foreground text-sm" aria-live="polite">
						正在校验 CSV…
					</p>
				) : null}
				{preview ? (
					<div className="flex min-w-0 flex-col gap-2 text-sm">
						<p aria-live="polite">
							共 {preview.totalRows} 行，其中 {preview.validRows} 行可导入
							{preview.errors.length
								? `，${preview.errors.length} 行需要修正。`
								: "。"}
						</p>
						{preview.errors.length ? (
							<ul className="max-h-56 space-y-2 overflow-y-auto border p-3 text-xs">
								{preview.errors.map((error) => (
									<li key={`${error.row}-${error.code}`}>
										<p>
											第 {error.row} 行：{error.message}
										</p>
										{error.duplicateCandidate ? (
											<Link
												className="text-primary underline-offset-4 hover:underline"
												to="/students"
												search={{ studentId: error.duplicateCandidate.id }}
												onClick={closeDialog}
											>
												查看 {error.duplicateCandidate.name}（
												{error.duplicateCandidate.phoneMasked}）
											</Link>
										) : null}
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={closeDialog}>
						取消
					</Button>
					<Button
						disabled={
							!content ||
							!requestId ||
							!preview?.validRows ||
							previewMutation.isPending ||
							confirmMutation.isPending
						}
						onClick={() =>
							content &&
							requestId &&
							confirmMutation.mutate({ content, requestId })
						}
					>
						{confirmMutation.isPending ? "正在导入" : "确认导入"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FilterSelect({
	label,
	value,
	onValueChange,
	items,
}: {
	label: string;
	value: string;
	onValueChange: (value: string) => void;
	items: Array<{ value: string; label: string }>;
}) {
	return (
		<Select value={value} onValueChange={(next) => next && onValueChange(next)}>
			<SelectTrigger className="w-full" aria-label={label}>
				<SelectValue>
					{() => items.find((item) => item.value === value)?.label ?? label}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function StudentResults({
	items,
	isFiltered,
	isPending,
	isError,
	onRetry,
	onEdit,
	onTimeline,
	selectedIds,
	onToggleSelected,
}: {
	items: StudentSummary[];
	isFiltered: boolean;
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selectedIds: ReadonlySet<string>;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	if (isPending)
		return (
			<div className="space-y-2 border p-3">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	if (isError)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>学员加载失败</EmptyTitle>
					<EmptyDescription>暂时无法加载学员档案，请重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={onRetry}>重试</Button>
			</Empty>
		);
	if (!items.length)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>
						{isFiltered ? "没有匹配的学员" : "还没有学员档案"}
					</EmptyTitle>
					<EmptyDescription>
						{isFiltered
							? "试试调整搜索词或筛选条件。"
							: "新增学员，开始维护其联系人和状态。"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<section className="border">
			<div className="hidden md:block">
				<Table>
					<TableCaption className="sr-only">学员列表</TableCaption>
					<TableHeader>
						<TableRow>
							{onToggleSelected ? (
								<TableHead className="w-12">
									<span className="sr-only">选择</span>
								</TableHead>
							) : null}
							<TableHead>学员</TableHead>
							<TableHead>校区</TableHead>
							<TableHead>主要联系人</TableHead>
							<TableHead>负责人</TableHead>
							<TableHead>状态与标签</TableHead>
							<TableHead className="text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((student) => (
							<StudentTableRow
								key={student.id}
								student={student}
								onEdit={onEdit}
								onTimeline={onTimeline}
								selected={selectedIds.has(student.id)}
								onToggleSelected={onToggleSelected}
							/>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y md:hidden">
				{items.map((student) => (
					<StudentCompactRow
						key={student.id}
						student={student}
						onEdit={onEdit}
						onTimeline={onTimeline}
						selected={selectedIds.has(student.id)}
						onToggleSelected={onToggleSelected}
					/>
				))}
			</div>
		</section>
	);
}

function StudentTableRow({
	student,
	onEdit,
	onTimeline,
	selected,
	onToggleSelected,
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selected: boolean;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	return (
		<TableRow>
			{onToggleSelected ? (
				<TableCell>
					<Checkbox
						aria-label={`选择 ${student.name}`}
						checked={selected}
						onCheckedChange={(checked) =>
							onToggleSelected(student, checked === true)
						}
					/>
				</TableCell>
			) : null}
			<TableCell>
				<p className="font-medium">{student.name}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					创建于 {formatDate(student.createdAt)}
				</p>
			</TableCell>
			<TableCell>{student.campusName}</TableCell>
			<TableCell>
				<p>{student.primaryContactName}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					{student.primaryContactPhoneMasked}
				</p>
			</TableCell>
			<TableCell>{student.ownerName ?? "未分配"}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1">
					<StudentStatusBadge status={student.status} />
					{student.tags.map((tag) => (
						<Badge key={tag.id} variant="outline">
							{tag.name}
							{!tag.isActive ? "（已停用）" : ""}
						</Badge>
					))}
				</div>
			</TableCell>
			<TableCell className="text-right">
				<Button size="sm" variant="ghost" onClick={() => onTimeline(student)}>
					<HistoryIcon data-icon="inline-start" />
					时间线
				</Button>
				<Button size="sm" variant="ghost" onClick={() => onEdit(student)}>
					<PencilIcon data-icon="inline-start" />
					编辑
				</Button>
			</TableCell>
		</TableRow>
	);
}

function StudentCompactRow({
	student,
	onEdit,
	onTimeline,
	selected,
	onToggleSelected,
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
	onTimeline: (student: StudentSummary) => void;
	selected: boolean;
	onToggleSelected?: (student: StudentSummary, checked: boolean) => void;
}) {
	return (
		<article className="flex flex-col gap-3 p-3">
			{onToggleSelected ? (
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor={`student-select-mobile-${student.id}`}
				>
					<Checkbox
						id={`student-select-mobile-${student.id}`}
						checked={selected}
						onCheckedChange={(checked) =>
							onToggleSelected(student, checked === true)
						}
					/>
					选择 {student.name}
				</label>
			) : null}
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium">{student.name}</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{student.campusName} · {student.primaryContactName} ·{" "}
						{student.primaryContactPhoneMasked}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						负责人：{student.ownerName ?? "未分配"}
					</p>
				</div>
				<StudentStatusBadge status={student.status} />
			</div>
			{student.tags.length ? (
				<div className="flex flex-wrap gap-1">
					{student.tags.map((tag) => (
						<Badge key={tag.id} variant="outline">
							{tag.name}
						</Badge>
					))}
				</div>
			) : null}
			<Button
				className="self-start"
				size="sm"
				variant="outline"
				onClick={() => onTimeline(student)}
			>
				<HistoryIcon data-icon="inline-start" />
				业务时间线
			</Button>
			<Button
				className="self-start"
				size="sm"
				variant="outline"
				onClick={() => onEdit(student)}
			>
				<PencilIcon data-icon="inline-start" />
				编辑档案
			</Button>
		</article>
	);
}

function StudentStatusBadge({ status }: { status: StudentStatus }) {
	return (
		<Badge
			variant={
				status === "atRisk"
					? "destructive"
					: status === "active"
						? "default"
						: "secondary"
			}
		>
			{studentStatuses.find((item) => item.value === status)?.label}
		</Badge>
	);
}

function StudentMergeDialog({
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

function StudentEditor({
	editor,
	campuses,
	tags,
	onClose,
}: {
	editor: Exclude<EditorTarget, null>;
	campuses: Campus[];
	tags: StudentTag[];
	onClose: () => void;
}) {
	const isEditing = editor !== "new";
	const studentId = isEditing
		? editor.id
		: "00000000-0000-0000-0000-000000000000";
	const detailOptions = orpc.training.students.get.queryOptions({
		input: { id: studentId },
	});
	const detailQuery = useQuery({ ...detailOptions, enabled: isEditing });
	const [values, setValues] = useState<StudentFormValues>(emptyStudentForm);
	const ownerCandidatesQuery = useQuery({
		...orpc.training.students.ownerCandidates.queryOptions({
			input: {
				campusId: values.campusId || "00000000-0000-0000-0000-000000000000",
			},
		}),
		enabled: Boolean(values.campusId),
	});
	const [formError, setFormError] = useState<string | null>(null);
	const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
	const [hasInitializedDraft, setHasInitializedDraft] = useState(false);
	const [hasVersionConflict, setHasVersionConflict] = useState(false);
	const [isRefreshingDetails, setIsRefreshingDetails] = useState(false);
	const duplicateCandidateQueries = useQueries({
		queries: values.contacts.map((contact) => ({
			...orpc.training.students.duplicateCandidates.queryOptions({
				input: {
					phone: contact.phone.trim() || "00000",
					...(isEditing ? { excludeStudentId: studentId } : {}),
				},
			}),
			enabled: contact.phone.trim().length >= 5,
		})),
	});
	const duplicateCandidates = useMemo(
		() =>
			Array.from(
				new Map(
					duplicateCandidateQueries
						.flatMap((query) => query.data?.items ?? [])
						.map((candidate) => [candidate.id, candidate]),
				).values(),
			),
		[duplicateCandidateQueries],
	);
	useEffect(() => {
		if (!hasInitializedDraft && detailQuery.data) {
			setValues(toStudentForm(detailQuery.data));
			setExpectedVersion(detailQuery.data.version);
			setHasInitializedDraft(true);
		}
	}, [detailQuery.data, hasInitializedDraft]);
	const createMutation = useMutation(
		orpc.training.students.create.mutationOptions({
			onSuccess: () => {
				toast.success("学员已新增");
				void invalidateStudentQueries();
				onClose();
			},
			onError: (error) => toast.error(`创建失败：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.students.update.mutationOptions({
			onSuccess: (updatedStudent) => {
				queryClient.setQueryData(detailOptions.queryKey, updatedStudent);
				toast.success("学员档案已更新");
				void invalidateStudentQueries();
				onClose();
			},
			onError: (error) => {
				if (isConflictError(error)) {
					setHasVersionConflict(true);
					setFormError(
						"当前资料已被其他人更新。请刷新最新资料后检查草稿，再次保存。",
					);
					return;
				}
				toast.error(`保存失败：${error.message}`);
			},
		}),
	);
	const pending =
		createMutation.isPending || updateMutation.isPending || isRefreshingDetails;
	const activeCampuses = campuses.filter((campus) => campus.isActive);
	const availableTags = mergeTags(tags, detailQuery.data?.tags ?? []);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalized = {
			...values,
			birthDate: values.birthDate || null,
			contacts: values.contacts.map((contact) => ({
				...contact,
				relationship: contact.relationship.trim() || null,
			})),
		};
		if (isEditing) {
			if (!expectedVersion) {
				setFormError("未能获取资料版本，请刷新页面后重试。");
				return;
			}
			const parsed = updateStudentInputSchema.safeParse({
				id: studentId,
				expectedVersion,
				data: omitCampus(normalized),
			});
			if (!parsed.success) {
				setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
				return;
			}
			setFormError(null);
			updateMutation.mutate(parsed.data);
			return;
		}
		const parsed = createStudentInputSchema.safeParse(normalized);
		if (!parsed.success) {
			setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
			return;
		}
		setFormError(null);
		createMutation.mutate(parsed.data);
	}

	async function refreshLatestDetails() {
		setIsRefreshingDetails(true);
		try {
			const result = await detailQuery.refetch();
			if (result.isSuccess && result.data) {
				setExpectedVersion(result.data.version);
				setHasVersionConflict(false);
				setFormError(null);
				toast.success("已刷新最新资料版本，当前草稿未改动。");
				return;
			}
			setFormError("无法刷新最新资料，请稍后重试。");
		} finally {
			setIsRefreshingDetails(false);
		}
	}

	const detailLoading =
		isEditing && detailQuery.isPending && !hasInitializedDraft;
	const detailError = isEditing && detailQuery.isError && !hasInitializedDraft;
	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{isEditing ? "编辑学员档案" : "新增学员"}</DialogTitle>
					<DialogDescription>
						{isEditing
							? "校区归属创建后不可直接修改。"
							: "请填写基础资料并指定一位主要联系人。"}
					</DialogDescription>
				</DialogHeader>
				{detailLoading ? (
					<div className="space-y-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-32 w-full" />
					</div>
				) : detailError ? (
					<div className="flex flex-col gap-3">
						<p className="text-destructive text-sm">
							无法加载学员详情：{detailQuery.error.message}
						</p>
						<Button
							className="self-start"
							variant="outline"
							onClick={() => void detailQuery.refetch()}
						>
							重试
						</Button>
					</div>
				) : (
					<form className="flex flex-col gap-5" onSubmit={submit} noValidate>
						<div className="grid gap-4 sm:grid-cols-2">
							<TextField
								id="student-name"
								label="学员姓名"
								value={values.name}
								onChange={(name) =>
									setValues((current) => ({ ...current, name }))
								}
								required
							/>
							<Field>
								<FieldLabel htmlFor="student-campus">所属校区</FieldLabel>
								{isEditing ? (
									<Input
										id="student-campus"
										readOnly
										value={editor.campusName}
									/>
								) : (
									<Select
										value={values.campusId}
										onValueChange={(campusId) =>
											campusId &&
											setValues((current) => ({
												...current,
												campusId,
												ownerUserId: null,
											}))
										}
									>
										<SelectTrigger id="student-campus">
											<SelectValue>
												{() =>
													activeCampuses.find(
														(campus) => campus.id === values.campusId,
													)?.name ?? "选择校区"
												}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{activeCampuses.map((campus) => (
													<SelectItem key={campus.id} value={campus.id}>
														{campus.name}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								)}
							</Field>
							<Field>
								<FieldLabel htmlFor="student-owner">运营负责人</FieldLabel>
								<Select
									value={values.ownerUserId ?? "unassigned"}
									onValueChange={(ownerUserId) =>
										ownerUserId &&
										setValues((current) => ({
											...current,
											ownerUserId:
												ownerUserId === "unassigned" ? null : ownerUserId,
										}))
									}
									disabled={!values.campusId || ownerCandidatesQuery.isPending}
								>
									<SelectTrigger id="student-owner">
										<SelectValue>
											{() =>
												ownerCandidatesQuery.data?.items.find(
													(item) => item.userId === values.ownerUserId,
												)?.name ?? "未分配"
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											<SelectItem value="unassigned">未分配</SelectItem>
											{(ownerCandidatesQuery.data?.items ?? []).map((owner) => (
												<SelectItem key={owner.userId} value={owner.userId}>
													{owner.name} · {owner.email}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								{ownerCandidatesQuery.isError ? (
									<FieldError>负责人列表加载失败，请稍后重试。</FieldError>
								) : null}
							</Field>
							<TextField
								id="student-birth-date"
								label="出生日期"
								type="date"
								value={values.birthDate}
								onChange={(birthDate) =>
									setValues((current) => ({ ...current, birthDate }))
								}
							/>
							<Field>
								<FieldLabel htmlFor="student-status">学员状态</FieldLabel>
								<Select
									value={values.status}
									onValueChange={(status) =>
										status &&
										setValues((current) => ({
											...current,
											status: status as StudentStatus,
										}))
									}
								>
									<SelectTrigger id="student-status">
										<SelectValue>
											{() =>
												studentStatuses.find(
													(item) => item.value === values.status,
												)?.label
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{studentStatuses.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						</div>
						<ContactsEditor
							contacts={values.contacts}
							duplicateCandidates={duplicateCandidates}
							isCheckingDuplicates={duplicateCandidateQueries.some(
								(query) => query.isFetching,
							)}
							onChange={(contacts) =>
								setValues((current) => ({ ...current, contacts }))
							}
						/>
						<TagSelector
							tags={availableTags}
							selectedIds={values.tagIds}
							onChange={(tagIds) =>
								setValues((current) => ({ ...current, tagIds }))
							}
						/>
						{hasVersionConflict ? (
							<div
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-3"
								role="alert"
							>
								<p className="text-destructive text-sm">
									资料已被其他人更新，当前填写内容已保留。
								</p>
								<Button
									type="button"
									variant="outline"
									disabled={pending}
									onClick={() => void refreshLatestDetails()}
								>
									{isRefreshingDetails ? (
										<LoaderCircleIcon
											className="animate-spin"
											data-icon="inline-start"
										/>
									) : null}
									刷新最新资料
								</Button>
							</div>
						) : null}
						{formError ? <FieldError match>{formError}</FieldError> : null}
						<DialogFooter className="flex-col-reverse sm:flex-row">
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={onClose}
							>
								取消
							</Button>
							<Button type="submit" disabled={pending}>
								{pending ? (
									<LoaderCircleIcon
										className="animate-spin"
										data-icon="inline-start"
									/>
								) : (
									<UserPlusIcon data-icon="inline-start" />
								)}
								{isEditing ? "保存" : "创建学员"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	type = "text",
	required = false,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: "text" | "date" | "tel";
	required?: boolean;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type={type}
				required={required}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

function ContactsEditor({
	contacts,
	duplicateCandidates,
	isCheckingDuplicates,
	onChange,
}: {
	contacts: StudentFormValues["contacts"];
	duplicateCandidates: Array<{
		id: string;
		name: string;
		campusName: string;
		phoneMasked: string;
	}>;
	isCheckingDuplicates: boolean;
	onChange: (contacts: StudentFormValues["contacts"]) => void;
}) {
	function update(
		index: number,
		patch: Partial<StudentFormValues["contacts"][number]>,
	) {
		onChange(
			contacts.map((contact, currentIndex) =>
				currentIndex === index ? { ...contact, ...patch } : contact,
			),
		);
	}
	return (
		<section className="space-y-3" aria-labelledby="contacts-heading">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 id="contacts-heading" className="font-medium text-sm">
						联系人
					</h2>
					<p className="text-muted-foreground text-xs">
						至少一位，且必须指定一位主要联系人。
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={contacts.length >= 10}
					onClick={() =>
						onChange([
							...contacts,
							{ name: "", phone: "", relationship: "", isPrimary: false },
						])
					}
				>
					<PlusIcon data-icon="inline-start" />
					添加联系人
				</Button>
			</div>
			<div className="space-y-3">
				{contacts.map((contact, index) => (
					<div
						key={contact.id ?? `new-${index}`}
						className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
					>
						<TextField
							id={`contact-name-${index}`}
							label="姓名"
							required
							value={contact.name}
							onChange={(name) => update(index, { name })}
						/>
						<TextField
							id={`contact-phone-${index}`}
							label="手机号"
							type="tel"
							required
							value={contact.phone}
							onChange={(phone) => update(index, { phone })}
						/>
						<TextField
							id={`contact-relationship-${index}`}
							label="关系称谓（可选）"
							value={contact.relationship}
							onChange={(relationship) => update(index, { relationship })}
						/>
						<div className="flex flex-wrap items-end justify-between gap-3">
							<label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
								<input
									type="radio"
									name="primary-contact"
									checked={contact.isPrimary}
									onChange={() =>
										onChange(
											contacts.map((item, currentIndex) => ({
												...item,
												isPrimary: currentIndex === index,
											})),
										)
									}
								/>
								主要联系人
							</label>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={contacts.length === 1}
								onClick={() => {
									const remaining = contacts.filter(
										(_, currentIndex) => currentIndex !== index,
									);
									if (contact.isPrimary)
										remaining[0] = { ...remaining[0], isPrimary: true };
									onChange(remaining);
								}}
							>
								删除
							</Button>
						</div>
					</div>
				))}
			</div>
			{isCheckingDuplicates ? (
				<p className="text-muted-foreground text-xs">正在检查疑似重复档案…</p>
			) : duplicateCandidates.length > 0 ? (
				<div className="border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
					<p className="font-medium">发现疑似重复学员</p>
					<p className="mt-1 text-muted-foreground text-xs">
						匹配仅基于同机构的标准化手机号，不会阻止保存；请确认是否应使用已有档案。
					</p>
					<ul className="mt-2 grid gap-1 text-xs">
						{duplicateCandidates.map((candidate) => (
							<li key={candidate.id}>
								{candidate.name} · {candidate.campusName} ·{" "}
								{candidate.phoneMasked}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function TagSelector({
	tags,
	selectedIds,
	onChange,
}: {
	tags: StudentTag[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}) {
	return (
		<fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
			<legend className="font-medium text-sm">运营标签</legend>
			<div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
				{tags.length ? (
					tags.map((tag) => {
						const checked = selectedIds.includes(tag.id);
						return (
							<label
								key={tag.id}
								htmlFor={`student-tag-${tag.id}`}
								className="flex w-fit cursor-pointer items-center gap-2 text-sm"
							>
								<Checkbox
									id={`student-tag-${tag.id}`}
									checked={checked}
									disabled={!tag.isActive && !checked}
									onCheckedChange={(next) =>
										onChange(
											next
												? [...selectedIds, tag.id]
												: selectedIds.filter((id) => id !== tag.id),
										)
									}
								/>
								<span>{tag.name}</span>
								{!tag.isActive ? (
									<Badge variant="secondary">已停用</Badge>
								) : null}
							</label>
						);
					})
				) : (
					<p className="text-muted-foreground text-sm">暂无可选标签。</p>
				)}
			</div>
			<p className="mt-2 text-muted-foreground text-xs">
				已停用标签会保留在历史档案中，不能新增分配。
			</p>
		</fieldset>
	);
}

function TagManager({
	open,
	tags,
	onOpenChange,
}: {
	open: boolean;
	tags: StudentTag[];
	onOpenChange: (open: boolean) => void;
}) {
	const [newName, setNewName] = useState("");
	const [editing, setEditing] = useState<StudentTag | null>(null);
	const [editingName, setEditingName] = useState("");
	const createMutation = useMutation(
		orpc.training.students.tags.create.mutationOptions({
			onSuccess: () => {
				toast.success("标签已创建");
				setNewName("");
				void invalidateTagQueries();
			},
			onError: (error) => toast.error(`创建失败：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.students.tags.update.mutationOptions({
			onSuccess: () => {
				toast.success("标签已改名");
				setEditing(null);
				void invalidateTagQueries();
			},
			onError: (error) => toast.error(`保存失败：${error.message}`),
		}),
	);
	const activeMutation = useMutation(
		orpc.training.students.tags.setActive.mutationOptions({
			onSuccess: () => {
				toast.success("标签状态已更新");
				void invalidateTagQueries();
			},
			onError: (error) => toast.error(`更新失败：${error.message}`),
		}),
	);
	const pending =
		createMutation.isPending ||
		updateMutation.isPending ||
		activeMutation.isPending;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>管理学员标签</DialogTitle>
					<DialogDescription>
						停用标签会保留在已有学员档案中，不能再分配给新学员。
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const name = newName.trim();
						if (!name) {
							toast.error("请输入标签名称");
							return;
						}
						createMutation.mutate({ name });
					}}
				>
					<Input
						aria-label="新标签名称"
						maxLength={30}
						value={newName}
						onChange={(event) => setNewName(event.target.value)}
						placeholder="例如：重点跟进"
					/>
					<Button type="submit" disabled={pending}>
						<PlusIcon data-icon="inline-start" />
						创建
					</Button>
				</form>
				<div className="divide-y rounded-md border">
					{tags.length ? (
						tags.map((tag) => (
							<div
								key={tag.id}
								className="flex flex-wrap items-center gap-2 p-3"
							>
								{editing?.id === tag.id ? (
									<form
										className="flex min-w-0 flex-1 gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											const name = editingName.trim();
											if (!name) return;
											updateMutation.mutate({ id: tag.id, name });
										}}
									>
										<Input
											aria-label="标签名称"
											maxLength={30}
											value={editingName}
											onChange={(event) => setEditingName(event.target.value)}
										/>
										<Button size="sm" type="submit" disabled={pending}>
											保存
										</Button>
										<Button
											size="sm"
											type="button"
											variant="ghost"
											disabled={pending}
											onClick={() => setEditing(null)}
										>
											取消
										</Button>
									</form>
								) : (
									<>
										<span className="min-w-0 flex-1 break-words text-sm">
											{tag.name}
										</span>
										<Badge variant={tag.isActive ? "secondary" : "outline"}>
											{tag.isActive ? "启用中" : "已停用"}
										</Badge>
										<Button
											size="sm"
											variant="ghost"
											disabled={pending}
											onClick={() => {
												setEditing(tag);
												setEditingName(tag.name);
											}}
										>
											<PencilIcon data-icon="inline-start" />
											改名
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={() =>
												activeMutation.mutate({
													id: tag.id,
													isActive: !tag.isActive,
												})
											}
										>
											<PowerIcon data-icon="inline-start" />
											{tag.isActive ? "停用" : "启用"}
										</Button>
									</>
								)}
							</div>
						))
					) : (
						<p className="p-3 text-muted-foreground text-sm">还没有标签。</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

const emptyStudentForm: StudentFormValues = {
	name: "",
	campusId: "",
	ownerUserId: null,
	birthDate: "",
	status: "trial",
	contacts: [{ name: "", phone: "", relationship: "", isPrimary: true }],
	tagIds: [],
};
function toStudentForm(student: StudentDetail): StudentFormValues {
	return {
		name: student.name,
		campusId: student.campusId,
		ownerUserId: student.ownerUserId,
		birthDate: student.birthDate ?? "",
		status: student.status,
		contacts: student.contacts.map((contact) => ({
			...contact,
			relationship: contact.relationship ?? "",
		})),
		tagIds: student.tags.map((tag) => tag.id),
	};
}
function omitCampus(
	values: Omit<StudentFormValues, "birthDate" | "contacts"> & {
		birthDate: string | null;
		contacts: Array<{
			id?: string;
			name: string;
			phone: string;
			relationship: string | null;
			isPrimary: boolean;
		}>;
	},
) {
	const { campusId: _, ...data } = values;
	return data;
}
function mergeTags(tags: StudentTag[], assigned: StudentTag[]) {
	return [
		...tags,
		...assigned.filter(
			(assignedTag) => !tags.some((tag) => tag.id === assignedTag.id),
		),
	];
}
function isConflictError(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "CONFLICT" &&
		"data" in error &&
		typeof error.data === "object" &&
		error.data !== null &&
		"reason" in error.data &&
		error.data.reason === "STUDENT_VERSION_CONFLICT"
	);
}
function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(value));
}
function invalidateStudentQueries() {
	return queryClient.invalidateQueries({
		queryKey: orpc.training.students.list.key(),
	});
}
function invalidateTagQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.tags.list.key(),
		}),
		invalidateStudentQueries(),
	]);
}
