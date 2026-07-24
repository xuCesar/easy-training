import {
	type Campus,
	type CreateCampusInput,
	type CreateInvitationInput,
	createCampusInputSchema,
	createInvitationInputSchema,
	type InvitationListResult,
	type MemberListResult,
	type UpdateCampusInput,
	type UpdateMemberInput,
	updateCampusInputSchema,
	updateMemberInputSchema,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import { Checkbox } from "@easy-training/ui/components/checkbox";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Building2Icon,
	CircleAlertIcon,
	CopyIcon,
	LoaderCircleIcon,
	MailPlusIcon,
	PencilIcon,
	PowerIcon,
	RefreshCwIcon,
	ShieldCheckIcon,
	Trash2Icon,
	UsersRoundIcon,
} from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	type SetStateAction,
	useEffect,
	useState,
} from "react";
import { toast } from "sonner";

import { formatDateTime } from "@/features/training/format";
import { useOrganization } from "@/features/training/organization-context";
import { orpc } from "@/utils/orpc";

type Member = MemberListResult["items"][number];
type Role = Member["role"];
type AccessMode = Member["campusAccessMode"];
type CampusFormValues = {
	code: string;
	name: string;
	city: string;
	address: string;
	roomCount: string;
	capacity: string;
};

const managementRoles = new Set<Role>(["owner", "admin"]);
const roleOptions: Array<{ value: Role; label: string }> = [
	{ value: "owner", label: "机构负责人" },
	{ value: "admin", label: "管理员" },
	{ value: "campus_manager", label: "校区负责人" },
	{ value: "consultant", label: "招生顾问" },
	{ value: "teacher", label: "教师" },
	{ value: "finance", label: "财务" },
];

export function SettingsPage({
	sessionUserId,
}: {
	sessionUserId: string | undefined;
}) {
	const { organization } = useOrganization();

	if (!managementRoles.has(organization.role)) {
		return <PermissionDenied />;
	}

	return (
		<SettingsWorkspace
			organizationId={organization.id}
			sessionUserId={sessionUserId}
			operatorRole={organization.role}
		/>
	);
}

function SettingsWorkspace({
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

function CampusSection({
	data,
	isPending,
	isError,
	errorMessage,
	onRetry,
	onCreate,
	onEdit,
	onToggle,
}: {
	data?: Campus[];
	isPending: boolean;
	isError: boolean;
	errorMessage?: string;
	onRetry: () => void;
	onCreate: () => void;
	onEdit: (campus: Campus) => void;
	onToggle: (campus: Campus) => void;
}) {
	return (
		<section className="space-y-3" aria-labelledby="campus-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="campus-heading" className="font-semibold text-lg">
						校区
					</h2>
					<p className="text-muted-foreground text-sm">
						停用后保留历史记录，但不能用于新的业务写入。
					</p>
				</div>
				<Button onClick={onCreate}>
					<Building2Icon data-icon="inline-start" />
					新建校区
				</Button>
			</div>
			{isPending ? <SectionSkeleton /> : null}
			{isError ? (
				<FailureState
					title="校区加载失败"
					message={errorMessage}
					onRetry={onRetry}
				/>
			) : null}
			{!isPending && !isError && data?.length === 0 ? (
				<Empty className="min-h-48 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Building2Icon />
						</EmptyMedia>
						<EmptyTitle>暂无校区</EmptyTitle>
						<EmptyDescription>
							创建第一个校区后，即可为成员配置访问范围。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{data && data.length > 0 ? (
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{data.map((campus) => (
						<article key={campus.id} className="min-w-0 border p-4">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<h3 className="truncate font-medium">{campus.name}</h3>
									<p className="mt-1 truncate text-muted-foreground text-xs">
										{campus.code} · {campus.city}
									</p>
								</div>
								<Badge variant={campus.isActive ? "default" : "secondary"}>
									{campus.isActive ? "启用中" : "已停用"}
								</Badge>
							</div>
							<p className="mt-3 line-clamp-2 text-muted-foreground text-sm">
								{campus.address}
							</p>
							<p className="mt-2 text-muted-foreground text-xs">
								{campus.roomCount} 间教室 · 容量 {campus.capacity} 人
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onEdit(campus)}
								>
									<PencilIcon data-icon="inline-start" />
									编辑
								</Button>
								<Button
									size="sm"
									variant={campus.isActive ? "outline" : "default"}
									onClick={() => onToggle(campus)}
								>
									<PowerIcon data-icon="inline-start" />
									{campus.isActive ? "停用" : "启用"}
								</Button>
							</div>
						</article>
					))}
				</div>
			) : null}
		</section>
	);
}

function MemberSection({
	data,
	isPending,
	isError,
	errorMessage,
	onRetry,
	onEdit,
	onRemove,
	operatorRole,
}: {
	data?: Member[];
	isPending: boolean;
	isError: boolean;
	errorMessage?: string;
	onRetry: () => void;
	onEdit: (member: Member) => void;
	onRemove: (member: Member) => void;
	operatorRole: Role;
}) {
	return (
		<section className="space-y-3" aria-labelledby="members-heading">
			<div>
				<h2 id="members-heading" className="font-semibold text-lg">
					成员与访问范围
				</h2>
				<p className="text-muted-foreground text-sm">
					角色与范围由服务端复核，变更会立即影响机构访问。
				</p>
			</div>
			{isPending ? <SectionSkeleton /> : null}
			{isError ? (
				<FailureState
					title="成员加载失败"
					message={errorMessage}
					onRetry={onRetry}
				/>
			) : null}
			{!isPending && !isError && data?.length === 0 ? (
				<Empty className="min-h-48 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<UsersRoundIcon />
						</EmptyMedia>
						<EmptyTitle>暂无成员</EmptyTitle>
						<EmptyDescription>通过下方邀请链接添加机构成员。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{data && data.length > 0 ? (
				<div className="divide-y border">
					{data.map((member) => {
						const locked = operatorRole === "admin" && member.role === "owner";
						return (
							<article
								key={member.id}
								className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="truncate font-medium">
											{member.name || "未命名成员"}
										</h3>
										<Badge variant="secondary">{roleLabel(member.role)}</Badge>
									</div>
									<p className="mt-1 truncate text-muted-foreground text-sm">
										{member.email}
									</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{accessLabel(
											member.campusAccessMode,
											member.campusIds.length,
										)}{" "}
										· 加入于 {formatDateTime(member.createdAt)}
									</p>
								</div>
								<div className="flex shrink-0 gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={locked}
										onClick={() => onEdit(member)}
									>
										<PencilIcon data-icon="inline-start" />
										编辑
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={locked}
										onClick={() => onRemove(member)}
									>
										<Trash2Icon data-icon="inline-start" />
										移除
									</Button>
								</div>
								{locked ? (
									<p className="text-muted-foreground text-xs sm:hidden">
										管理员不能管理负责人。
									</p>
								) : null}
							</article>
						);
					})}
				</div>
			) : null}
		</section>
	);
}

function InvitationSection({
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

type Invitation = InvitationListResult["items"][number];

function CampusEditor({
	campus,
	open,
	onOpenChange,
	onChanged,
}: {
	campus: Campus | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => Promise<void>;
}) {
	const [values, setValues] = useState<CampusFormValues>(() =>
		toCampusValues(campus),
	);
	const [errors, setErrors] = useState<
		Partial<Record<keyof CampusFormValues, string>>
	>({});
	useEffect(() => {
		if (open) {
			setValues(toCampusValues(campus));
			setErrors({});
		}
	}, [campus, open]);
	const createMutation = useMutation({
		...orpc.training.campuses.create.mutationOptions(),
		onSuccess: async () => {
			toast.success("校区已创建");
			await onChanged();
		},
		onError: showMutationError,
	});
	const updateMutation = useMutation({
		...orpc.training.campuses.update.mutationOptions(),
		onSuccess: async () => {
			toast.success("校区已更新");
			await onChanged();
		},
		onError: showMutationError,
	});
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = campus
			? updateCampusInputSchema.safeParse({
					id: campus.id,
					data: toCampusInput(values),
				})
			: createCampusInputSchema.safeParse(toCampusInput(values));
		if (!data.success) {
			setErrors(toFormErrors(data.error.issues));
			toast.error("请检查校区信息");
			return;
		}
		setErrors({});
		if (campus) updateMutation.mutate(data.data as UpdateCampusInput);
		else createMutation.mutate(data.data as CreateCampusInput);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{campus ? "编辑校区" : "新建校区"}</DialogTitle>
					<DialogDescription>
						编码在当前机构内唯一；停用请使用校区卡片中的操作。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit} noValidate>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="校区名称"
							name="name"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="校区编码"
							name="code"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="城市"
							name="city"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="地址"
							name="address"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="教室数"
							name="roomCount"
							type="number"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="容纳人数"
							name="capacity"
							type="number"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
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
						<Button type="submit" disabled={pending}>
							{pending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{campus ? "保存" : "创建校区"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ScopeEditor({
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

function InvitationEditor({
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
			toast.success("邀请已创建，请复制链接发送");
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
						当前版本不会发送邮件。请复制链接并通过机构已有渠道发送；邮箱匹配不等同于邮箱控制权验证。
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

type Confirmation =
	| { kind: "campus"; campus: Campus }
	| { kind: "member"; member: Member }
	| { kind: "revoke" | "resend"; invitation: Invitation };
function ConfirmationDialog({
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

function InvitationLinkDialog({
	url,
	onOpenChange,
}: {
	url: string | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={url !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>复制邀请链接</DialogTitle>
					<DialogDescription>
						链接只在此处显示一次，请立即复制并安全发送。
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2">
					<Input aria-label="邀请链接" readOnly value={url ?? ""} />
					<Button
						type="button"
						size="icon"
						aria-label="复制邀请链接"
						disabled={!url}
						onClick={() => url && void copyInvitationUrl(url)}
					>
						<CopyIcon />
					</Button>
				</div>
				<DialogFooter>
					<Button type="button" onClick={() => onOpenChange(false)}>
						完成
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RoleField({
	value,
	onChange,
	allowOwner,
}: {
	value: Role;
	onChange: (role: Role) => void;
	allowOwner: boolean;
}) {
	return (
		<Field>
			<FieldLabel>机构角色</FieldLabel>
			<Select
				value={value}
				onValueChange={(next) => next && onChange(next as Role)}
			>
				<SelectTrigger className="w-full" aria-label="选择机构角色">
					<SelectValue>{() => roleLabel(value)}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{roleOptions
							.filter((option) => allowOwner || option.value !== "owner")
							.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}
function ScopeFields({
	className,
	mode,
	campusIds,
	campuses,
	disabled = false,
	onModeChange,
	onCampusIdsChange,
}: {
	className?: string;
	mode: AccessMode;
	campusIds: string[];
	campuses: Campus[];
	disabled?: boolean;
	onModeChange: (mode: AccessMode) => void;
	onCampusIdsChange: (ids: string[]) => void;
}) {
	return (
		<Field className={className}>
			<FieldLabel>校区访问范围</FieldLabel>
			<Select
				value={mode}
				disabled={disabled}
				onValueChange={(next) => next && onModeChange(next as AccessMode)}
			>
				<SelectTrigger className="w-full" aria-label="选择校区访问范围">
					<SelectValue>
						{() => (mode === "all" ? "全部校区" : "指定校区")}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value="all">全部校区</SelectItem>
						<SelectItem value="selected">指定校区</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
			{mode === "selected" && !disabled ? (
				<div className="mt-3 grid gap-2 rounded-md border p-3">
					{campuses.length === 0 ? (
						<p className="text-muted-foreground text-sm">暂无校区可分配。</p>
					) : (
						campuses.map((campus) => {
							const checked = campusIds.includes(campus.id);
							const id = `scope-campus-${campus.id}`;
							return (
								<label
									key={campus.id}
									htmlFor={id}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<Checkbox
										id={id}
										checked={checked}
										onCheckedChange={(next) =>
											onCampusIdsChange(
												next
													? [...campusIds, campus.id]
													: campusIds.filter((id) => id !== campus.id),
											)
										}
									/>
									<span>{campus.name}</span>
									{!campus.isActive ? (
										<Badge variant="secondary">已停用</Badge>
									) : null}
								</label>
							);
						})
					)}
				</div>
			) : (
				<p className="mt-2 text-muted-foreground text-xs">
					{disabled
						? "该角色固定拥有全部校区访问权限。"
						: "可访问当前机构的全部校区。"}
				</p>
			)}
		</Field>
	);
}
function CampusField({
	label,
	name,
	type = "text",
	values,
	setValues,
	errors,
}: {
	label: string;
	name: keyof CampusFormValues;
	type?: "text" | "number";
	values: CampusFormValues;
	setValues: Dispatch<SetStateAction<CampusFormValues>>;
	errors: Partial<Record<keyof CampusFormValues, string>>;
}) {
	const id = `campus-${name}`;
	return (
		<Field invalid={Boolean(errors[name])}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type={type}
				min={type === "number" ? 0 : undefined}
				required
				value={values[name]}
				onChange={(event) =>
					setValues((current) => ({ ...current, [name]: event.target.value }))
				}
				aria-invalid={Boolean(errors[name])}
			/>
			<FieldError match={Boolean(errors[name])}>{errors[name]}</FieldError>
		</Field>
	);
}
function InvitationStatus({ invitation }: { invitation: Invitation }) {
	if (invitation.claimedAt) return <Badge variant="secondary">已领取</Badge>;
	if (invitation.revokedAt) return <Badge variant="secondary">已撤销</Badge>;
	if (!isActiveInvitation(invitation))
		return <Badge variant="secondary">已过期</Badge>;
	return <Badge>待领取</Badge>;
}
function PermissionDenied() {
	return (
		<Empty className="min-h-72 border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<ShieldCheckIcon />
				</EmptyMedia>
				<EmptyTitle>无权访问机构设置</EmptyTitle>
				<EmptyDescription>
					仅机构负责人和管理员可以管理校区、成员与邀请。
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
function FailureState({
	title,
	message,
	onRetry,
}: {
	title: string;
	message?: string;
	onRetry: () => void;
}) {
	return (
		<Empty className="min-h-48 border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{message ?? "请稍后重试。"}</EmptyDescription>
			</EmptyHeader>
			<Button onClick={onRetry}>重试</Button>
		</Empty>
	);
}
function SectionSkeleton() {
	return (
		<div className="grid gap-3 md:grid-cols-2">
			<Skeleton className="h-32" />
			<Skeleton className="h-32" />
		</div>
	);
}
function toCampusValues(campus: Campus | null): CampusFormValues {
	return {
		code: campus?.code ?? "",
		name: campus?.name ?? "",
		city: campus?.city ?? "",
		address: campus?.address ?? "",
		roomCount: String(campus?.roomCount ?? 0),
		capacity: String(campus?.capacity ?? 0),
	};
}
function toCampusInput(values: CampusFormValues) {
	return {
		code: values.code,
		name: values.name,
		city: values.city,
		address: values.address,
		roomCount: Number(values.roomCount),
		capacity: Number(values.capacity),
	};
}
function toFormErrors(
	issues: Array<{ path: PropertyKey[]; message: string }>,
): Partial<Record<keyof CampusFormValues, string>> {
	const errors: Partial<Record<keyof CampusFormValues, string>> = {};
	for (const issue of issues) {
		const field = issue.path.at(-1);
		if (
			typeof field === "string" &&
			field in
				{
					code: true,
					name: true,
					city: true,
					address: true,
					roomCount: true,
					capacity: true,
				}
		)
			errors[field as keyof CampusFormValues] ??= issue.message;
	}
	return errors;
}
function roleLabel(role: Role): string {
	return (
		roleOptions.find((option) => option.value === role)?.label ?? "机构成员"
	);
}
function accessLabel(mode: AccessMode, count: number): string {
	return mode === "all" ? "全部校区" : `指定校区（${count} 个）`;
}
function isActiveInvitation(invitation: Invitation): boolean {
	return (
		!invitation.claimedAt &&
		!invitation.revokedAt &&
		new Date(invitation.expiresAt).getTime() > Date.now()
	);
}
function canRevoke(invitation: Invitation): boolean {
	return isActiveInvitation(invitation);
}
function canResend(invitation: Invitation): boolean {
	return isActiveInvitation(invitation);
}
function confirmationDetails(confirmation: Confirmation) {
	if (confirmation.kind === "campus") {
		const action = confirmation.campus.isActive ? "停用" : "启用";
		return {
			title: `${action}校区`,
			description: confirmation.campus.isActive
				? `停用“${confirmation.campus.name}”后，历史数据仍可读取，但不能再用于新的业务写入。`
				: `确认重新启用“${confirmation.campus.name}”？`,
			action,
			destructive: confirmation.campus.isActive,
		};
	}
	if (confirmation.kind === "member")
		return {
			title: "移除成员",
			description: `确认移除 ${confirmation.member.email} 吗？该成员将立即失去当前机构访问权限。`,
			action: "移除成员",
			destructive: true,
		};
	if (confirmation.kind === "revoke")
		return {
			title: "撤销邀请",
			description: "确认撤销这条邀请吗？该链接将不能再被领取。",
			action: "撤销邀请",
			destructive: true,
		};
	return {
		title: "重发邀请",
		description: "将撤销此前仍有效的邀请，并生成一条新的邀请链接。",
		action: "生成新链接",
		destructive: false,
	};
}
function toInvitationUrl(token: string): string {
	return `${window.location.origin}/invite#token=${token}`;
}
function showMutationError(error: unknown) {
	toast.error(
		error instanceof Error ? error.message : "操作失败，请稍后重试。",
	);
}
async function copyInvitationUrl(url: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(url);
		toast.success("邀请链接已复制");
	} catch {
		toast.error("复制失败，请手动复制链接。");
	}
}
