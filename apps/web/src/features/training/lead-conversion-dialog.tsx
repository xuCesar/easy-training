import {
	type ConvertLeadInput,
	convertLeadInputSchema,
	type LeadConversionOptions,
	type LeadRecord,
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
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, UsersRoundIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

import { useOrganization } from "./organization-context";

type StudentSelection =
	| { mode: "existing"; studentId: string }
	| { mode: "new" }
	| null;
type ConversionErrorKey =
	| "studentChoice"
	| "studentName"
	| "guardianName"
	| "campusId"
	| "courseId"
	| "purchasedLessons"
	| "amountInCents"
	| "invoiceDueDate"
	| "classGroupId";
type ConversionErrors = Partial<Record<ConversionErrorKey, string>>;

export function LeadConversionDialog({
	lead,
	onClose,
}: {
	lead: LeadRecord;
	onClose: () => void;
}) {
	const { organization } = useOrganization();
	const options = orpc.training.leads.conversionOptions.queryOptions({
		input: { leadId: lead.id },
	});
	const optionsQuery = useQuery({
		...options,
		queryKey: [...options.queryKey, { organizationId: organization.id }],
	});
	const conversionMutation = useMutation(
		orpc.training.leads.convert.mutationOptions({
			onSuccess: () => {
				toast.success("已转为报名学员");
				void invalidateConversionQueries();
				onClose();
			},
			onError: (error) => toast.error(`转报名失败：${error.message}`),
		}),
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !conversionMutation.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>线索转报名</DialogTitle>
					<DialogDescription>
						为 {lead.name} 确认学员、课程和报名信息。
					</DialogDescription>
				</DialogHeader>
				{optionsQuery.isPending ? (
					<ConversionSkeleton />
				) : optionsQuery.isError ? (
					<Empty className="min-h-64 border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<UsersRoundIcon />
							</EmptyMedia>
							<EmptyTitle>报名选项加载失败</EmptyTitle>
							<EmptyDescription>{optionsQuery.error.message}</EmptyDescription>
						</EmptyHeader>
						<Button onClick={() => optionsQuery.refetch()}>重试</Button>
					</Empty>
				) : (
					<LeadConversionForm
						options={optionsQuery.data}
						pending={conversionMutation.isPending}
						onCancel={onClose}
						onSubmit={(input) => conversionMutation.mutate(input)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function LeadConversionForm({
	options,
	pending,
	onCancel,
	onSubmit,
}: {
	options: LeadConversionOptions;
	pending: boolean;
	onCancel: () => void;
	onSubmit: (input: ConvertLeadInput) => void;
}) {
	const defaultCourse = options.courses.find(
		(course) => course.id === options.lead.interestedCourseId,
	);
	const defaultCampusId = options.campuses.some(
		(campus) => campus.id === options.lead.campusId,
	)
		? (options.lead.campusId ?? "")
		: "";
	const [studentSelection, setStudentSelection] = useState<StudentSelection>(
		options.matchingStudents.length === 0 ? { mode: "new" } : null,
	);
	const [studentName, setStudentName] = useState(options.lead.name);
	const [guardianName, setGuardianName] = useState("");
	const [campusId, setCampusId] = useState(defaultCampusId);
	const [courseId, setCourseId] = useState(defaultCourse?.id ?? "");
	const [classGroupId, setClassGroupId] = useState<string | null>(null);
	const [purchasedLessons, setPurchasedLessons] = useState(
		defaultCourse ? String(defaultCourse.lessonsPerPackage) : "",
	);
	const [amountInYuan, setAmountInYuan] = useState(
		defaultCourse ? formatCentsAsYuan(defaultCourse.listPriceInCents) : "",
	);
	const [invoiceDueDate, setInvoiceDueDate] = useState(getShanghaiToday);
	const [conversionOwnerUserId, setConversionOwnerUserId] = useState<
		string | null
	>(options.lead.ownerUserId);
	const [adjustStudentOwner, setAdjustStudentOwner] = useState(false);
	const [errors, setErrors] = useState<ConversionErrors>({});
	const selectedStudent =
		studentSelection?.mode === "existing"
			? options.matchingStudents.find(
					(student) => student.id === studentSelection.studentId,
				)
			: undefined;
	const selectedCampusId =
		studentSelection?.mode === "existing"
			? selectedStudent?.campusId
			: campusId;
	const ownerCandidatesQuery = useQuery({
		...orpc.training.students.ownerCandidates.queryOptions({
			input: {
				campusId: selectedCampusId ?? "00000000-0000-0000-0000-000000000000",
			},
		}),
		enabled: Boolean(selectedCampusId),
	});
	useEffect(() => {
		if (
			conversionOwnerUserId &&
			ownerCandidatesQuery.data &&
			!ownerCandidatesQuery.data.items.some(
				(candidate) => candidate.userId === conversionOwnerUserId,
			)
		) {
			setConversionOwnerUserId(null);
		}
	}, [conversionOwnerUserId, ownerCandidatesQuery.data]);
	const availableClasses = options.classes.filter(
		(classGroup) =>
			classGroup.courseId === courseId &&
			classGroup.campusId === selectedCampusId,
	);

	function clearError(...fields: ConversionErrorKey[]) {
		setErrors((current) => {
			const next = { ...current };
			for (const field of fields) delete next[field];
			return next;
		});
	}

	function chooseStudent(selection: Exclude<StudentSelection, null>) {
		setStudentSelection(selection);
		setClassGroupId(null);
		clearError("studentChoice", "classGroupId");
	}

	function chooseCourse(nextCourseId: string) {
		const course = options.courses.find((item) => item.id === nextCourseId);
		setCourseId(nextCourseId);
		setClassGroupId(null);
		if (course) {
			setAmountInYuan(formatCentsAsYuan(course.listPriceInCents));
			setPurchasedLessons(String(course.lessonsPerPackage));
		}
		clearError("courseId", "classGroupId", "amountInCents", "purchasedLessons");
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const nextErrors: ConversionErrors = {};
		if (!studentSelection) {
			nextErrors.studentChoice = "请选择已有学员或新建学员";
		}
		const amountInCents = parseYuanToCents(amountInYuan);
		if (amountInCents === null) {
			nextErrors.amountInCents = "请输入最多两位小数的有效金额";
		}
		const parsedLessons = parsePositiveInteger(purchasedLessons);
		if (parsedLessons === null) {
			nextErrors.purchasedLessons = "请输入 1 至 1000 的整数课时";
		}
		if (!studentSelection || amountInCents === null || parsedLessons === null) {
			setErrors(nextErrors);
			toast.error("请检查报名信息");
			return;
		}

		const input = {
			leadId: options.lead.id,
			student:
				studentSelection.mode === "existing"
					? {
							mode: "existing" as const,
							studentId: studentSelection.studentId,
							expectedVersion:
								options.matchingStudents.find(
									(student) => student.id === studentSelection.studentId,
								)?.version ?? 0,
						}
					: {
							mode: "new" as const,
							name: studentName,
							guardianName,
							campusId,
						},
			conversionOwnerUserId,
			adjustStudentOwner:
				studentSelection.mode === "existing" && adjustStudentOwner,
			courseId,
			classGroupId,
			purchasedLessons: parsedLessons,
			amountInCents,
			invoiceDueDate,
		};
		const result = convertLeadInputSchema.safeParse(input);
		if (!result.success) {
			for (const issue of result.error.issues) {
				const field = getConversionErrorKey(issue.path);
				if (field) nextErrors[field] ??= issue.message;
			}
			setErrors(nextErrors);
			toast.error("请检查报名信息");
			return;
		}

		setErrors({});
		onSubmit(result.data);
	}

	return (
		<form className="flex min-w-0 flex-col gap-5" onSubmit={submit} noValidate>
			<fieldset className="grid min-w-0 gap-2">
				<legend className="font-medium text-sm">选择学员</legend>
				{options.matchingStudents.length > 0 ? (
					<>
						<p className="text-muted-foreground text-xs">
							检测到同电话学员，请明确选择本次报名对象。
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{options.matchingStudents.map((student) => {
								const selected =
									studentSelection?.mode === "existing" &&
									studentSelection.studentId === student.id;
								return (
									<button
										key={student.id}
										type="button"
										aria-pressed={selected}
										className={`min-w-0 border p-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
										onClick={() =>
											chooseStudent({
												mode: "existing",
												studentId: student.id,
											})
										}
									>
										<span className="block truncate font-medium">
											{student.name}
										</span>
										<span className="mt-1 block truncate text-muted-foreground text-xs">
											监护人 {student.guardianName} · {student.campusName}
										</span>
									</button>
								);
							})}
						</div>
					</>
				) : (
					<p className="text-muted-foreground text-xs">
						未找到同电话学员，将新建学员档案。
					</p>
				)}
				<button
					type="button"
					aria-pressed={studentSelection?.mode === "new"}
					className={`border p-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${studentSelection?.mode === "new" ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
					onClick={() => chooseStudent({ mode: "new" })}
				>
					<span className="block font-medium">新建学员</span>
					<span className="mt-1 block text-muted-foreground text-xs">
						使用线索电话创建新的学员档案
					</span>
				</button>
				{errors.studentChoice ? (
					<p className="text-destructive text-xs">{errors.studentChoice}</p>
				) : null}
			</fieldset>

			{studentSelection?.mode === "new" ? (
				<NewStudentFields
					options={options}
					studentName={studentName}
					guardianName={guardianName}
					campusId={campusId}
					errors={errors}
					onStudentNameChange={(value) => {
						setStudentName(value);
						clearError("studentName");
					}}
					onGuardianNameChange={(value) => {
						setGuardianName(value);
						clearError("guardianName");
					}}
					onCampusChange={(value) => {
						setCampusId(value);
						setClassGroupId(null);
						clearError("campusId", "classGroupId");
					}}
				/>
			) : null}

			<Field>
				<FieldLabel htmlFor="conversion-owner">成交归属人</FieldLabel>
				<Select
					value={conversionOwnerUserId ?? "unassigned"}
					onValueChange={(value) =>
						setConversionOwnerUserId(
							value === "unassigned" ? null : (value ?? null),
						)
					}
					disabled={!selectedCampusId || ownerCandidatesQuery.isPending}
				>
					<SelectTrigger id="conversion-owner" className="w-full">
						<SelectValue>
							{() =>
								conversionOwnerUserId
									? (ownerCandidatesQuery.data?.items.find(
											(candidate) => candidate.userId === conversionOwnerUserId,
										)?.name ??
										options.lead.ownerName ??
										"请选择")
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
					该归属会冻结在本次报名中，后续学员负责人变化不会改写成交归属。
				</p>
				{studentSelection?.mode === "existing" ? (
					options.permissions.canAdjustStudentOwner ? (
						<label
							className="flex items-start gap-2 text-sm"
							htmlFor="lead-conversion-adjust-student-owner"
						>
							<Checkbox
								id="lead-conversion-adjust-student-owner"
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
						新学员将使用相同人员作为运营负责人。
					</p>
				)}
			</Field>

			<div className="grid min-w-0 gap-4 sm:grid-cols-2">
				<CourseField
					courses={options.courses}
					courseId={courseId}
					error={errors.courseId}
					onChange={chooseCourse}
				/>
				<ConversionTextField
					id="conversion-lessons"
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
				<ConversionTextField
					id="conversion-amount"
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
				<ConversionTextField
					id="conversion-invoice-due-date"
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
				<ClassField
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

			<DialogFooter className="flex-col-reverse sm:flex-row">
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					取消
				</Button>
				<Button type="submit" disabled={pending}>
					{pending ? (
						<LoaderCircleIcon
							className="animate-spin"
							data-icon="inline-start"
						/>
					) : null}
					{pending ? "提交中" : "确认转报名"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function NewStudentFields({
	options,
	studentName,
	guardianName,
	campusId,
	errors,
	onStudentNameChange,
	onGuardianNameChange,
	onCampusChange,
}: {
	options: LeadConversionOptions;
	studentName: string;
	guardianName: string;
	campusId: string;
	errors: ConversionErrors;
	onStudentNameChange: (value: string) => void;
	onGuardianNameChange: (value: string) => void;
	onCampusChange: (value: string) => void;
}) {
	return (
		<div className="grid min-w-0 gap-4 border p-3 sm:grid-cols-2">
			<ConversionTextField
				id="conversion-student-name"
				label="学员姓名"
				value={studentName}
				onChange={onStudentNameChange}
				error={errors.studentName}
				maxLength={50}
				required
			/>
			<ConversionTextField
				id="conversion-guardian-name"
				label="监护人姓名"
				value={guardianName}
				onChange={onGuardianNameChange}
				error={errors.guardianName}
				maxLength={50}
				required
			/>
			<ConversionTextField
				id="conversion-phone"
				label="电话"
				value={options.lead.phone}
				onChange={() => undefined}
				type="tel"
				readOnly
			/>
			<Field invalid={Boolean(errors.campusId)}>
				<FieldLabel htmlFor="conversion-campus">校区</FieldLabel>
				{options.campuses.length === 0 ? (
					<p className="border border-destructive/50 p-2 text-destructive text-xs">
						暂无可选校区，暂时无法新建学员。
					</p>
				) : (
					<Select
						value={campusId || null}
						onValueChange={(value) => onCampusChange(value ?? "")}
					>
						<SelectTrigger
							id="conversion-campus"
							className="w-full"
							aria-invalid={Boolean(errors.campusId)}
						>
							<SelectValue>
								{() =>
									options.campuses.find((campus) => campus.id === campusId)
										?.name ?? "请选择校区"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{options.campuses.map((campus) => (
									<SelectItem key={campus.id} value={campus.id}>
										{campus.name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				)}
				<FieldError match={Boolean(errors.campusId)}>
					{errors.campusId}
				</FieldError>
			</Field>
		</div>
	);
}

function CourseField({
	courses,
	courseId,
	error,
	onChange,
}: {
	courses: LeadConversionOptions["courses"];
	courseId: string;
	error?: string;
	onChange: (value: string) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor="conversion-course">课程</FieldLabel>
			{courses.length === 0 ? (
				<p className="border border-destructive/50 p-2 text-destructive text-xs">
					暂无可报名课程。
				</p>
			) : (
				<Select
					value={courseId || null}
					onValueChange={(value) => {
						if (value) onChange(value);
					}}
				>
					<SelectTrigger
						id="conversion-course"
						className="w-full"
						aria-invalid={Boolean(error)}
					>
						<SelectValue>
							{() =>
								courses.find((course) => course.id === courseId)?.name ??
								"请选择课程"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{courses.map((course) => (
								<SelectItem key={course.id} value={course.id}>
									{course.name} · {formatCentsAsYuan(course.listPriceInCents)}{" "}
									元/{course.lessonsPerPackage} 课时
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

function ClassField({
	courseId,
	campusId,
	classes,
	classGroupId,
	error,
	onChange,
}: {
	courseId: string;
	campusId?: string;
	classes: LeadConversionOptions["classes"];
	classGroupId: string | null;
	error?: string;
	onChange: (value: string | null) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor="conversion-class">班级（可选）</FieldLabel>
			{!courseId || !campusId ? (
				<p className="border p-2 text-muted-foreground text-xs">
					请先选择学员、校区和课程。
				</p>
			) : classes.length === 0 ? (
				<p className="border p-2 text-muted-foreground text-xs">
					该课程在所选校区暂无可选班级，可暂不分班。
				</p>
			) : (
				<Select
					value={classGroupId ?? "unassigned"}
					onValueChange={(value) =>
						onChange(value === "unassigned" ? null : (value ?? null))
					}
				>
					<SelectTrigger id="conversion-class" className="w-full">
						<SelectValue>
							{() => {
								const selected = classes.find(
									(item) => item.id === classGroupId,
								);
								return selected
									? `${selected.name} · 余 ${selected.seatsRemaining}`
									: "暂不分班";
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectItem value="unassigned">暂不分班</SelectItem>
							{classes.map((classGroup) => (
								<SelectItem key={classGroup.id} value={classGroup.id}>
									{classGroup.name} · 余 {classGroup.seatsRemaining} ·{" "}
									{classGroup.scheduleText || "排课待定"}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

function ConversionTextField({
	id,
	label,
	value,
	onChange,
	error,
	type = "text",
	readOnly,
	required,
	maxLength,
	min,
	max,
	inputMode,
	placeholder,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	type?: "text" | "tel" | "number" | "date";
	readOnly?: boolean;
	required?: boolean;
	maxLength?: number;
	min?: number;
	max?: number;
	inputMode?: "decimal";
	placeholder?: string;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type={type}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? `${id}-error` : undefined}
				readOnly={readOnly}
				required={required}
				maxLength={maxLength}
				min={min}
				max={max}
				inputMode={inputMode}
				placeholder={placeholder}
			/>
			<FieldError id={`${id}-error`} match={Boolean(error)}>
				{error}
			</FieldError>
		</Field>
	);
}

function ConversionSkeleton() {
	return (
		<div
			className="flex flex-col gap-4"
			role="status"
			aria-label="正在加载报名选项"
		>
			<Skeleton className="h-20 w-full" />
			<div className="grid gap-4 sm:grid-cols-2">
				{["one", "two", "three", "four"].map((key) => (
					<Skeleton key={key} className="h-14 w-full" />
				))}
			</div>
		</div>
	);
}

function formatCentsAsYuan(value: number) {
	const yuan = Math.floor(value / 100);
	const cents = String(value % 100).padStart(2, "0");
	return `${yuan}.${cents}`;
}

function parseYuanToCents(value: string) {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!match) return null;
	const yuan = Number(match[1]);
	const cents = Number((match[2] ?? "").padEnd(2, "0"));
	const result = yuan * 100 + cents;
	return Number.isSafeInteger(result) ? result : null;
}

function parsePositiveInteger(value: string) {
	if (!/^[1-9]\d*$/.test(value.trim())) return null;
	const result = Number(value);
	return Number.isSafeInteger(result) && result <= 1000 ? result : null;
}

function getConversionErrorKey(path: PropertyKey[]): ConversionErrorKey | null {
	const field = path.join(".");
	if (field === "student.name") return "studentName";
	if (field === "student.guardianName") return "guardianName";
	if (field === "student.campusId") return "campusId";
	if (field === "student" || field === "student.studentId") {
		return "studentChoice";
	}
	if (field === "courseId") return "courseId";
	if (field === "purchasedLessons") return "purchasedLessons";
	if (field === "amountInCents") return "amountInCents";
	if (field === "invoiceDueDate") return "invoiceDueDate";
	if (field === "classGroupId") return "classGroupId";
	return null;
}

function getShanghaiToday(): string {
	const shanghaiOffsetInMilliseconds = 8 * 60 * 60 * 1000;
	return new Date(Date.now() + shanghaiOffsetInMilliseconds)
		.toISOString()
		.slice(0, 10);
}

function invalidateConversionQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.leads.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.snapshot.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.leads.conversionOptions.key(),
		}),
	]);
}
