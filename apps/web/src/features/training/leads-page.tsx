import {
	getLeadImportRpcBodyBytes,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	type LeadRecord,
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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
	DownloadIcon,
	LoaderCircleIcon,
	PlusIcon,
	SearchIcon,
	UploadIcon,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LeadConversionDialog } from "@/features/training/lead-conversion-dialog";
import { useOrganization } from "@/features/training/organization-context";
import {
	isUnavailableTargetError,
	unavailableTargetMessage,
} from "@/features/training/target-navigation";
import { downloadCsv } from "@/features/training/ui/download-csv";
import { FilterSelect } from "@/features/training/ui/filter-select";
import { client, orpc, queryClient } from "@/utils/orpc";
import { DateFilter } from "./leads/leads-date-filter";
import { LeadEditor } from "./leads/leads-editor";
import { LeadFollowUpDialog } from "./leads/leads-follow-up-dialog";
import { LeadResults } from "./leads/leads-results";
import {
	type LeadFilterStage,
	type LeadImportPreview,
	leadImportHeaders,
	stageOptions,
} from "./leads/leads-types";
import { toApiDateTime } from "./leads/leads-utils";

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
