import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import type { Confirmation } from "./settings-types";
import {
	confirmationDetails,
	showMutationError,
	toInvitationUrl,
} from "./settings-utils";

export function ConfirmationDialog({
	confirmation,
	onOpenChange,
	onChanged,
}: {
	confirmation: Confirmation | null;
	onOpenChange: (open: boolean) => void;
	onChanged: (url?: string) => Promise<void>;
}) {
	const setActive = useMutation({
		...orpc.training.campuses.setActive.mutationOptions(),
		onSuccess: async () => {
			toast.success("校区状态已更新");
			await onChanged();
		},
		onError: showMutationError,
	});
	const remove = useMutation({
		...orpc.training.members.remove.mutationOptions(),
		onSuccess: async () => {
			toast.success("成员已移除");
			await onChanged();
		},
		onError: showMutationError,
	});
	const revoke = useMutation({
		...orpc.training.invitations.revoke.mutationOptions(),
		onSuccess: async () => {
			toast.success("邀请已撤销");
			await onChanged();
		},
		onError: showMutationError,
	});
	const resend = useMutation({
		...orpc.training.invitations.resend.mutationOptions(),
		onSuccess: async (result) => {
			toast.success("已生成新邀请链接");
			await onChanged(toInvitationUrl(result.token));
		},
		onError: showMutationError,
	});
	const removeImpactQuery = useQuery({
		...orpc.training.members.ownerImpact.queryOptions({
			input: {
				kind: "remove",
				memberId:
					confirmation?.kind === "member"
						? confirmation.member.id
						: "00000000-0000-0000-0000-000000000000",
			},
		}),
		enabled: confirmation?.kind === "member",
	});
	const pending =
		setActive.isPending ||
		remove.isPending ||
		revoke.isPending ||
		resend.isPending ||
		(confirmation?.kind === "member" && removeImpactQuery.isPending);
	if (!confirmation) return null;
	const details = confirmationDetails(confirmation);
	function confirm(value: Confirmation) {
		switch (value.kind) {
			case "campus":
				setActive.mutate({
					id: value.campus.id,
					isActive: !value.campus.isActive,
				});
				return;
			case "member":
				remove.mutate({ memberId: value.member.id });
				return;
			case "revoke":
				revoke.mutate({ id: value.invitation.id });
				return;
			case "resend":
				resend.mutate({
					id: value.invitation.id,
					requestId: crypto.randomUUID(),
				});
		}
	}
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{details.title}</DialogTitle>
					<DialogDescription>{details.description}</DialogDescription>
				</DialogHeader>
				{confirmation.kind === "member" ? (
					removeImpactQuery.isError ? (
						<p className="border border-destructive/50 p-3 text-destructive text-sm">
							负责人影响范围加载失败，请重试后再移除。
						</p>
					) : (removeImpactQuery.data?.affectedStudentCount ?? 0) > 0 ? (
						<p className="border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
							移除后将自动清空该成员负责的{" "}
							{removeImpactQuery.data?.affectedStudentCount}{" "}
							位学员，并保留权限撤销历史。
						</p>
					) : null
				) : null}
				<DialogFooter className="flex-col-reverse sm:flex-row">
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						onClick={() => onOpenChange(false)}
					>
						取消
					</Button>
					<Button
						type="button"
						variant={details.destructive ? "destructive" : "default"}
						disabled={
							pending ||
							(confirmation.kind === "member" && removeImpactQuery.isError)
						}
						onClick={() => confirm(confirmation)}
					>
						{pending ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : null}
						{details.action}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
