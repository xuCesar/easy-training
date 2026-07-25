import type { StudentTag } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Input } from "@easy-training/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, PowerIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { invalidateTagQueries } from "./students-queries";

export function TagManager({
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
