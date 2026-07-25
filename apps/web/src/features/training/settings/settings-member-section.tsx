import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { PencilIcon, Trash2Icon, UsersRoundIcon } from "lucide-react";
import { formatDateTime } from "@/features/training/format";
import { FailureState, SectionSkeleton } from "./settings-states";
import type { Member, Role } from "./settings-types";
import { accessLabel, roleLabel } from "./settings-utils";

export function MemberSection({
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
