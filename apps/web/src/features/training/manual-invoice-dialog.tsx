import {
	type CreateManualInvoiceInput,
	createManualInvoiceInputSchema,
	type ManualInvoiceOptions,
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
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
import { Textarea } from "@easy-training/ui/components/textarea";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { type FormEvent, useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { client, orpc } from "@/utils/orpc";
import {
	getActivityTypeLabel,
	getShanghaiToday,
	parseYuanToCents,
} from "./finance-form-utils";

const activityTypes: Array<{
	value: CreateManualInvoiceInput["businessActivityType"];
	label: string;
}> = [
	{ value: "material_fee", label: "材料费" },
	{ value: "exam_fee", label: "考试费" },
	{ value: "price_difference", label: "补差价" },
	{ value: "other", label: "其他" },
];

type FormField =
	| "studentId"
	| "businessActivityType"
	| "summary"
	| "amountInCents"
	| "dueDate";
type ManualInvoiceStudent = ManualInvoiceOptions["students"][number];

export function ManualInvoiceDialog({
	organizationId,
	onClose,
	onCreated,
}: {
	organizationId: string;
	onClose: () => void;
	onCreated: (invoiceId: string) => void;
}) {
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search.trim());
	const optionsQuery = useInfiniteQuery({
		queryKey: ["manual-invoice-options", organizationId, deferredSearch],
		queryFn: ({ pageParam }) =>
			client.training.finance.invoices.manualOptions({
				query: deferredSearch || undefined,
				cursor: pageParam ?? undefined,
				pageSize: 20,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const students =
		optionsQuery.data?.pages.flatMap((page) => page.students) ?? [];
	const [selectedStudent, setSelectedStudent] =
		useState<ManualInvoiceStudent | null>(null);
	const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
	const [businessActivityType, setBusinessActivityType] =
		useState<CreateManualInvoiceInput["businessActivityType"]>("material_fee");
	const [summary, setSummary] = useState("");
	const [amountInYuan, setAmountInYuan] = useState("");
	const [dueDate, setDueDate] = useState(getShanghaiToday);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
	const mutation = useMutation(
		orpc.training.finance.invoices.createManual.mutationOptions({
			onSuccess: (result) => {
				toast.success(result.replayed ? "已返回原手工账单" : "手工账单已创建");
				onCreated(result.invoiceId);
			},
			onError: (error) => toast.error(`手工开单失败：${error.message}`),
		}),
	);

	function clearError(field: FormField) {
		if (mutation.isError) {
			setRequestId(crypto.randomUUID());
			mutation.reset();
		}
		setErrors((current) => {
			if (!current[field]) return current;
			const next = { ...current };
			delete next[field];
			return next;
		});
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;
		const amountInCents = parseYuanToCents(amountInYuan);
		const result = createManualInvoiceInputSchema.safeParse({
			studentId: selectedStudent?.id ?? "",
			enrollmentId,
			businessActivityType,
			summary,
			amountInCents,
			dueDate,
			requestId,
		});
		if (!result.success) {
			const next: Partial<Record<FormField, string>> = {};
			for (const issue of result.error.issues) {
				const field = issue.path[0];
				if (typeof field === "string" && field in formFieldKeys) {
					next[field as FormField] ??= issue.message;
				}
			}
			if (amountInCents === null) next.amountInCents = "请输入有效金额";
			setErrors(next);
			toast.error("请检查开单信息");
			return;
		}
		setErrors({});
		mutation.mutate(result.data);
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>手工开单</DialogTitle>
					<DialogDescription>
						为学员创建材料费、考试费、补差价或其他应收账单。
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4 sm:grid-cols-2"
					onSubmit={submit}
					noValidate
				>
					<Field className="sm:col-span-2">
						<FieldLabel htmlFor="manual-invoice-search">搜索学员</FieldLabel>
						<div className="relative">
							<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="manual-invoice-search"
								className="pl-8"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="输入学员姓名"
							/>
						</div>
					</Field>
					{optionsQuery.isError && students.length === 0 ? (
						<Empty className="min-h-32 border sm:col-span-2">
							<EmptyHeader>
								<EmptyTitle>学员数据加载失败</EmptyTitle>
								<EmptyDescription>
									{optionsQuery.error.message}
								</EmptyDescription>
							</EmptyHeader>
							<Button type="button" onClick={() => void optionsQuery.refetch()}>
								重试
							</Button>
						</Empty>
					) : (
						<Field invalid={Boolean(errors.studentId)}>
							<FieldLabel htmlFor="manual-invoice-student">学员</FieldLabel>
							<Select
								value={selectedStudent?.id ?? null}
								onValueChange={(value) => {
									setSelectedStudent(
										students.find((item) => item.id === value) ?? null,
									);
									setEnrollmentId(null);
									clearError("studentId");
								}}
								disabled={optionsQuery.isPending}
							>
								<SelectTrigger
									id="manual-invoice-student"
									className="w-full"
									aria-invalid={Boolean(errors.studentId)}
								>
									<SelectValue>
										{() => selectedStudent?.name ?? "请选择学员"}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{students.length ? (
											students.map((item) => (
												<SelectItem key={item.id} value={item.id}>
													{item.name} · {item.campusName}
												</SelectItem>
											))
										) : (
											<p className="px-2 py-6 text-center text-muted-foreground text-sm">
												暂无数据
											</p>
										)}
									</SelectGroup>
								</SelectContent>
							</Select>
							{optionsQuery.isFetchNextPageError ? (
								<div className="flex items-center justify-between gap-2 text-destructive text-xs">
									<span>更多学员加载失败</span>
									<Button
										type="button"
										variant="outline"
										size="xs"
										onClick={() => void optionsQuery.fetchNextPage()}
									>
										重试
									</Button>
								</div>
							) : optionsQuery.hasNextPage ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-full"
									disabled={optionsQuery.isFetchingNextPage}
									onClick={() => void optionsQuery.fetchNextPage()}
								>
									{optionsQuery.isFetchingNextPage ? (
										<LoaderCircleIcon
											className="animate-spin"
											data-icon="inline-start"
										/>
									) : null}
									{optionsQuery.isFetchingNextPage
										? "正在加载"
										: "加载更多学员"}
								</Button>
							) : null}
							<FieldError match={Boolean(errors.studentId)}>
								{errors.studentId}
							</FieldError>
						</Field>
					)}
					<Field>
						<FieldLabel htmlFor="manual-invoice-enrollment">
							关联报名（可选）
						</FieldLabel>
						<Select
							value={enrollmentId ?? "none"}
							onValueChange={(value) => {
								setEnrollmentId(value === "none" ? null : value);
								if (mutation.isError) {
									setRequestId(crypto.randomUUID());
									mutation.reset();
								}
							}}
							disabled={!selectedStudent}
						>
							<SelectTrigger id="manual-invoice-enrollment" className="w-full">
								<SelectValue>
									{() =>
										enrollmentId
											? selectedStudent?.enrollments.find(
													(item) => item.id === enrollmentId,
												)?.courseName
											: "不关联报名"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">不关联报名</SelectItem>
								{selectedStudent?.enrollments.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.courseName}
										{item.status === "frozen" ? " · 已冻结" : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field invalid={Boolean(errors.businessActivityType)}>
						<FieldLabel htmlFor="manual-invoice-type">业务活动类型</FieldLabel>
						<Select
							value={businessActivityType}
							onValueChange={(value) => {
								setBusinessActivityType(
									value as CreateManualInvoiceInput["businessActivityType"],
								);
								clearError("businessActivityType");
							}}
						>
							<SelectTrigger
								id="manual-invoice-type"
								className="w-full"
								aria-invalid={Boolean(errors.businessActivityType)}
							>
								<SelectValue>
									{() => getActivityTypeLabel(businessActivityType)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{activityTypes.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field invalid={Boolean(errors.amountInCents)}>
						<FieldLabel htmlFor="manual-invoice-amount">金额（元）</FieldLabel>
						<Input
							id="manual-invoice-amount"
							inputMode="decimal"
							value={amountInYuan}
							onChange={(event) => {
								setAmountInYuan(event.target.value);
								clearError("amountInCents");
							}}
							placeholder="0.00"
							aria-invalid={Boolean(errors.amountInCents)}
							required
						/>
						<FieldError match={Boolean(errors.amountInCents)}>
							{errors.amountInCents}
						</FieldError>
					</Field>
					<Field invalid={Boolean(errors.dueDate)}>
						<FieldLabel htmlFor="manual-invoice-due">付款到期日</FieldLabel>
						<Input
							id="manual-invoice-due"
							type="date"
							value={dueDate}
							onChange={(event) => {
								setDueDate(event.target.value);
								clearError("dueDate");
							}}
							aria-invalid={Boolean(errors.dueDate)}
							required
						/>
						<FieldError match={Boolean(errors.dueDate)}>
							{errors.dueDate}
						</FieldError>
					</Field>
					<Field className="sm:col-span-2" invalid={Boolean(errors.summary)}>
						<FieldLabel htmlFor="manual-invoice-summary">摘要</FieldLabel>
						<Textarea
							id="manual-invoice-summary"
							value={summary}
							onChange={(event) => {
								setSummary(event.target.value);
								clearError("summary");
							}}
							maxLength={200}
							placeholder={
								businessActivityType === "other"
									? "请说明具体收费事项"
									: "例如：2026 秋季教材费"
							}
							aria-invalid={Boolean(errors.summary)}
							required
						/>
						<FieldError match={Boolean(errors.summary)}>
							{errors.summary}
						</FieldError>
					</Field>
					<DialogFooter className="flex-col sm:col-span-2 sm:flex-row">
						<Button
							type="button"
							variant="outline"
							className="w-full sm:w-auto"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button
							type="submit"
							className="w-full sm:w-auto"
							disabled={mutation.isPending || optionsQuery.isError}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{mutation.isPending ? "提交中" : "创建账单"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const formFieldKeys: Record<FormField, true> = {
	studentId: true,
	businessActivityType: true,
	summary: true,
	amountInCents: true,
	dueDate: true,
};
