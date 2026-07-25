import {
	type UpdateMemberInput,
	updateMemberInputSchema,
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
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { RoleField, ScopeFields } from "./settings-form-fields";
import type { AccessMode, Campus, Member, Role } from "./settings-types";
import { showMutationError } from "./settings-utils";

export function ScopeEditor({
	open,
	member,
	campuses,
	operatorRole,
	onOpenChange,
	onChanged,
}: {
	open: boolean;
	member: Member | null;
	campuses: Campus[];
	operatorRole: Role;
	onOpenChange: (open: boolean) => void;
	onChanged: () => Promise<void>;
}) {
	const [role, setRole] = useState<Role>("consultant");
	const [mode, setMode] = useState<AccessMode>("all");
	const [campusIds, setCampusIds] = useState<string[]>([]);
	useEffect(() => {
		if (member) {
			setRole(member.role);
			setMode(member.campusAccessMode);
			setCampusIds(member.campusIds);
		}
	}, [member]);
	const mutation = useMutation({
		...orpc.training.members.update.mutationOptions(),
		onSuccess: async () => {
			toast.success("成员权限已更新");
			await onChanged();
		},
		onError: showMutationError,
	});
	const globalRole = role === "owner" || role === "admin";
	const memberId = member?.id ?? "00000000-0000-0000-0000-000000000000";
	const normalizedCampusAccessMode = globalRole ? "all" : mode;
	const normalizedCampusIds = globalRole || mode === "all" ? [] : campusIds;
	const impactQuery = useQuery({
		...orpc.training.members.ownerImpact.queryOptions({
			input: {
				kind: "update",
				memberId,
				role,
				campusAccessMode: normalizedCampusAccessMode,
				campusIds: normalizedCampusIds,
			},
		}),
		enabled: open && member !== null,
	});
	if (!member) return null;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = updateMemberInputSchema.safeParse({
			memberId,
			role,
			campusAccessMode: normalizedCampusAccessMode,
			campusIds: normalizedCampusIds,
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? "成员设置无效");
			return;
		}
		mutation.mutate(parsed.data as UpdateMemberInput);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>编辑成员权限</DialogTitle>
					<DialogDescription>
						{member.email}。负责人和管理员固定拥有全机构访问。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<RoleField
						value={role}
						onChange={setRole}
						allowOwner={operatorRole === "owner"}
					/>
					<ScopeFields
						mode={globalRole ? "all" : mode}
						campusIds={campusIds}
						campuses={campuses}
						disabled={globalRole}
						onModeChange={setMode}
						onCampusIdsChange={setCampusIds}
					/>
					{impactQuery.isPending ? (
						<Skeleton className="h-12 w-full" />
					) : impactQuery.isError ? (
						<p className="border border-destructive/50 p-3 text-destructive text-sm">
							负责人影响范围加载失败，请重试后再保存。
						</p>
					) : (impactQuery.data?.affectedStudentCount ?? 0) > 0 ? (
						<p className="border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
							保存后将自动清空该成员负责的{" "}
							{impactQuery.data?.affectedStudentCount}{" "}
							位学员，并保留权限撤销历史。
						</p>
					) : (
						<p className="text-muted-foreground text-xs">
							本次变更不会清空学员负责人。
						</p>
					)}
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							type="button"
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => onOpenChange(false)}
						>
							取消
						</Button>
						<Button
							type="submit"
							disabled={
								mutation.isPending ||
								impactQuery.isPending ||
								impactQuery.isError
							}
						>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							保存权限
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
