import {
	getLeadImportRpcBodyBytes,
	LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE,
	LEAD_IMPORT_RPC_BODY_LIMIT_BYTES,
	type PreviewStudentImportResult,
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
import { Input } from "@easy-training/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";

export function StudentImportDialog({
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
