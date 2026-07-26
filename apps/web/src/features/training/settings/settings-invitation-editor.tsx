import {
	type CreateInvitationInput,
	createInvitationInputSchema,
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
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { RoleField, ScopeFields } from "./settings-form-fields";
import type { AccessMode, Campus, Role } from "./settings-types";
import { showMutationError, toInvitationUrl } from "./settings-utils";

export function InvitationEditor({
	open,
	campuses,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	campuses: Campus[];
	onOpenChange: (open: boolean) => void;
	onCreated: (url: string) => Promise<void>;
}) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("consultant");
	const [mode, setMode] = useState<AccessMode>("all");
	const [campusIds, setCampusIds] = useState<string[]>([]);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	useEffect(() => {
		if (open) {
			setEmail("");
			setRole("consultant");
			setMode("all");
			setCampusIds([]);
			setRequestId(crypto.randomUUID());
		}
	}, [open]);
	const mutation = useMutation({
		...orpc.training.invitations.create.mutationOptions(),
		onSuccess: async (result) => {
			toast.success("邀请已创建，邮件已发送（若已启用邮件服务）");
			await onCreated(toInvitationUrl(result.token));
		},
		onError: showMutationError,
	});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const globalRole = role === "admin";
		const parsed = createInvitationInputSchema.safeParse({
			email,
			role,
			campusAccessMode: globalRole ? "all" : mode,
			campusIds: globalRole || mode === "all" ? [] : campusIds,
			requestId,
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? "请检查邀请信息");
			return;
		}
		mutation.mutate(parsed.data as CreateInvitationInput);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>创建成员邀请</DialogTitle>
					<DialogDescription>
						系统会向受邀邮箱发送邀请链接；若未收到邮件，可在创建后复制链接手动发送。邮箱匹配不等同于邮箱控制权验证。
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4 sm:grid-cols-2"
					onSubmit={submit}
					noValidate
				>
					<Field className="sm:col-span-2">
						<FieldLabel htmlFor="invitation-email">受邀邮箱</FieldLabel>
						<Input
							id="invitation-email"
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="name@example.com"
						/>
					</Field>
					<RoleField
						value={role === "owner" ? "admin" : role}
						onChange={setRole}
						allowOwner={false}
					/>
					<ScopeFields
						className="sm:col-span-2"
						mode={role === "admin" ? "all" : mode}
						campusIds={campusIds}
						campuses={campuses}
						disabled={role === "admin"}
						onModeChange={setMode}
						onCampusIdsChange={setCampusIds}
					/>
					<DialogFooter className="flex-col-reverse sm:col-span-2 sm:flex-row">
						<Button
							type="button"
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => onOpenChange(false)}
						>
							取消
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							创建并获取链接
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
