import {
	type CreateIndependentEnrollmentInput,
	createIndependentEnrollmentInputSchema,
	type IndependentEnrollmentOptions,
	type StudentListResult,
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
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	LoaderCircleIcon,
	SearchIcon,
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
import { client, orpc, queryClient } from "@/utils/orpc";
import {
	EnrollmentCampusField,
	EnrollmentClassField,
	EnrollmentCourseField,
	EnrollmentTextField,
} from "./enrollment-form-fields";
import {
	formatCentsAsYuan,
	getShanghaiToday,
	parseNonNegativeYuanToCents,
} from "./finance-form-utils";
import { useOrganization } from "./organization-context";

type StudentMode = "existing" | "new";
type StudentSummary = StudentListResult["items"][number];
type EnrollmentErrorKey =
	| "studentId"
	| "studentName"
	| "campusId"
	| "contactName"
	| "contactPhone"
	| "contactRelationship"
	| "source"
	| "courseId"
	| "classGroupId"
	| "purchasedLessons"
	| "amountInCents"
	| "invoiceDueDate";
type EnrollmentErrors = Partial<Record<EnrollmentErrorKey, string>>;

const enrollableStatuses = new Set(["active", "trial", "atRisk"]);

export function IndependentEnrollmentDialog({
	onClose,
}: {
	onClose: () => void;
}) {
	const { organization } = useOrganization();
	const navigate = useNavigate();
	const optionsQueryOptions =
		orpc.training.enrollments.independentOptions.queryOptions({ input: {} });
	const optionsQuery = useQuery({
		...optionsQueryOptions,
		queryKey: [
			...optionsQueryOptions.queryKey,
			{ organizationId: organization.id },
		],
	});
	const mutation = useMutation(
		orpc.training.enrollments.createIndependent.mutationOptions({
			onSuccess: () => {
				toast.success("报名和应收账单已创建", {
					action: {
						label: "前往收款",
						onClick: () => void navigate({ to: "/finance" }),
					},
				});
				void invalidateEnrollmentQueries();
				onClose();
			},
		}),
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>办理报名</DialogTitle>
					<DialogDescription>
						为已有学员办理报名，或同时创建新学员、主要联系人和应收账单。
					</DialogDescription>
				</DialogHeader>
				{optionsQuery.isPending ? (
					<EnrollmentSkeleton />
				) : optionsQuery.isError ? (
					<Empty className="min-h-64 border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<UsersRoundIcon />
							</EmptyMedia>
							<EmptyTitle>报名选项加载失败</EmptyTitle>
							<EmptyDescription>{optionsQuery.error.message}</EmptyDescription>
						</EmptyHeader>
						<Button onClick={() => void optionsQuery.refetch()}>重试</Button>
					</Empty>
				) : (
					<IndependentEnrollmentForm
						options={optionsQuery.data}
						pending={mutation.isPending}
						onCancel={onClose}
						onSubmit={(input) => mutation.mutate(input)}
						serverError={mutation.error}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function IndependentEnrollmentForm({
	options,
	pending,
	onCancel,
	onSubmit,
	serverError,
}: {
	options: IndependentEnrollmentOptions;
	pending: boolean;
	onCancel: () => void;
	onSubmit: (input: CreateIndependentEnrollmentInput) => void;
	serverError: unknown;
}) {
	const [mode, setMode] = useState<StudentMode>("existing");
	const [studentQuery, setStudentQuery] = useState("");
	const deferredStudentQuery = useDeferredValue(studentQuery.trim());
	const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(
		null,
	);
	const [studentName, setStudentName] = useState("");
	const [campusId, setCampusId] = useState("");
	const [contactName, setContactName] = useState("");
	const [contactPhone, setContactPhone] = useState("");
	const [contactRelationship, setContactRelationship] = useState("");
	const [courseId, setCourseId] = useState(options.courses[0]?.id ?? "");
	const [classGroupId, setClassGroupId] = useState<string | null>(null);
	const initialCourse = options.courses[0];
	const [purchasedLessons, setPurchasedLessons] = useState(
		initialCourse ? String(initialCourse.lessonsPerPackage) : "",
	);
	const [amountInYuan, setAmountInYuan] = useState(
		initialCourse ? formatCentsAsYuan(initialCourse.listPriceInCents) : "",
	);
	const [invoiceDueDate, setInvoiceDueDate] = useState(getShanghaiToday);
	const [source, setSource] =
		useState<CreateIndependentEnrollmentInput["source"]>("walk_in");
	const [providerUserId, setProviderUserId] = useState<string | null>(null);
	const [conversionOwnerUserId, setConversionOwnerUserId] = useState<
		string | null
	>(null);
	const [adjustStudentOwner, setAdjustStudentOwner] = useState(false);
	const [requestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<EnrollmentErrors>({});
	const duplicateCandidatesQuery = useQuery({
		...orpc.training.students.duplicateCandidates.queryOptions({
			input: { phone: contactPhone.trim() || "00000" },
		}),
		enabled: mode === "new" && contactPhone.trim().length >= 5,
	});

	const studentListQuery = useInfiniteQuery({
		queryKey: ["independent-enrollment-students", deferredStudentQuery],
		queryFn: ({ pageParam }) =>
			client.training.students.list({
				query: deferredStudentQuery || undefined,
				status: "all",
				pageSize: 10,
				cursor: pageParam ?? undefined,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: mode === "existing",
	});
	const students =
		studentListQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const selectedCampusId =
		mode === "existing" ? selectedStudent?.campusId : campusId;
	const ownerCandidatesQuery = useQuery({
		...orpc.training.students.ownerCandidates.queryOptions({
			input: {
				campusId: selectedCampusId ?? "00000000-0000-0000-0000-000000000000",
			},
		}),
		enabled: Boolean(selectedCampusId),
	});
	useEffect(() => {
		if (!ownerCandidatesQuery.data) return;
		const candidateIds = new Set(
			ownerCandidatesQuery.data.items.map((candidate) => candidate.userId),
		);
		if (conversionOwnerUserId && !candidateIds.has(conversionOwnerUserId)) {
			setConversionOwnerUserId(null);
		}
		if (providerUserId && !candidateIds.has(providerUserId)) {
			setProviderUserId(null);
		}
	}, [conversionOwnerUserId, ownerCandidatesQuery.data, providerUserId]);
	const availableClasses = useMemo(
		() =>
			options.classes.filter(
				(classGroup) =>
					classGroup.courseId === courseId &&
					classGroup.campusId === selectedCampusId,
			),
		[courseId, options.classes, selectedCampusId],
	);
	const affectedLessons = getAffectedLessons(serverError);

	function clearError(...fields: EnrollmentErrorKey[]) {
		setErrors((current) => {
			const next = { ...current };
			for (const field of fields) delete next[field];
			return next;
		});
	}

	function chooseCourse(nextCourseId: string) {
		const course = options.courses.find((item) => item.id === nextCourseId);
		setCourseId(nextCourseId);
		setClassGroupId(null);
		if (course) {
			setPurchasedLessons(String(course.lessonsPerPackage));
			setAmountInYuan(formatCentsAsYuan(course.listPriceInCents));
		}
		clearError("courseId", "classGroupId", "purchasedLessons", "amountInCents");
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const amountInCents = parseNonNegativeYuanToCents(amountInYuan);
		const lessons = parsePositiveInteger(purchasedLessons);
		const nextErrors: EnrollmentErrors = {};
		if (mode === "existing" && !selectedStudent) {
			nextErrors.studentId = "请选择可报名的已有学员";
		}
		if (mode === "new") {
			if (!studentName.trim()) nextErrors.studentName = "请填写学员姓名";
			if (!campusId) nextErrors.campusId = "请选择所属校区";
			if (!contactName.trim()) nextErrors.contactName = "请填写主要联系人姓名";
			if (!contactPhone.trim())
				nextErrors.contactPhone = "请填写主要联系人手机号";
		}
		if (!courseId) nextErrors.courseId = "请选择课程";
		if (!source) nextErrors.source = "请选择报名来源";
		if (lessons === null)
			nextErrors.purchasedLessons = "请输入 1 至 1000 的整数课时";
		if (amountInCents === null)
			nextErrors.amountInCents = "请输入 0 至 1,000,000 元的有效金额";
		if (!invoiceDueDate) nextErrors.invoiceDueDate = "请选择付款到期日";
		if (
			Object.keys(nextErrors).length > 0 ||
			lessons === null ||
			amountInCents === null
		) {
			setErrors(nextErrors);
			return;
		}

		const input =
			mode === "existing"
				? {
						requestId,
						student: {
							mode: "existing" as const,
							studentId: selectedStudent?.id ?? "",
							expectedVersion: selectedStudent?.version ?? 0,
						},
						source,
						providerUserId,
						conversionOwnerUserId,
						adjustStudentOwner,
						courseId,
						classGroupId,
						purchasedLessons: lessons,
						amountInCents,
						invoiceDueDate,
					}
				: {
						requestId,
						student: {
							mode: "new" as const,
							name: studentName.trim(),
							campusId,
							primaryContact: {
								name: contactName.trim(),
								phone: contactPhone.trim(),
								relationship: contactRelationship.trim() || null,
							},
						},
						source,
						providerUserId,
						conversionOwnerUserId,
						adjustStudentOwner: false,
						courseId,
						classGroupId,
						purchasedLessons: lessons,
						amountInCents,
						invoiceDueDate,
					};
		const parsed = createIndependentEnrollmentInputSchema.safeParse(input);
		if (!parsed.success) {
			const schemaErrors: EnrollmentErrors = {};
			for (const issue of parsed.error.issues) {
				const field = getErrorKey(issue.path);
				if (field && !schemaErrors[field]) schemaErrors[field] = issue.message;
			}
			setErrors(schemaErrors);
			return;
		}
		setErrors({});
		onSubmit(parsed.data);
	}

	return (
		<form className="flex min-w-0 flex-col gap-5" onSubmit={submit}>
			<div
				className="grid gap-2 sm:grid-cols-2"
				role="radiogroup"
				aria-label="报名对象"
			>
				<Button
					type="button"
					variant={mode === "existing" ? "default" : "outline"}
					disabled={pending}
					onClick={() => {
						setMode("existing");
						setClassGroupId(null);
						clearError("studentId", "classGroupId");
					}}
				>
					<UsersRoundIcon data-icon="inline-start" />
					已有学员
				</Button>
				<Button
					type="button"
					variant={mode === "new" ? "default" : "outline"}
					disabled={pending}
					onClick={() => {
						setMode("new");
						setClassGroupId(null);
						clearError(
							"studentName",
							"campusId",
							"contactName",
							"contactPhone",
							"classGroupId",
						);
					}}
				>
					<UserPlusIcon data-icon="inline-start" />
					新建学员
				</Button>
			</div>

			{mode === "existing" ? (
				<ExistingStudentField
					students={students}
					search={studentQuery}
					selectedStudentId={selectedStudent?.id ?? null}
					error={errors.studentId}
					isLoading={studentListQuery.isPending}
					isLoadingMore={studentListQuery.isFetchingNextPage}
					hasMore={studentListQuery.hasNextPage}
					onSearchChange={setStudentQuery}
					onLoadMore={() => void studentListQuery.fetchNextPage()}
					onSelect={(student) => {
						setSelectedStudent(student);
						setClassGroupId(null);
						clearError("studentId", "classGroupId");
					}}
				/>
			) : (
				<NewStudentFields
					campuses={options.campuses}
					studentName={studentName}
					campusId={campusId}
					contactName={contactName}
					contactPhone={contactPhone}
					contactRelationship={contactRelationship}
					duplicateCandidates={duplicateCandidatesQuery.data?.items ?? []}
					isCheckingDuplicates={duplicateCandidatesQuery.isFetching}
					errors={errors}
					onStudentNameChange={(value) => {
						setStudentName(value);
						clearError("studentName");
					}}
					onCampusChange={(value) => {
						setCampusId(value);
						setClassGroupId(null);
						clearError("campusId", "classGroupId");
					}}
					onContactNameChange={(value) => {
						setContactName(value);
						clearError("contactName");
					}}
					onContactPhoneChange={(value) => {
						setContactPhone(value);
						clearError("contactPhone");
					}}
					onContactRelationshipChange={(value) => {
						setContactRelationship(value);
						clearError("contactRelationship");
					}}
				/>
			)}

			<div className="grid min-w-0 gap-4 sm:grid-cols-2">
				<Field invalid={Boolean(errors.source)}>
					<FieldLabel htmlFor="independent-enrollment-source">
						报名来源
					</FieldLabel>
					<Select
						value={source}
						onValueChange={(value) => {
							if (!value) return;
							setSource(value as CreateIndependentEnrollmentInput["source"]);
							clearError("source");
						}}
					>
						<SelectTrigger
							id="independent-enrollment-source"
							className="w-full"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="walk_in">线下咨询</SelectItem>
							<SelectItem value="phone">电话咨询</SelectItem>
							<SelectItem value="referral">转介绍</SelectItem>
							<SelectItem value="online">线上渠道</SelectItem>
							<SelectItem value="other">其他</SelectItem>
						</SelectContent>
					</Select>
					<FieldError match={Boolean(errors.source)}>
						{errors.source}
					</FieldError>
				</Field>

				<Field>
					<FieldLabel htmlFor="independent-enrollment-provider">
						线索提供人
					</FieldLabel>
					<Select
						value={providerUserId ?? "unassigned"}
						onValueChange={(value) =>
							setProviderUserId(value === "unassigned" ? null : (value ?? null))
						}
						disabled={!selectedCampusId || ownerCandidatesQuery.isPending}
					>
						<SelectTrigger
							id="independent-enrollment-provider"
							className="w-full"
						>
							<SelectValue>
								{() =>
									providerUserId
										? (ownerCandidatesQuery.data?.items.find(
												(candidate) => candidate.userId === providerUserId,
											)?.name ?? "请选择")
										: "无提供人"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="unassigned">无提供人</SelectItem>
							{(ownerCandidatesQuery.data?.items ?? []).map((candidate) => (
								<SelectItem key={candidate.userId} value={candidate.userId}>
									{candidate.name} · {candidate.email}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						仅记录获客贡献，可与成交归属人不同。
					</p>
				</Field>
			</div>

			<Field>
				<FieldLabel htmlFor="independent-enrollment-owner">
					成交归属人
				</FieldLabel>
				<Select
					value={conversionOwnerUserId ?? "unassigned"}
					onValueChange={(value) =>
						setConversionOwnerUserId(
							value === "unassigned" ? null : (value ?? null),
						)
					}
					disabled={!selectedCampusId || ownerCandidatesQuery.isPending}
				>
					<SelectTrigger id="independent-enrollment-owner" className="w-full">
						<SelectValue>
							{() =>
								conversionOwnerUserId
									? (ownerCandidatesQuery.data?.items.find(
											(candidate) => candidate.userId === conversionOwnerUserId,
										)?.name ?? "请选择")
									: "未分配"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="unassigned">未分配</SelectItem>
						{(ownerCandidatesQuery.data?.items ?? []).map((candidate) => (
							<SelectItem key={candidate.userId} value={candidate.userId}>
								{candidate.name} · {candidate.email}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-xs">
					该归属会冻结在本次报名中，不随学员负责人变化。
				</p>
				{mode === "existing" ? (
					options.permissions.canAdjustStudentOwner ? (
						<label
							className="flex items-start gap-2 text-sm"
							htmlFor="independent-enrollment-adjust-student-owner"
						>
							<Checkbox
								id="independent-enrollment-adjust-student-owner"
								checked={adjustStudentOwner}
								onCheckedChange={(checked) =>
									setAdjustStudentOwner(checked === true)
								}
							/>
							<span>
								同时调整学员负责人（当前：
								{selectedStudent?.ownerName ?? "未分配"}）
							</span>
						</label>
					) : (
						<p className="text-muted-foreground text-xs">
							已有学员负责人保持不变。
						</p>
					)
				) : (
					<p className="text-muted-foreground text-xs">
						新学员未选择时保持未分配；选择后使用相同人员作为运营负责人。
					</p>
				)}
			</Field>

			<div className="grid min-w-0 gap-4 sm:grid-cols-2">
				<EnrollmentCourseField
					id="independent-enrollment-course"
					courses={options.courses}
					courseId={courseId}
					error={errors.courseId}
					onChange={chooseCourse}
					emptyMessage="暂无启用课程，暂时不能办理报名。"
				/>
				<EnrollmentTextField
					id="independent-enrollment-lessons"
					label="购买课时"
					value={purchasedLessons}
					onChange={(value) => {
						setPurchasedLessons(value);
						clearError("purchasedLessons");
					}}
					error={errors.purchasedLessons}
					type="number"
					min={1}
					max={1000}
					readOnly={!options.permissions.canOverridePackageTerms}
					required
				/>
				<EnrollmentTextField
					id="independent-enrollment-amount"
					label="成交金额（元）"
					value={amountInYuan}
					onChange={(value) => {
						setAmountInYuan(value);
						clearError("amountInCents");
					}}
					error={errors.amountInCents}
					inputMode="decimal"
					readOnly={!options.permissions.canOverridePackageTerms}
					placeholder="0.00"
					required
				/>
				<EnrollmentTextField
					id="independent-enrollment-due-date"
					label="付款到期日"
					value={invoiceDueDate}
					onChange={(value) => {
						setInvoiceDueDate(value);
						clearError("invoiceDueDate");
					}}
					error={errors.invoiceDueDate}
					type="date"
					required
				/>
				<EnrollmentClassField
					id="independent-enrollment-class"
					courseId={courseId}
					campusId={selectedCampusId}
					classes={availableClasses}
					classGroupId={classGroupId}
					error={errors.classGroupId}
					onChange={(value) => {
						setClassGroupId(value);
						clearError("classGroupId");
					}}
				/>
			</div>
			{affectedLessons.length > 0 ? (
				<AffectedLessons lessons={affectedLessons} />
			) : null}
			<DialogFooter className="flex-col-reverse sm:flex-row">
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					取消
				</Button>
				<Button
					type="submit"
					disabled={pending || options.courses.length === 0}
				>
					{pending ? (
						<LoaderCircleIcon
							className="animate-spin"
							data-icon="inline-start"
						/>
					) : null}
					{pending ? "提交中" : "确认办理报名"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function ExistingStudentField({
	students,
	search,
	selectedStudentId,
	error,
	isLoading,
	isLoadingMore,
	hasMore,
	onSearchChange,
	onLoadMore,
	onSelect,
}: {
	students: StudentSummary[];
	search: string;
	selectedStudentId: string | null;
	error?: string;
	isLoading: boolean;
	isLoadingMore: boolean;
	hasMore: boolean;
	onSearchChange: (value: string) => void;
	onLoadMore: () => void;
	onSelect: (student: StudentSummary) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor="independent-enrollment-student-search">
				选择已有学员
			</FieldLabel>
			<div className="relative">
				<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					id="independent-enrollment-student-search"
					className="pl-8"
					value={search}
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder="搜索学员、主要联系人或手机号"
				/>
			</div>
			<div className="max-h-48 overflow-y-auto border">
				{isLoading ? (
					<div className="space-y-2 p-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : students.length === 0 ? (
					<p className="p-3 text-muted-foreground text-sm">
						暂无可选学员，可改为新建学员。
					</p>
				) : (
					<div className="divide-y">
						{students.map((student) => {
							const eligible = enrollableStatuses.has(student.status);
							return (
								<button
									key={student.id}
									type="button"
									disabled={!eligible}
									className={`flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${student.id === selectedStudentId ? "bg-primary/5 ring-1 ring-primary ring-inset" : ""}`}
									onClick={() => onSelect(student)}
								>
									<span>
										<span className="block font-medium">{student.name}</span>
										<span className="block text-muted-foreground text-xs">
											{student.campusName} · {student.primaryContactName} ·{" "}
											{student.primaryContactPhoneMasked}
										</span>
									</span>
									<span className="text-muted-foreground text-xs">
										{studentStatusLabel(student.status)}
									</span>
								</button>
							);
						})}
						{hasMore ? (
							<Button
								type="button"
								variant="ghost"
								className="w-full"
								disabled={isLoadingMore}
								onClick={onLoadMore}
							>
								{isLoadingMore ? "正在加载" : "加载更多"}
							</Button>
						) : null}
					</div>
				)}
			</div>
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

function NewStudentFields({
	campuses,
	studentName,
	campusId,
	contactName,
	contactPhone,
	contactRelationship,
	duplicateCandidates,
	isCheckingDuplicates,
	errors,
	onStudentNameChange,
	onCampusChange,
	onContactNameChange,
	onContactPhoneChange,
	onContactRelationshipChange,
}: {
	campuses: IndependentEnrollmentOptions["campuses"];
	studentName: string;
	campusId: string;
	contactName: string;
	contactPhone: string;
	contactRelationship: string;
	duplicateCandidates: Array<{
		id: string;
		name: string;
		campusName: string;
		phoneMasked: string;
	}>;
	isCheckingDuplicates: boolean;
	errors: EnrollmentErrors;
	onStudentNameChange: (value: string) => void;
	onCampusChange: (value: string) => void;
	onContactNameChange: (value: string) => void;
	onContactPhoneChange: (value: string) => void;
	onContactRelationshipChange: (value: string) => void;
}) {
	return (
		<div className="grid min-w-0 gap-4 border p-3 sm:grid-cols-2">
			<EnrollmentTextField
				id="independent-enrollment-student-name"
				label="学员姓名"
				value={studentName}
				onChange={onStudentNameChange}
				error={errors.studentName}
				maxLength={50}
				required
			/>
			<EnrollmentCampusField
				id="independent-enrollment-campus"
				label="所属校区"
				campuses={campuses}
				campusId={campusId}
				error={errors.campusId}
				emptyMessage="暂无可用校区，不能新建学员。"
				onChange={onCampusChange}
			/>
			<EnrollmentTextField
				id="independent-enrollment-contact-name"
				label="主要联系人姓名"
				value={contactName}
				onChange={onContactNameChange}
				error={errors.contactName}
				maxLength={50}
				required
			/>
			{isCheckingDuplicates ? (
				<p className="text-muted-foreground text-xs sm:col-span-2">
					正在检查疑似重复档案…
				</p>
			) : duplicateCandidates.length > 0 ? (
				<div className="border border-amber-500/50 bg-amber-500/5 p-3 text-sm sm:col-span-2">
					<p className="font-medium">发现疑似重复学员</p>
					<p className="mt-1 text-muted-foreground text-xs">
						同机构的相同标准化手机号不会阻止报名；请确认是否应选择已有档案。
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
			<EnrollmentTextField
				id="independent-enrollment-contact-phone"
				label="主要联系人手机号"
				value={contactPhone}
				onChange={onContactPhoneChange}
				error={errors.contactPhone}
				type="tel"
				maxLength={50}
				required
			/>
			<EnrollmentTextField
				id="independent-enrollment-contact-relationship"
				label="关系（可选）"
				value={contactRelationship}
				onChange={onContactRelationshipChange}
				error={errors.contactRelationship}
				maxLength={30}
			/>
		</div>
	);
}

function AffectedLessons({
	lessons,
}: {
	lessons: Array<{
		id: string;
		className: string;
		startsAt: string;
		roomName: string;
		occupancy: number;
		capacity: number;
	}>;
}) {
	return (
		<div className="border border-destructive/50 bg-destructive/5 p-3 text-sm">
			<p className="font-medium text-destructive">未来课次教室容量不足</p>
			<ul className="mt-2 space-y-1 text-muted-foreground">
				{lessons.map((lesson) => (
					<li key={lesson.id}>
						{formatDateTime(lesson.startsAt)} · {lesson.className} ·{" "}
						{lesson.roomName}（{lesson.occupancy}/{lesson.capacity}）
					</li>
				))}
			</ul>
		</div>
	);
}

function EnrollmentSkeleton() {
	return (
		<div
			className="flex flex-col gap-4"
			role="status"
			aria-label="正在加载报名选项"
		>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-48 w-full" />
			<div className="grid gap-4 sm:grid-cols-2">
				{["one", "two", "three", "four"].map((key) => (
					<Skeleton key={key} className="h-14 w-full" />
				))}
			</div>
		</div>
	);
}

function getErrorKey(path: PropertyKey[]): EnrollmentErrorKey | null {
	const field = path.join(".");
	if (field === "student.studentId" || field === "student") return "studentId";
	if (field === "student.name") return "studentName";
	if (field === "student.campusId") return "campusId";
	if (field === "student.primaryContact.name") return "contactName";
	if (field === "student.primaryContact.phone") return "contactPhone";
	if (field === "student.primaryContact.relationship")
		return "contactRelationship";
	if (field === "courseId") return "courseId";
	if (field === "classGroupId") return "classGroupId";
	if (field === "purchasedLessons") return "purchasedLessons";
	if (field === "amountInCents") return "amountInCents";
	if (field === "invoiceDueDate") return "invoiceDueDate";
	return null;
}

function getAffectedLessons(error: unknown): Array<{
	id: string;
	className: string;
	startsAt: string;
	roomName: string;
	occupancy: number;
	capacity: number;
}> {
	if (typeof error !== "object" || error === null || !("data" in error))
		return [];
	const data = error.data;
	if (
		typeof data !== "object" ||
		data === null ||
		!("affectedLessons" in data) ||
		!Array.isArray(data.affectedLessons)
	)
		return [];
	return data.affectedLessons.filter(
		(
			item,
		): item is {
			id: string;
			className: string;
			startsAt: string;
			roomName: string;
			occupancy: number;
			capacity: number;
		} =>
			typeof item === "object" &&
			item !== null &&
			"id" in item &&
			"className" in item &&
			"startsAt" in item &&
			"roomName" in item &&
			"occupancy" in item &&
			"capacity" in item &&
			typeof item.id === "string" &&
			typeof item.className === "string" &&
			typeof item.startsAt === "string" &&
			typeof item.roomName === "string" &&
			typeof item.occupancy === "number" &&
			typeof item.capacity === "number",
	);
}

function parsePositiveInteger(value: string): number | null {
	if (!/^[1-9]\d*$/.test(value.trim())) return null;
	const result = Number(value);
	return Number.isSafeInteger(result) && result <= 1000 ? result : null;
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(value));
}
function studentStatusLabel(status: StudentSummary["status"]) {
	return {
		active: "在读",
		trial: "试听",
		paused: "暂停",
		graduated: "已结业",
		atRisk: "需关注",
	}[status];
}
function invalidateEnrollmentQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.enrollments.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.invoices.list.key(),
		}),
		queryClient.invalidateQueries({ queryKey: orpc.training.snapshot.key() }),
		queryClient.invalidateQueries({
			queryKey: orpc.training.enrollments.independentOptions.key(),
		}),
	]);
}
