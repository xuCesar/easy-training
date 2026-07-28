import {
	type CreatePlatformOnboardingInput,
	createPlatformOnboardingInputSchema,
	type PlatformOnboardingInvitation,
} from "@easy-training/api/contracts/platform";
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
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import {
	CheckCircle2Icon,
	CopyIcon,
	LoaderCircleIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { formatDateTime } from "@/features/training/format";
import { orpc } from "@/utils/orpc";

export type OnboardingSecret = {
	id: string;
	expiresAt: string;
	invitationUrl: string;
};

export type OnboardingConfirmation =
	| {
			kind: "rotate";
			invitation: PlatformOnboardingInvitation;
			requestId: string;
	  }
	| { kind: "revoke"; invitation: PlatformOnboardingInvitation };

function showMutationError(error: Error) {
	toast.error(error.message || "操作失败，请稍后重试。");
}

export function CreateOnboardingDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (secret: OnboardingSecret) => Promise<void>;
}) {
	const [email, setEmail] = useState("");
	const [organizationName, setOrganizationName] = useState("待完善机构");
	const [note, setNote] = useState("");
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const mutation = useMutation({
		...orpc.platform.onboarding.create.mutationOptions(),
		onSuccess: async (result) => {
			toast.success("开通邀请已创建");
			await onCreated(result);
		},
		onError: showMutationError,
	});

	useEffect(() => {
		if (!open) return;
		setEmail("");
		setOrganizationName("待完善机构");
		setNote("");
		setRequestId(crypto.randomUUID());
		mutation.reset();
	}, [open, mutation.reset]);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = createPlatformOnboardingInputSchema.safeParse({
			email,
			organizationName,
			note: note || undefined,
			requestId,
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? "请检查邀请信息。");
			return;
		}
		mutation.mutate(parsed.data as CreatePlatformOnboardingInput);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && mutation.isPending) return;
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>创建开通邀请</DialogTitle>
					<DialogDescription>
						链接固定有效 7 天，并且只在创建成功后显示一次。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit} noValidate>
					<Field>
						<FieldLabel htmlFor="platform-onboarding-email">
							受邀邮箱
						</FieldLabel>
						<Input
							id="platform-onboarding-email"
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="owner@example.com"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="platform-onboarding-organization">
							机构名称
						</FieldLabel>
						<Input
							id="platform-onboarding-organization"
							required
							maxLength={200}
							value={organizationName}
							onChange={(event) => setOrganizationName(event.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="platform-onboarding-note">
							备注（可选）
						</FieldLabel>
						<Textarea
							id="platform-onboarding-note"
							maxLength={500}
							value={note}
							onChange={(event) => setNote(event.target.value)}
							placeholder="仅平台操作员可见，不写入审计日志。"
						/>
					</Field>
					<DialogFooter className="flex-col-reverse sm:flex-row">
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

export function OnboardingConfirmationDialog({
	confirmation,
	onOpenChange,
	onChanged,
	onRotated,
}: {
	confirmation: OnboardingConfirmation | null;
	onOpenChange: (open: boolean) => void;
	onChanged: () => Promise<void>;
	onRotated: (secret: OnboardingSecret) => Promise<void>;
}) {
	const rotate = useMutation({
		...orpc.platform.onboarding.rotate.mutationOptions(),
		onSuccess: async (result) => {
			toast.success("已生成新的开通链接");
			await onRotated(result);
		},
		onError: showMutationError,
	});
	const revoke = useMutation({
		...orpc.platform.onboarding.revoke.mutationOptions(),
		onSuccess: async () => {
			toast.success("邀请已撤销");
			await onChanged();
		},
		onError: showMutationError,
	});
	const pending = rotate.isPending || revoke.isPending;
	if (!confirmation) return null;
	const isRotate = confirmation.kind === "rotate";

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && pending) return;
				onOpenChange(open);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{isRotate ? "重新生成开通链接" : "撤销开通邀请"}
					</DialogTitle>
					<DialogDescription>
						{isRotate
							? `将为 ${confirmation.invitation.email} 生成新链接；原链接会立即失效。`
							: `撤销后，${confirmation.invitation.email} 将无法再使用当前链接开通机构。`}
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2 border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
					<span>
						{isRotate
							? "请确认旧链接不再需要。"
							: "此操作不会影响已经创建的机构。"}
					</span>
				</div>
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
						variant={isRotate ? "default" : "destructive"}
						disabled={pending}
						onClick={() => {
							if (confirmation.kind === "rotate") {
								rotate.mutate({
									invitationId: confirmation.invitation.id,
									requestId: confirmation.requestId,
								});
								return;
							}
							revoke.mutate({ invitationId: confirmation.invitation.id });
						}}
					>
						{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
						{isRotate ? "确认重新生成" : "确认撤销"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function OnboardingSecretDialog({
	secret,
	onClose,
}: {
	secret: OnboardingSecret | null;
	onClose: () => void;
}) {
	async function copyInvitationUrl() {
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret.invitationUrl);
			toast.success("开通链接已复制");
		} catch {
			toast.error("复制失败，请手动选择链接复制。");
		}
	}

	return (
		<Dialog open={Boolean(secret)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader className="items-center pr-0 text-center">
					<span className="mb-2 grid size-11 place-items-center rounded-full border border-primary/30 text-primary">
						<CheckCircle2Icon className="size-6" />
					</span>
					<DialogTitle className="text-lg">开通邀请已创建</DialogTitle>
					<DialogDescription>
						请立即复制并安全发送。关闭后将无法再次查看此链接。
					</DialogDescription>
				</DialogHeader>
				{secret ? (
					<div className="grid gap-3">
						<Input
							readOnly
							value={secret.invitationUrl}
							aria-label="本次生成的开通链接"
							className="font-mono"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<Button type="button" onClick={() => void copyInvitationUrl()}>
							<CopyIcon data-icon="inline-start" />
							复制开通链接
						</Button>
						<p className="text-center text-muted-foreground text-xs">
							有效期至 {formatDateTime(secret.expiresAt)}
						</p>
					</div>
				) : null}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						完成
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
