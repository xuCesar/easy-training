import {
	addLeadFollowUpInputSchema,
	type CreateLeadInput,
	createLeadInputSchema,
	getLeadImportRpcBodyBytes,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	type LeadActivityRecord,
	type LeadListResult,
	type LeadRecord,
	type LeadRecordStage,
	type LeadStage,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
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
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowRightIcon,
	ClipboardPlusIcon,
	DownloadIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	UploadIcon,
	UsersRoundIcon,
} from "lucide-react";
import {
	type FormEvent,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import { LeadConversionDialog } from "@/features/training/lead-conversion-dialog";
import { useOrganization } from "@/features/training/organization-context";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "@/features/training/target-navigation";
import { downloadCsv } from "@/features/training/ui/download-csv";
import { FilterSelect } from "@/features/training/ui/filter-select";
import { TextField } from "@/features/training/ui/text-field";
import { client, orpc, queryClient } from "@/utils/orpc";

type LeadFilterStage = "all" | Exclude<LeadStage, "enrolled">;
type LeadFormValues = {
	name: string;
	phone: string;
	source: string;
	stage: CreateLeadInput["stage"];
	nextFollowAt: string | null;
	note: string | null;
};
type FollowUpValues = {
	content: string;
	stage: LeadRecordStage;
	nextFollowAt: string | null;
	lostReason: string | null;
};
type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>;
type FollowUpErrors = Partial<Record<keyof FollowUpValues, string>>;
type LeadImportPreview = {
	totalRows: number;
	validRows: number;
	errors: Array<{ row: number; message: string }>;
};

const leadImportHeaders = [
	"姓名",
	"手机号",
	"意向课程编码",
	"来源",
	"负责人邮箱",
	"跟进状态",
	"备注",
	"校区编码",
] as const;

const stageOptions: Array<{ value: LeadFilterStage; label: string }> = [
	{ value: "all", label: "全部阶段" },
	{ value: "new", label: "新线索" },
	{ value: "contacted", label: "已联系" },
	{ value: "trialBooked", label: "已约试听" },
	{ value: "lost", label: "已失单" },
];

const initialStageOptions: Array<{
	value: CreateLeadInput["stage"];
	label: string;
}> = stageOptions.filter(
	(item): item is { value: CreateLeadInput["stage"]; label: string } =>
		item.value !== "all" && item.value !== "lost",
);

const followUpStageOptions = stageOptions.filter(
	(item): item is { value: LeadRecordStage; label: string } =>
		item.value !== "all",
);

export function LeadsPage({
	sessionUserId,
	leadId,
	onClearLeadId,
}: {
	sessionUserId: string | undefined;
	leadId?: string;
	onClearLeadId: () => void;
}) {
	const { organization } = useOrganization();
	const [search, setSearch] = useState("");
	const [stage, setStage] = useState<LeadFilterStage>("all");
	const [campusId, setCampusId] = useState<string | null>(null);
	const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
	const [createdAtFrom, setCreatedAtFrom] = useState("");
	const [createdAtTo, setCreatedAtTo] = useState("");
	const [editor, setEditor] = useState<LeadRecord | null | "new">(null);
	const [followUpLead, setFollowUpLead] = useState<LeadRecord | null>(null);
	const [conversionLead, setConversionLead] = useState<LeadRecord | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [importContent, setImportContent] = useState<string | null>(null);
	const [importCampusId, setImportCampusId] = useState<string | null>(null);
	const [importRequestId, setImportRequestId] = useState<string | null>(null);
	const [importPreview, setImportPreview] = useState<LeadImportPreview | null>(
		null,
	);
	const importPreviewVersion = useRef(0);
	const deferredSearch = useDeferredValue(search.trim());
	const filterOptions = useQuery({
		...orpc.training.leads.filterOptions.queryOptions(),
		queryKey: [
			...orpc.training.leads.filterOptions.queryKey(),
			{ organizationId: organization.id, sessionUserId },
		],
	});
	const targetLeadQuery = useQuery({
		...orpc.training.leads.get.queryOptions({ input: { id: leadId ?? "" } }),
		enabled: Boolean(leadId),
		queryKey: ["training-lead-target", organization.id, leadId],
		retry: false,
	});
	useEffect(() => {
		if (targetLeadQuery.data) setEditor(targetLeadQuery.data);
	}, [targetLeadQuery.data]);
	useEffect(() => {
		if (
			!leadId ||
			!targetLeadQuery.isError ||
			!isUnavailableTargetError(targetLeadQuery.error)
		)
			return;
		toast.error(unavailableTargetMessage);
		onClearLeadId();
	}, [leadId, onClearLeadId, targetLeadQuery.error, targetLeadQuery.isError]);
	const filters = useMemo(
		() => ({
			query: deferredSearch || undefined,
			stage,
			campusId: campusId ?? undefined,
			ownerUserId: ownerUserId ?? undefined,
			createdAtFrom: toApiDateTime(createdAtFrom || null) ?? undefined,
			createdAtTo: toApiDateTime(createdAtTo || null) ?? undefined,
			pageSize: 20,
		}),
		[campusId, createdAtFrom, createdAtTo, deferredSearch, ownerUserId, stage],
	);
	const listQuery = useInfiniteQuery({
		queryKey: [
			...orpc.training.leads.list.key(),
			{ organizationId: organization.id, sessionUserId, filters },
		],
		queryFn: ({ pageParam }) =>
			client.training.leads.list({
				...filters,
				cursor: pageParam ?? undefined,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const exportMutation = useMutation(
		orpc.training.leads.export.mutationOptions({
			onSuccess: ({ csv, fileName }) => {
				downloadCsv(csv, fileName);
				toast.success("线索导出已开始下载");
			},
			onError: () => toast.error("暂时无法导出线索，请稍后重试"),
		}),
	);
	const previewImportMutation = useMutation(
		orpc.training.leads.import.preview.mutationOptions(),
	);
	const confirmImportMutation = useMutation(
		orpc.training.leads.import.confirm.mutationOptions({
			onSuccess: async (result) => {
				if (result.errorRows > 0) {
					setImportPreview((current) => ({
						totalRows:
							current?.totalRows ?? result.importedRows + result.errorRows,
						validRows: result.importedRows,
						errors: result.errors,
					}));
					setImportRequestId(null);
					toast.error(
						`已导入 ${result.importedRows} 条线索，${result.errorRows} 行未导入。`,
					);
				} else {
					toast.success(`已导入 ${result.importedRows} 条线索`);
					resetImport();
				}
				await queryClient.invalidateQueries({
					queryKey: orpc.training.leads.list.key(),
				});
			},
			onError: () => toast.error("线索导入失败，请稍后重试。"),
		}),
	);
	const pages = listQuery.data?.pages ?? [];
	const items = pages.flatMap((page) => page.items);
	const total = pages[0]?.total ?? 0;
	const isFiltered = Boolean(
		search ||
			stage !== "all" ||
			campusId ||
			ownerUserId ||
			createdAtFrom ||
			createdAtTo,
	);
	const canExport = ["owner", "admin", "campus_manager"].includes(
		organization.role,
	);

	function clearFilters() {
		setSearch("");
		setStage("all");
		setCampusId(null);
		setOwnerUserId(null);
		setCreatedAtFrom("");
		setCreatedAtTo("");
	}

	function downloadImportTemplate() {
		const csv = `\uFEFF${leadImportHeaders.map((header) => `"${header}"`).join(",")}\n`;
		downloadCsv(csv, "招生线索导入模板.csv");
	}

	function resetImport() {
		importPreviewVersion.current += 1;
		setImportOpen(false);
		setImportContent(null);
		setImportCampusId(null);
		setImportRequestId(null);
		setImportPreview(null);
		previewImportMutation.reset();
	}

	function openImportDialog() {
		setImportCampusId(campusId ?? filterOptions.data?.campuses[0]?.id ?? null);
		setImportOpen(true);
	}

	function replaceImportFile(content: string) {
		const nextRequestId = crypto.randomUUID();
		if (
			getLeadImportRpcBodyBytes({ content, campusId: importCampusId }) >
				LEAD_IMPORT_RPC_BODY_LIMIT_BYTES ||
			getLeadImportRpcBodyBytes({
				content,
				campusId: importCampusId,
				requestId: nextRequestId,
			}) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES
		) {
			toast.error(LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE);
			return;
		}
		setImportContent(content);
		setImportRequestId(nextRequestId);
		setImportPreview(null);
		previewImportMutation.reset();
		requestImportPreview(content, importCampusId);
	}

	function changeImportCampus(nextCampusId: string | null) {
		if (importContent) {
			const nextRequestId = crypto.randomUUID();
			if (
				getLeadImportRpcBodyBytes({
					content: importContent,
					campusId: nextCampusId,
				}) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES ||
				getLeadImportRpcBodyBytes({
					content: importContent,
					campusId: nextCampusId,
					requestId: nextRequestId,
				}) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES
			) {
				toast.error(LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE);
				return;
			}
			setImportRequestId(nextRequestId);
			setImportPreview(null);
			previewImportMutation.reset();
			requestImportPreview(importContent, nextCampusId);
		}
		setImportCampusId(nextCampusId);
	}

	function requestImportPreview(
		content: string,
		selectedCampusId: string | null,
	) {
		const version = importPreviewVersion.current + 1;
		importPreviewVersion.current = version;
		previewImportMutation.mutate(
			{ content, campusId: selectedCampusId },
			{
				onSuccess: (preview) => {
					if (importPreviewVersion.current === version) {
						setImportPreview(preview);
					}
				},
				onError: () => {
					if (importPreviewVersion.current === version) {
						toast.error("无法解析 CSV，请确认模板格式。");
					}
				},
			},
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-sm">招生线索</p>
					<h1 className="font-semibold text-2xl">线索管理</h1>
					<p className="text-muted-foreground text-xs" aria-live="polite">
						已加载 {items.length} / {total} 条
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" onClick={downloadImportTemplate}>
						<DownloadIcon data-icon="inline-start" />
						下载模板
					</Button>
					<Button variant="outline" onClick={openImportDialog}>
						<UploadIcon data-icon="inline-start" />
						导入
					</Button>
					{canExport ? (
						<Button
							variant="outline"
							disabled={exportMutation.isPending}
							onClick={() => exportMutation.mutate({ ...filters, limit: 1000 })}
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
					<Button onClick={() => setEditor("new")}>
						<PlusIcon data-icon="inline-start" />
						新增线索
					</Button>
				</div>
			</section>
			<section className="grid gap-3 border p-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="relative sm:col-span-2">
					<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="搜索线索"
						className="pl-8"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="搜索姓名、电话或来源"
					/>
				</div>
				<FilterSelect
					label="按阶段筛选"
					value={stage}
					onValueChange={(value) => setStage(value as LeadFilterStage)}
					items={stageOptions}
				/>
				<FilterSelect
					label="按校区筛选"
					value={campusId ?? "all"}
					onValueChange={(value) => setCampusId(value === "all" ? null : value)}
					items={[
						{ value: "all", label: "全部校区" },
						...(filterOptions.data?.campuses ?? []),
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
						...(filterOptions.data?.owners ?? []),
					]}
				/>
				<DateFilter
					label="创建时间从"
					value={createdAtFrom}
					onChange={setCreatedAtFrom}
				/>
				<DateFilter
					label="创建时间至"
					value={createdAtTo}
					onChange={setCreatedAtTo}
				/>
				{isFiltered ? (
					<Button type="button" variant="ghost" onClick={clearFilters}>
						清除筛选
					</Button>
				) : null}
			</section>
			<LeadResults
				items={items}
				isFiltered={isFiltered}
				query={listQuery}
				onEdit={setEditor}
				onFollowUp={setFollowUpLead}
				onConvert={setConversionLead}
			/>
			{listQuery.hasNextPage ? (
				<div className="flex justify-center">
					<Button
						variant="outline"
						disabled={listQuery.isFetchingNextPage}
						onClick={() => listQuery.fetchNextPage()}
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
			<LeadEditor
				key={editor === "new" ? "new" : (editor?.id ?? "closed")}
				lead={editor}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
						if (leadId) onClearLeadId();
					}
				}}
			/>
			{followUpLead ? (
				<LeadFollowUpDialog
					key={followUpLead.id}
					lead={followUpLead}
					onClose={() => setFollowUpLead(null)}
				/>
			) : null}
			{conversionLead ? (
				<LeadConversionDialog
					key={conversionLead.id}
					lead={conversionLead}
					onClose={() => setConversionLead(null)}
				/>
			) : null}
			<Dialog
				open={importOpen}
				onOpenChange={(open) => {
					if (!open) resetImport();
					else setImportOpen(true);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>导入招生线索</DialogTitle>
						<DialogDescription>
							CSV
							首行至少包含姓名、手机号、来源。模板另提供意向课程编码、负责人邮箱、
							跟进状态、备注和校区编码；跟进状态使用 new、contacted 或
							trialBooked。
						</DialogDescription>
					</DialogHeader>
					<Field name="import-campus">
						<FieldLabel htmlFor="import-campus">默认校区</FieldLabel>
						<Select
							value={importCampusId ?? "none"}
							onValueChange={(value) =>
								changeImportCampus(value === "none" ? null : value)
							}
							disabled={confirmImportMutation.isPending}
						>
							<SelectTrigger id="import-campus">
								<SelectValue>
									{() =>
										filterOptions.data?.campuses.find(
											(campus) => campus.id === importCampusId,
										)?.name ?? "不设置默认校区"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value="none">不设置默认校区</SelectItem>
									{(filterOptions.data?.campuses ?? []).map((campus) => (
										<SelectItem key={campus.id} value={campus.id}>
											{campus.name}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-xs">
							行内“校区编码”优先；该字段为空时使用此默认校区。更改默认校区会重新预览。
						</p>
					</Field>
					<Input
						type="file"
						accept=".csv,text/csv"
						disabled={
							previewImportMutation.isPending || confirmImportMutation.isPending
						}
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (!file) return;
							const reader = new FileReader();
							reader.onload = () => {
								if (typeof reader.result !== "string") return;
								replaceImportFile(reader.result);
							};
							reader.readAsText(file);
						}}
					/>
					{importPreview ? (
						<div className="flex flex-col gap-2 text-sm">
							<p>
								共 {importPreview.totalRows} 行，其中 {importPreview.validRows}{" "}
								行可导入。
								{importPreview.errors.length
									? ` ${importPreview.errors.length} 行校验失败。`
									: ""}
							</p>
							{importPreview.errors.length ? (
								<ul
									className="max-h-40 overflow-y-auto rounded-md border p-3 text-destructive text-xs"
									aria-live="polite"
								>
									{importPreview.errors.map((error) => (
										<li key={`${error.row}-${error.message}`}>
											第 {error.row} 行：{error.message}
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
					<DialogFooter>
						<Button variant="outline" onClick={resetImport}>
							取消
						</Button>
						<Button
							disabled={
								!importContent ||
								!importRequestId ||
								!importPreview?.validRows ||
								confirmImportMutation.isPending
							}
							onClick={() =>
								importContent &&
								importRequestId &&
								confirmImportMutation.mutate({
									content: importContent,
									campusId: importCampusId,
									requestId: importRequestId,
								})
							}
						>
							{confirmImportMutation.isPending ? "正在导入" : "确认导入"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function DateFilter({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<Field name={label}>
			<FieldLabel className="sr-only" htmlFor={label}>
				{label}
			</FieldLabel>
			<Input
				id={label}
				type="datetime-local"
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

function LeadResults({
	items,
	isFiltered,
	query,
	onEdit,
	onFollowUp,
	onConvert,
}: {
	items: LeadRecord[];
	isFiltered: boolean;
	query: ReturnType<typeof useInfiniteQuery<LeadListResult, Error>>;
	onEdit: (lead: LeadRecord) => void;
	onFollowUp: (lead: LeadRecord) => void;
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
					<EmptyDescription>暂时无法加载线索，请重试。</EmptyDescription>
				</EmptyHeader>
				<Button onClick={() => query.refetch()}>重试</Button>
			</Empty>
		);
	if (items.length === 0)
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
							<TableHead>负责人</TableHead>
							<TableHead>阶段</TableHead>
							<TableHead>下次跟进</TableHead>
							<TableHead className="text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((lead) => (
							<LeadTableRow
								key={lead.id}
								lead={lead}
								onEdit={onEdit}
								onFollowUp={onFollowUp}
								onConvert={onConvert}
							/>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y md:hidden">
				{items.map((lead) => (
					<LeadCompactRow
						key={lead.id}
						lead={lead}
						onEdit={onEdit}
						onFollowUp={onFollowUp}
						onConvert={onConvert}
					/>
				))}
			</div>
		</section>
	);
}

type LeadRowProps = {
	lead: LeadRecord;
	onEdit: (lead: LeadRecord) => void;
	onFollowUp: (lead: LeadRecord) => void;
	onConvert: (lead: LeadRecord) => void;
};

function LeadTableRow({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<TableRow>
			<TableCell>
				<p className="font-medium">{lead.name}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					{lead.phone} · {lead.source}
				</p>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{lead.owner || "未分配"}
			</TableCell>
			<TableCell>
				<LeadStageBadge stage={lead.stage} />
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatFollowAt(lead.nextFollowAt)}
			</TableCell>
			<TableCell className="text-right">
				<LeadActions
					lead={lead}
					onEdit={onEdit}
					onFollowUp={onFollowUp}
					onConvert={onConvert}
				/>
			</TableCell>
		</TableRow>
	);
}

function LeadCompactRow({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<article className="flex flex-col gap-3 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium text-sm">{lead.name}</p>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{lead.phone} · {lead.source}
					</p>
				</div>
				<LeadStageBadge stage={lead.stage} />
			</div>
			<div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
				<span>{lead.owner || "未分配"}</span>
				<span>{formatFollowAt(lead.nextFollowAt)}</span>
			</div>
			<LeadActions
				lead={lead}
				onEdit={onEdit}
				onFollowUp={onFollowUp}
				onConvert={onConvert}
			/>
		</article>
	);
}

function LeadActions({ lead, onEdit, onFollowUp, onConvert }: LeadRowProps) {
	return (
		<div className="flex flex-wrap justify-end gap-1">
			<Button variant="outline" size="sm" onClick={() => onFollowUp(lead)}>
				<ClipboardPlusIcon data-icon="inline-start" />
				跟进
			</Button>
			<Button variant="ghost" size="sm" onClick={() => onEdit(lead)}>
				<PencilIcon data-icon="inline-start" />
				编辑
			</Button>
			{lead.stage !== "lost" ? (
				<Button variant="ghost" size="sm" onClick={() => onConvert(lead)}>
					<ArrowRightIcon data-icon="inline-start" />
					转报名
				</Button>
			) : null}
		</div>
	);
}

function LeadStageBadge({ stage }: { stage: LeadRecordStage | "enrolled" }) {
	return (
		<Badge
			variant={
				stage === "lost"
					? "destructive"
					: stage === "enrolled"
						? "default"
						: "secondary"
			}
		>
			{getStageLabel(stage)}
		</Badge>
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
	const [requestId] = useState(() => crypto.randomUUID());
	const [values, setValues] = useState<LeadFormValues>(() =>
		isEditing
			? {
					name: lead.name,
					phone: lead.phone,
					source: lead.source,
					stage: "new",
					nextFollowAt: null,
					note: lead.note || null,
				}
			: {
					name: "",
					phone: "",
					source: "",
					stage: "new",
					nextFollowAt: null,
					note: null,
				},
	);
	const [errors, setErrors] = useState<LeadFormErrors>({});
	const createMutation = useMutation(
		orpc.training.leads.create.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.replayed ? "已确认创建，未重复新增" : "线索已新增",
				);
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`创建结果尚未确认：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.leads.update.mutationOptions({
			onSuccess: () => {
				toast.success("线索资料已更新");
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`保存失败：${error.message}`),
		}),
	);
	const pending = createMutation.isPending || updateMutation.isPending;

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = createLeadInputSchema.safeParse({
			...values,
			requestId,
			campusId: null,
			interestedCourseId: null,
			nextFollowAt: toApiDateTime(values.nextFollowAt),
			note: values.note || null,
		});
		if (!parsed.success) {
			setErrors(toFieldErrors(parsed.error.issues, values));
			toast.error("请检查表单中的必填项和格式");
			return;
		}

		setErrors({});
		if (isEditing) {
			updateMutation.mutate({
				id: lead.id,
				data: {
					name: parsed.data.name,
					phone: parsed.data.phone,
					source: parsed.data.source,
					note: parsed.data.note,
				},
			});
		} else {
			createMutation.mutate(parsed.data);
		}
	}

	return (
		<Dialog open={lead !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{isEditing ? "编辑线索资料" : "新增线索"}</DialogTitle>
					<DialogDescription>
						填写可用于后续招生跟进的基础信息。
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField
							id="lead-name"
							name="name"
							label="姓名"
							value={values.name}
							onChange={(name) =>
								setValues((current) => ({ ...current, name }))
							}
							error={errors.name}
							required
							maxLength={50}
						/>
						<TextField
							id="lead-phone"
							name="phone"
							label="电话"
							value={values.phone}
							onChange={(phone) =>
								setValues((current) => ({ ...current, phone }))
							}
							error={errors.phone}
							type="tel"
							required
							minLength={5}
							maxLength={30}
						/>
					</div>
					<TextField
						id="lead-source"
						name="source"
						label="来源"
						value={values.source}
						onChange={(source) =>
							setValues((current) => ({ ...current, source }))
						}
						error={errors.source}
						required
						maxLength={50}
					/>
					{!isEditing ? (
						<>
							<Field name="stage" invalid={Boolean(errors.stage)}>
								<FieldLabel htmlFor="lead-stage">初始阶段</FieldLabel>
								<Select
									value={values.stage}
									onValueChange={(stage) =>
										stage &&
										setValues((current) => ({
											...current,
											stage: stage as CreateLeadInput["stage"],
										}))
									}
								>
									<SelectTrigger
										id="lead-stage"
										className="w-full"
										aria-invalid={Boolean(errors.stage)}
									>
										<SelectValue>
											{() => getStageLabel(values.stage)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{initialStageOptions.map((item) => (
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
							<DateTimeField
								label="下次跟进"
								value={values.nextFollowAt}
								onChange={(value) =>
									setValues((current) => ({
										...current,
										nextFollowAt: value || null,
									}))
								}
								error={errors.nextFollowAt}
							/>
						</>
					) : null}
					<Field name="note" invalid={Boolean(errors.note)}>
						<FieldLabel htmlFor="lead-note">线索摘要</FieldLabel>
						<Textarea
							id="lead-note"
							name="note"
							aria-invalid={Boolean(errors.note)}
							maxLength={1000}
							value={values.note ?? ""}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									note: event.target.value,
								}))
							}
							placeholder="记录基础诉求或来源说明"
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
							{isEditing ? "保存" : pending ? "正在创建" : "创建"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function LeadFollowUpDialog({
	lead,
	onClose,
}: {
	lead: LeadRecord;
	onClose: () => void;
}) {
	const historyQuery = useQuery(
		orpc.training.leads.history.queryOptions({ input: { leadId: lead.id } }),
	);
	const [values, setValues] = useState<FollowUpValues>({
		content: "",
		stage: lead.stage,
		nextFollowAt: lead.nextFollowAt,
		lostReason: null,
	});
	const [errors, setErrors] = useState<FollowUpErrors>({});
	const mutation = useMutation(
		orpc.training.leads.followUp.mutationOptions({
			onSuccess: () => {
				toast.success("跟进已记录");
				void invalidateLeadQueries();
				void queryClient.invalidateQueries({
					queryKey: orpc.training.leads.history.key(),
				});
				onClose();
			},
			onError: (error) => toast.error(`跟进保存失败：${error.message}`),
		}),
	);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = addLeadFollowUpInputSchema.safeParse({
			leadId: lead.id,
			content: values.content,
			stage: values.stage,
			nextFollowAt: toApiDateTime(values.nextFollowAt),
			lostReason: values.lostReason || null,
		});
		if (!parsed.success) {
			setErrors(toFieldErrors(parsed.error.issues, values));
			toast.error("请补充本次跟进信息");
			return;
		}
		setErrors({});
		mutation.mutate(parsed.data);
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>跟进 {lead.name}</DialogTitle>
					<DialogDescription>
						每次保存都会留下不可编辑的跟进记录。
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
					<Field name="content" invalid={Boolean(errors.content)}>
						<FieldLabel htmlFor="follow-up-content">本次跟进</FieldLabel>
						<Textarea
							id="follow-up-content"
							value={values.content}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									content: event.target.value,
								}))
							}
							maxLength={1000}
							aria-invalid={Boolean(errors.content)}
							placeholder="记录沟通内容、家长反馈和下一步安排"
						/>
						<FieldError match={Boolean(errors.content)}>
							{errors.content}
						</FieldError>
					</Field>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field name="stage" invalid={Boolean(errors.stage)}>
							<FieldLabel htmlFor="follow-up-stage">当前阶段</FieldLabel>
							<Select
								value={values.stage}
								onValueChange={(stage) =>
									stage &&
									setValues((current) => ({
										...current,
										stage: stage as LeadRecordStage,
										lostReason: stage === "lost" ? current.lostReason : null,
									}))
								}
							>
								<SelectTrigger
									id="follow-up-stage"
									aria-invalid={Boolean(errors.stage)}
								>
									<SelectValue>{() => getStageLabel(values.stage)}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{followUpStageOptions.map((item) => (
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
						<DateTimeField
							label="下次跟进"
							value={values.nextFollowAt}
							onChange={(value) =>
								setValues((current) => ({
									...current,
									nextFollowAt: value || null,
								}))
							}
							error={errors.nextFollowAt}
						/>
					</div>
					{values.stage === "lost" ? (
						<Field name="lostReason" invalid={Boolean(errors.lostReason)}>
							<FieldLabel htmlFor="lost-reason">失单原因</FieldLabel>
							<Textarea
								id="lost-reason"
								value={values.lostReason ?? ""}
								onChange={(event) =>
									setValues((current) => ({
										...current,
										lostReason: event.target.value,
									}))
								}
								maxLength={500}
								aria-invalid={Boolean(errors.lostReason)}
								required
							/>
							<FieldError match={Boolean(errors.lostReason)}>
								{errors.lostReason}
							</FieldError>
						</Field>
					) : null}
					<LeadHistory
						history={historyQuery.data?.items ?? []}
						isPending={historyQuery.isPending}
						isError={historyQuery.isError}
						onRetry={() => historyQuery.refetch()}
					/>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<ClipboardPlusIcon data-icon="inline-start" />
							)}
							保存跟进
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function LeadHistory({
	history,
	isPending,
	isError,
	onRetry,
}: {
	history: LeadActivityRecord[];
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
}) {
	return (
		<section className="border-t pt-4">
			<h2 className="font-medium text-sm">跟进历史</h2>
			{isPending ? (
				<div className="mt-3 flex flex-col gap-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			) : null}
			{isError ? (
				<div className="mt-3 flex items-center gap-2 text-muted-foreground text-sm">
					<span>暂时无法加载历史。</span>
					<Button variant="outline" size="sm" onClick={onRetry}>
						重试
					</Button>
				</div>
			) : null}
			{!isPending && !isError ? (
				<ol className="mt-3 flex flex-col gap-3">
					{history.map((item) => (
						<LeadHistoryItem key={item.id} item={item} />
					))}
				</ol>
			) : null}
		</section>
	);
}

function LeadHistoryItem({ item }: { item: LeadActivityRecord }) {
	return (
		<li className="border-l-2 pl-3">
			<div className="flex flex-wrap items-center gap-2">
				<LeadStageBadge stage={item.stage} />
				<span className="text-muted-foreground text-xs">
					{item.operator} ·{" "}
					<time dateTime={item.createdAt}>
						{formatDateTime(item.createdAt)}
					</time>
				</span>
			</div>
			<p className="mt-1 text-sm">{item.content}</p>
			{item.nextFollowAt ? (
				<p className="mt-1 text-muted-foreground text-xs">
					下次跟进：{formatFollowAt(item.nextFollowAt)}
				</p>
			) : null}
			{item.lostReason ? (
				<p className="mt-1 text-destructive text-xs">
					失单原因：{item.lostReason}
				</p>
			) : null}
		</li>
	);
}

function DateTimeField({
	label,
	value,
	onChange,
	error,
}: {
	label: string;
	value: string | null;
	onChange: (value: string) => void;
	error?: string;
}) {
	const id = label.replaceAll(" ", "-");
	return (
		<Field name={id} invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type="datetime-local"
				value={toLocalInputValue(value)}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
			/>
			<FieldError match={Boolean(error)}>{error}</FieldError>
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

function getStageLabel(stage: LeadFilterStage | "enrolled") {
	if (stage === "enrolled") return "已转报名";
	return stageOptions.find((item) => item.value === stage)?.label ?? stage;
}

function formatFollowAt(value: string | null) {
	return value ? formatDateTime(value) : "未安排";
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function toLocalInputValue(value: string | null) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

function toApiDateTime(value: string | null) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toFieldErrors<T extends Record<string, unknown>>(
	issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
	values: T,
): Partial<Record<keyof T, string>> {
	const errors: Partial<Record<keyof T, string>> = {};
	for (const issue of issues) {
		const field = issue.path[0];
		if (typeof field === "string" && field in values)
			errors[field as keyof T] ??= issue.message;
	}
	return errors;
}

function invalidateLeadQueries() {
	return queryClient.invalidateQueries({
		queryKey: orpc.training.leads.list.key(),
	});
}
