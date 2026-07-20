import {
	type Campus,
	type CreateStudentInput,
	createStudentInputSchema,
	type StudentDetail,
	type StudentListResult,
	type StudentStatus,
	type StudentTag,
	type UpdateStudentInput,
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
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	PowerIcon,
	SearchIcon,
	TagsIcon,
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
import { IndependentEnrollmentDialog } from "@/features/training/independent-enrollment-dialog";
import { useOrganization } from "@/features/training/organization-context";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/students")({
	component: StudentsRoute,
});

type StudentSummary = StudentListResult["items"][number];
type StudentFormValues = {
	name: string;
	campusId: string;
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
	{ value: "graduated", label: "已结业" },
];

function StudentsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { organization } = useOrganization();
	const [search, setSearch] = useState("");
	const [campusId, setCampusId] = useState<string | null>(null);
	const [status, setStatus] = useState<"all" | StudentStatus>("all");
	const [tagId, setTagId] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorTarget>(null);
	const [independentEnrollmentOpen, setIndependentEnrollmentOpen] =
		useState(false);
	const [tagsOpen, setTagsOpen] = useState(false);
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
	const filters = useMemo(
		() => ({
			query: deferredSearch || undefined,
			campusId: campusId ?? undefined,
			status,
			tagId: tagId ?? undefined,
			pageSize: 20,
		}),
		[campusId, deferredSearch, status, tagId],
	);
	const listQuery = useInfiniteQuery({
		queryKey: ["training-students", organization.id, sessionUserId, filters],
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
	const isFiltered = Boolean(search || campusId || tagId || status !== "all");
	const canManageTags =
		organization.role === "owner" || organization.role === "admin";

	function clearFilters() {
		setSearch("");
		setCampusId(null);
		setStatus("all");
		setTagId(null);
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
			<section className="grid gap-3 border p-3 md:grid-cols-2 xl:grid-cols-4">
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
				{isFiltered ? (
					<Button
						type="button"
						variant="ghost"
						className="md:col-span-2 md:justify-self-end xl:col-span-4"
						onClick={clearFilters}
					>
						清除筛选
					</Button>
				) : null}
			</section>
			<StudentResults
				items={items}
				isFiltered={isFiltered}
				isPending={listQuery.isPending}
				isError={listQuery.isError}
				onRetry={() => void listQuery.refetch()}
				onEdit={setEditor}
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
		</div>
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
}: {
	items: StudentSummary[];
	isFiltered: boolean;
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
	onEdit: (student: StudentSummary) => void;
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
							<TableHead>学员</TableHead>
							<TableHead>校区</TableHead>
							<TableHead>主要联系人</TableHead>
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
					/>
				))}
			</div>
		</section>
	);
}

function StudentTableRow({
	student,
	onEdit,
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
}) {
	return (
		<TableRow>
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
}: {
	student: StudentSummary;
	onEdit: (student: StudentSummary) => void;
}) {
	return (
		<article className="flex flex-col gap-3 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium">{student.name}</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{student.campusName} · {student.primaryContactName} ·{" "}
						{student.primaryContactPhoneMasked}
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
	const [formError, setFormError] = useState<string | null>(null);
	const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(
		null,
	);
	const [hasInitializedDraft, setHasInitializedDraft] = useState(false);
	const [hasVersionConflict, setHasVersionConflict] = useState(false);
	const [isRefreshingDetails, setIsRefreshingDetails] = useState(false);
	const [graduationPayload, setGraduationPayload] = useState<
		CreateStudentInput | UpdateStudentInput | null
	>(null);
	useEffect(() => {
		if (!hasInitializedDraft && detailQuery.data) {
			setValues(toStudentForm(detailQuery.data));
			setExpectedUpdatedAt(detailQuery.data.updatedAt);
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
			if (!expectedUpdatedAt) {
				setFormError("未能获取资料版本，请刷新页面后重试。");
				return;
			}
			const parsed = updateStudentInputSchema.safeParse({
				id: studentId,
				expectedUpdatedAt,
				data: omitCampus(normalized),
			});
			if (!parsed.success) {
				setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
				return;
			}
			setFormError(null);
			if (
				editor.status !== "graduated" &&
				parsed.data.data.status === "graduated"
			) {
				setGraduationPayload(parsed.data);
				return;
			}
			updateMutation.mutate(parsed.data);
			return;
		}
		const parsed = createStudentInputSchema.safeParse(normalized);
		if (!parsed.success) {
			setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
			return;
		}
		setFormError(null);
		if (parsed.data.status === "graduated") {
			setGraduationPayload(parsed.data);
			return;
		}
		createMutation.mutate(parsed.data);
	}

	async function refreshLatestDetails() {
		setIsRefreshingDetails(true);
		try {
			const result = await detailQuery.refetch();
			if (result.isSuccess && result.data) {
				setExpectedUpdatedAt(result.data.updatedAt);
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

	function confirmGraduation() {
		if (!graduationPayload) return;
		if ("id" in graduationPayload) updateMutation.mutate(graduationPayload);
		else createMutation.mutate(graduationPayload);
		setGraduationPayload(null);
	}
	const detailLoading =
		isEditing && detailQuery.isPending && !hasInitializedDraft;
	const detailError = isEditing && detailQuery.isError && !hasInitializedDraft;
	return (
		<>
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
												setValues((current) => ({ ...current, campusId }))
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
			<Dialog
				open={graduationPayload !== null}
				onOpenChange={(open) => !open && setGraduationPayload(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>确认更新为已结业</DialogTitle>
						<DialogDescription>
							结业仅更新学员生命周期状态，不会修改报名、账单、收款或课时记录。
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							variant="outline"
							disabled={pending}
							onClick={() => setGraduationPayload(null)}
						>
							返回修改
						</Button>
						<Button disabled={pending} onClick={confirmGraduation}>
							{pending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							确认结业
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
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
	onChange,
}: {
	contacts: StudentFormValues["contacts"];
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
	birthDate: "",
	status: "trial",
	contacts: [{ name: "", phone: "", relationship: "", isPrimary: true }],
	tagIds: [],
};
function toStudentForm(student: StudentDetail): StudentFormValues {
	return {
		name: student.name,
		campusId: student.campusId,
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
	return queryClient.invalidateQueries({ queryKey: ["training-students"] });
}
function invalidateTagQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.tags.list.key(),
		}),
		invalidateStudentQueries(),
	]);
}
