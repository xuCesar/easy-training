import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { MailPlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { formatDateTime } from "@/features/training/format";
import { InvitationStatus } from "./settings-form-fields";
import { FailureState, SectionSkeleton } from "./settings-states";
import type { Invitation } from "./settings-types";
import { accessLabel, canResend, canRevoke, roleLabel } from "./settings-utils";

export function InvitationSection({
	data,
	isPending,
	isError,
	errorMessage,
	onRetry,
	onCreate,
	onResend,
	onRevoke,
}: {
	data?: Invitation[];
	isPending: boolean;
	isError: boolean;
	errorMessage?: string;
	onRetry: () => void;
	onCreate: () => void;
	onResend: (invitation: Invitation) => void;
	onRevoke: (invitation: Invitation) => void;
}) {
	return (
		<section className="space-y-3" aria-labelledby="invitations-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="invitations-heading" className="font-semibold text-lg">
						邀请
					</h2>
					<p className="text-muted-foreground text-sm">
						复制链接后请通过机构已有渠道发送；链接默认 7 天有效。
					</p>
				</div>
				<Button onClick={onCreate}>
					<MailPlusIcon data-icon="inline-start" />
					创建邀请
				</Button>
			</div>
			{isPending ? <SectionSkeleton /> : null}
			{isError ? (
				<FailureState
					title="邀请加载失败"
					message={errorMessage}
					onRetry={onRetry}
				/>
			) : null}
			{!isPending && !isError && data?.length === 0 ? (
				<Empty className="min-h-48 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MailPlusIcon />
						</EmptyMedia>
						<EmptyTitle>暂无邀请</EmptyTitle>
						<EmptyDescription>
							新建邀请后会获得可复制的注册链接。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{data && data.length > 0 ? (
				<div className="divide-y border">
					{data.map((invitation) => (
						<article
							key={invitation.id}
							className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<h3 className="font-medium">{invitation.emailMasked}</h3>
									<InvitationStatus invitation={invitation} />
								</div>
								<p className="mt-1 text-muted-foreground text-sm">
									{roleLabel(invitation.role)} ·{" "}
									{accessLabel(
										invitation.campusAccessMode,
										invitation.campusIds.length,
									)}
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{invitation.claimedAt
										? `已于 ${formatDateTime(invitation.claimedAt)} 加入`
										: `有效至 ${formatDateTime(invitation.expiresAt)}`}
								</p>
							</div>
							<div className="flex shrink-0 gap-2">
								{canResend(invitation) ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onResend(invitation)}
									>
										<RefreshCwIcon data-icon="inline-start" />
										重发
									</Button>
								) : null}
								{canRevoke(invitation) ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onRevoke(invitation)}
									>
										<Trash2Icon data-icon="inline-start" />
										撤销
									</Button>
								) : null}
							</div>
						</article>
					))}
				</div>
			) : null}
		</section>
	);
}
