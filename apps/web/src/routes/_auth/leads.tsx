import {
	type CreateLeadInput,
	createLeadInputSchema,
	type LeadRecord,
	type LeadStage,
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
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	UsersRoundIcon,
} from "lucide-react";
import { type FormEvent, useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { LeadConversionDialog } from "@/features/training/lead-conversion-dialog";
import { useOrganization } from "@/features/training/organization-context";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/leads")({ component: LeadsRoute });

type LeadFilterStage = "all" | Exclude<LeadStage, "enrolled">;
type LeadFormValues = Pick<
	CreateLeadInput,
	"name" | "phone" | "source" | "stage"
> & { nextFollowAt: string | null; note: string | null };
type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>;

const visibleLeadSchema = createLeadInputSchema.pick({
	name: true,
	phone: true,
	source: true,
	stage: true,
	nextFollowAt: true,
	note: true,
});

const stages: Array<{ value: LeadFilterStage; label: string }> = [
	{ value: "all", label: "全部阶段" },
	{ value: "new", label: "新线索" },
	{ value: "contacted", label: "已联系" },
	{ value: "trialBooked", label: "已约试听" },
	{ value: "lost", label: "无效" },
];

const formStages: Array<{
	value: LeadFormValues["stage"];
	label: string;
}> = [
	{ value: "new", label: "新线索" },
	{ value: "contacted", label: "已联系" },
	{ value: "trialBooked", label: "已约试听" },
	{ value: "lost", label: "无效" },
];

function LeadsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { organization } = useOrganization();
	const [search, setSearch] = useState("");
	const [stage, setStage] = useState<LeadFilterStage>("all");
	const [editor, setEditor] = useState<LeadRecord | null | "new">(null);
	const [conversionLead, setConversionLead] = useState<LeadRecord | null>(null);
	const deferredSearch = useDeferredValue(search.trim());
	const listOptions = orpc.training.leads.list.queryOptions({
		input: { query: deferredSearch || undefined, stage },
	});
	const listQuery = useQuery({
		...listOptions,
		queryKey: [
			...listOptions.queryKey,
			{ organizationId: organization.id, sessionUserId },
		],
	});

	return (
		<div className="flex flex-col gap-5">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-sm">招生线索</p>
					<h1 className="font-semibold text-2xl">线索管理</h1>
					{listQuery.data ? (
						<p className="text-muted-foreground text-xs" aria-live="polite">
							共 {listQuery.data.total} 条
						</p>
					) : null}
				</div>
				<Button onClick={() => setEditor("new")}>
					<PlusIcon data-icon="inline-start" />
					新增线索
				</Button>
			</section>
			<section className="flex flex-col gap-3 sm:flex-row">
				<div className="relative flex-1">
					<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="搜索线索"
						className="pl-8"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="搜索姓名、电话或来源"
					/>
				</div>
				<Select
					value={stage}
					onValueChange={(value) => setStage(value ?? "all")}
				>
					<SelectTrigger className="w-full sm:w-36" aria-label="按阶段筛选">
						<SelectValue>{() => getStageLabel(stage)}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{stages.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</section>
			<LeadResults
				isFiltered={Boolean(search || stage !== "all")}
				query={listQuery}
				onEdit={setEditor}
				onConvert={setConversionLead}
			/>
			<LeadEditor
				key={editor === "new" ? "new" : (editor?.id ?? "closed")}
				lead={editor}
				onOpenChange={(open) => {
					if (!open) setEditor(null);
				}}
			/>
			{conversionLead ? (
				<LeadConversionDialog
					key={conversionLead.id}
					lead={conversionLead}
					onClose={() => setConversionLead(null)}
				/>
			) : null}
		</div>
	);
}

function LeadResults({
	isFiltered,
	query,
	onEdit,
	onConvert,
}: {
	isFiltered: boolean;
	query: ReturnType<typeof useQuery<{ items: LeadRecord[]; total: number }>>;
	onEdit: (lead: LeadRecord) => void;
	onConvert: (lead: LeadRecord) => void;
}) {
	if (query.isPending) return <LeadsSkeleton />;
	if (query.isError)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>线索加载失败</EmptyTitle>
					<EmptyDescription>{query.error.message}</EmptyDescription>
				</EmptyHeader>
				<Button onClick={() => query.refetch()}>重试</Button>
			</Empty>
		);
	if (query.data.items.length === 0)
		return (
			<Empty className="min-h-80 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UsersRoundIcon />
					</EmptyMedia>
					<EmptyTitle>
						{isFiltered ? "没有匹配的线索" : "还没有招生线索"}
					</EmptyTitle>
					<EmptyDescription>
						{isFiltered
							? "试试调整搜索词或筛选条件。"
							: "新增第一条线索，开始跟进招生咨询。"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<section className="border">
			<div className="hidden md:block">
				<Table>
					<TableCaption className="sr-only">招生线索列表</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>线索</TableHead>
							<TableHead>来源</TableHead>
							<TableHead>阶段</TableHead>
							<TableHead>下次跟进</TableHead>
							<TableHead className="text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{query.data.items.map((lead) => (
							<LeadTableRow
								key={lead.id}
								lead={lead}
								onEdit={onEdit}
								onConvert={onConvert}
							/>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y md:hidden">
				{query.data.items.map((lead) => (
					<LeadCompactRow
						key={lead.id}
						lead={lead}
						onEdit={onEdit}
						onConvert={onConvert}
					/>
				))}
			</div>
		</section>
	);
}

function LeadTableRow({ lead, onEdit, onConvert }: LeadRowProps) {
	return (
		<TableRow>
			<TableCell>
				<p className="font-medium">{lead.name}</p>
				<p className="mt-0.5 text-muted-foreground">{lead.phone}</p>
			</TableCell>
			<TableCell>{lead.source}</TableCell>
			<TableCell>
				<StageControl lead={lead} />
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatFollowAt(lead.nextFollowAt)}
			</TableCell>
			<TableCell className="text-right">
				<div className="flex justify-end gap-1">
					<Button variant="ghost" size="sm" onClick={() => onEdit(lead)}>
						<PencilIcon data-icon="inline-start" />
						编辑
					</Button>
					<Button variant="ghost" size="sm" onClick={() => onConvert(lead)}>
						<ArrowRightIcon data-icon="inline-start" />
						转报名
					</Button>
				</div>
			</TableCell>
		</TableRow>
	);
}
function LeadCompactRow({ lead, onEdit, onConvert }: LeadRowProps) {
	return (
		<article className="flex flex-col gap-3 p-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium text-sm">{lead.name}</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{lead.phone} · {lead.source}
					</p>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`编辑 ${lead.name}`}
						onClick={() => onEdit(lead)}
					>
						<PencilIcon data-icon="inline" />
					</Button>
					<Button variant="ghost" size="sm" onClick={() => onConvert(lead)}>
						<ArrowRightIcon data-icon="inline-start" />
						转报名
					</Button>
				</div>
			</div>
			<div className="flex items-center justify-between gap-3">
				<StageControl lead={lead} />
				<span className="text-muted-foreground text-xs">
					{formatFollowAt(lead.nextFollowAt)}
				</span>
			</div>
		</article>
	);
}
type LeadRowProps = {
	lead: LeadRecord;
	onEdit: (lead: LeadRecord) => void;
	onConvert: (lead: LeadRecord) => void;
};
function StageControl({ lead }: Pick<LeadRowProps, "lead">) {
	const updateMutation = useMutation(
		orpc.training.leads.update.mutationOptions({
			onSuccess: () => {
				toast.success("阶段已更新");
				void invalidateLeadQueries();
			},
			onError: (error) => toast.error(`更新失败：${error.message}`),
		}),
	);
	return (
		<Select
			value={lead.stage}
			disabled={updateMutation.isPending}
			onValueChange={(value) => {
				if (value && value !== lead.stage) {
					updateMutation.mutate({ id: lead.id, data: { stage: value } });
				}
			}}
		>
			<SelectTrigger
				size="sm"
				className="w-28"
				aria-label={`更新 ${lead.name} 的阶段`}
			>
				<SelectValue>{() => getStageLabel(lead.stage)}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{formStages.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function LeadEditor({
	lead,
	onOpenChange,
}: {
	lead: LeadRecord | null | "new";
	onOpenChange: (open: boolean) => void;
}) {
	const isEditing = lead !== null && lead !== "new";
	const initialValues: LeadFormValues = isEditing
		? {
				name: lead.name,
				phone: lead.phone,
				source: lead.source,
				stage: lead.stage,
				nextFollowAt: lead.nextFollowAt,
				note: lead.note,
			}
		: {
				name: "",
				phone: "",
				source: "",
				stage: "new",
				nextFollowAt: null,
				note: null,
			};
	const [values, setValues] = useState(initialValues);
	const [errors, setErrors] = useState<LeadFormErrors>({});
	const createMutation = useMutation(
		orpc.training.leads.create.mutationOptions({
			onSuccess: () => {
				toast.success("线索已新增");
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`新增失败：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.leads.update.mutationOptions({
			onSuccess: () => {
				toast.success("线索已更新");
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`保存失败：${error.message}`),
		}),
	);
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const result = visibleLeadSchema.safeParse({
			...values,
			nextFollowAt: toApiDateTime(values.nextFollowAt),
			note: values.note || null,
		});

		if (!result.success) {
			const nextErrors: LeadFormErrors = {};
			for (const issue of result.error.issues) {
				const field = issue.path[0];
				if (typeof field === "string" && field in values) {
					nextErrors[field as keyof LeadFormValues] ??= issue.message;
				}
			}
			setErrors(nextErrors);
			toast.error("请检查表单中的必填项和格式");
			return;
		}

		setErrors({});
		if (isEditing) updateMutation.mutate({ id: lead.id, data: result.data });
		else createMutation.mutate(result.data);
	}

	function updateValue<Key extends keyof LeadFormValues>(
		field: Key,
		value: LeadFormValues[Key],
	) {
		setValues((current) => ({ ...current, [field]: value }));
		setErrors((current) => ({ ...current, [field]: undefined }));
	}
	return (
		<Dialog open={lead !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{isEditing ? "编辑线索" : "新增线索"}</DialogTitle>
					<DialogDescription>填写可用于后续跟进的基本信息。</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField
							name="name"
							label="姓名"
							value={values.name}
							onChange={(name) => updateValue("name", name)}
							error={errors.name}
							maxLength={50}
							required
						/>
						<TextField
							name="phone"
							label="电话"
							value={values.phone}
							onChange={(phone) => updateValue("phone", phone)}
							error={errors.phone}
							minLength={5}
							maxLength={30}
							type="tel"
							required
						/>
					</div>
					<TextField
						name="source"
						label="来源"
						value={values.source}
						onChange={(source) => updateValue("source", source)}
						error={errors.source}
						maxLength={50}
						required
					/>
					<Field name="stage" invalid={Boolean(errors.stage)}>
						<FieldLabel htmlFor="lead-stage">阶段</FieldLabel>
						<Select
							value={values.stage}
							onValueChange={(stage) => {
								if (stage) updateValue("stage", stage);
							}}
						>
							<SelectTrigger
								id="lead-stage"
								aria-invalid={Boolean(errors.stage)}
							>
								<SelectValue>{() => getStageLabel(values.stage)}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{formStages.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<FieldError match={Boolean(errors.stage)}>
							{errors.stage}
						</FieldError>
					</Field>
					<TextField
						name="nextFollowAt"
						label="下次跟进"
						type="datetime-local"
						value={toLocalInputValue(values.nextFollowAt)}
						error={errors.nextFollowAt}
						onChange={(nextFollowAt) =>
							updateValue("nextFollowAt", nextFollowAt || null)
						}
					/>
					<Field name="note" invalid={Boolean(errors.note)}>
						<FieldLabel htmlFor="lead-note">备注</FieldLabel>
						<Textarea
							id="lead-note"
							name="note"
							aria-invalid={Boolean(errors.note)}
							maxLength={1000}
							value={values.note ?? ""}
							onChange={(event) => updateValue("note", event.target.value)}
							placeholder="记录家长诉求、沟通要点等"
						/>
						<FieldError match={Boolean(errors.note)}>{errors.note}</FieldError>
					</Field>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={pending}
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
							{isEditing ? "保存" : "创建"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
function TextField({
	name,
	label,
	value,
	onChange,
	error,
	type = "text",
	required = false,
	minLength,
	maxLength,
}: {
	name: keyof LeadFormValues;
	label: string;
	value: string | undefined;
	onChange: (value: string) => void;
	error?: string;
	type?: "text" | "tel" | "datetime-local";
	required?: boolean;
	minLength?: number;
	maxLength?: number;
}) {
	const id = `lead-${name}`;
	return (
		<Field name={name} invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				name={name}
				type={type}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? `${id}-error` : undefined}
				required={required}
				minLength={minLength}
				maxLength={maxLength}
			/>
			<FieldError id={`${id}-error`} match={Boolean(error)}>
				{error}
			</FieldError>
		</Field>
	);
}
function LeadsSkeleton() {
	return (
		<section className="border p-4">
			<div className="flex flex-col gap-4">
				{["one", "two", "three", "four"].map((key) => (
					<div className="flex justify-between" key={key}>
						<Skeleton className="h-9 w-48" />
						<Skeleton className="h-7 w-24" />
					</div>
				))}
			</div>
		</section>
	);
}
function formatFollowAt(value: string | null) {
	return value
		? new Intl.DateTimeFormat("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			}).format(new Date(value))
		: "未安排";
}
function toLocalInputValue(value: string | null) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const localDate = new Date(
		date.getTime() - date.getTimezoneOffset() * 60_000,
	);
	return localDate.toISOString().slice(0, 16);
}

function toApiDateTime(value: string | null) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function invalidateLeadQueries() {
	return queryClient.invalidateQueries({
		queryKey: orpc.training.leads.list.key(),
	});
}

function getStageLabel(stage: LeadFilterStage) {
	return stages.find((item) => item.value === stage)?.label ?? stage;
}
