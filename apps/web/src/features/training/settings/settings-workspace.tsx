import { Button } from "@easy-training/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { CampusEditor } from "./settings-campus-editor";
import { CampusSection } from "./settings-campus-section";
import { ConfirmationDialog } from "./settings-confirmation-dialog";
import { InvitationEditor } from "./settings-invitation-editor";
import { InvitationLinkDialog } from "./settings-invitation-link-dialog";
import { InvitationSection } from "./settings-invitation-section";
import { MemberSection } from "./settings-member-section";
import { ScopeEditor } from "./settings-scope-editor";
import type { Campus, Confirmation, Member, Role } from "./settings-types";

export function SettingsWorkspace({
	organizationId,
	sessionUserId,
	operatorRole,
}: {
	organizationId: string;
	sessionUserId?: string;
	operatorRole: Role;
}) {
	const [campusEditor, setCampusEditor] = useState<Campus | "new" | null>(null);
	const [memberEditor, setMemberEditor] = useState<Member | null>(null);
	const [invitationOpen, setInvitationOpen] = useState(false);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [latestInvitationUrl, setLatestInvitationUrl] = useState<string | null>(
		null,
	);
	const campusOptions = orpc.training.campuses.list.queryOptions({
		input: { includeInactive: true },
	});
	const memberOptions = orpc.training.members.list.queryOptions();
	const invitationOptions = orpc.training.invitations.list.queryOptions();
	const queryContext = { organizationId, sessionUserId };
	const campusesQuery = useQuery({
		...campusOptions,
		queryKey: [...campusOptions.queryKey, queryContext],
	});
	const membersQuery = useQuery({
		...memberOptions,
		queryKey: [...memberOptions.queryKey, queryContext],
	});
	const invitationsQuery = useQuery({
		...invitationOptions,
		queryKey: [...invitationOptions.queryKey, queryContext],
	});

	async function refreshSettings() {
		await Promise.all([
			campusesQuery.refetch(),
			membersQuery.refetch(),
			invitationsQuery.refetch(),
		]);
	}

	return (
		<div className="flex min-w-0 flex-col gap-8">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-muted-foreground text-sm">机构管理</p>
					<h1 className="mt-1 font-semibold text-2xl">机构设置</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						管理校区、成员权限与邀请链接。
					</p>
				</div>
				<Button variant="outline" onClick={() => void refreshSettings()}>
					<RefreshCwIcon data-icon="inline-start" /> 刷新
				</Button>
			</section>

			<CampusSection
				data={campusesQuery.data?.items}
				isPending={campusesQuery.isPending}
				isError={campusesQuery.isError}
				errorMessage={campusesQuery.error?.message}
				onRetry={() => campusesQuery.refetch()}
				onCreate={() => setCampusEditor("new")}
				onEdit={setCampusEditor}
				onToggle={(campus) => setConfirmation({ kind: "campus", campus })}
			/>

			<MemberSection
				data={membersQuery.data?.items}
				isPending={membersQuery.isPending}
				isError={membersQuery.isError}
				errorMessage={membersQuery.error?.message}
				onRetry={() => membersQuery.refetch()}
				onEdit={setMemberEditor}
				onRemove={(member) => setConfirmation({ kind: "member", member })}
				operatorRole={operatorRole}
			/>

			<InvitationSection
				data={invitationsQuery.data?.items}
				isPending={invitationsQuery.isPending}
				isError={invitationsQuery.isError}
				errorMessage={invitationsQuery.error?.message}
				onRetry={() => invitationsQuery.refetch()}
				onCreate={() => setInvitationOpen(true)}
				onResend={(invitation) =>
					setConfirmation({ kind: "resend", invitation })
				}
				onRevoke={(invitation) =>
					setConfirmation({ kind: "revoke", invitation })
				}
			/>

			<CampusEditor
				campus={campusEditor === "new" ? null : campusEditor}
				open={campusEditor !== null}
				onOpenChange={(open) => !open && setCampusEditor(null)}
				onChanged={async () => {
					await refreshSettings();
					setCampusEditor(null);
				}}
			/>
			<ScopeEditor
				open={memberEditor !== null}
				member={memberEditor}
				campuses={campusesQuery.data?.items ?? []}
				operatorRole={operatorRole}
				onOpenChange={(open) => !open && setMemberEditor(null)}
				onChanged={async () => {
					await refreshSettings();
					setMemberEditor(null);
				}}
			/>
			<InvitationEditor
				open={invitationOpen}
				campuses={campusesQuery.data?.items ?? []}
				onOpenChange={setInvitationOpen}
				onCreated={async (url) => {
					setLatestInvitationUrl(url);
					await refreshSettings();
					setInvitationOpen(false);
				}}
			/>
			<ConfirmationDialog
				confirmation={confirmation}
				onOpenChange={(open) => !open && setConfirmation(null)}
				onChanged={async (url) => {
					if (url) setLatestInvitationUrl(url);
					await refreshSettings();
					setConfirmation(null);
				}}
			/>
			<InvitationLinkDialog
				url={latestInvitationUrl}
				onOpenChange={(open) => !open && setLatestInvitationUrl(null)}
			/>
		</div>
	);
}
