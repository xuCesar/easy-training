import { Button } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@easy-training/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useOrganization } from "@/features/training/organization-context";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/audit")({ component: AuditRoute });

const actions = [
	{ value: "all", label: "全部操作" },
	{ value: "campus_created", label: "新建校区" },
	{ value: "campus_updated", label: "更新校区" },
	{ value: "campus_activated", label: "启用校区" },
	{ value: "campus_deactivated", label: "停用校区" },
	{ value: "invitation_created", label: "创建成员邀请" },
	{ value: "invitation_revoked", label: "撤销成员邀请" },
	{ value: "invitation_claimed", label: "接受成员邀请" },
	{ value: "member_role_changed", label: "调整成员角色" },
	{ value: "member_access_changed", label: "调整校区权限" },
	{ value: "member_removed", label: "移除成员" },
	{ value: "payment_created", label: "登记收款" },
	{ value: "refund_created", label: "登记退款" },
	{ value: "enrollment_renewed", label: "报名续费" },
	{ value: "enrollment_transferred", label: "报名转课" },
	{ value: "lesson_completed", label: "课次结课" },
	{ value: "lead_imported", label: "线索导入" },
	{ value: "lead_exported", label: "线索导出" },
	{ value: "notification_read", label: "通知已读" },
	{ value: "notifications_marked_read", label: "通知全部已读" },
] as const;

const entityLabels: Record<string, string> = {
	campus: "校区",
	organization_invitation: "成员邀请",
	organization_member: "机构成员",
	payment: "收款",
	refund: "退款",
	enrollment_renewal: "报名续费",
	enrollment_transfer: "报名转课",
	lesson: "课次",
	organization_notification: "站内通知",
	lead_import_batch: "线索导入批次",
	lead_export: "线索导出",
};

function AuditRoute() {
	const { organization } = useOrganization();
	const [action, setAction] =
		useState<(typeof actions)[number]["value"]>("all");
	const query = useQuery({
		...orpc.training.audit.list.queryOptions({
			input: { action: action === "all" ? undefined : action, pageSize: 50 },
		}),
		queryKey: ["training-audit", organization.id, action],
	});
	return (
		<div className="space-y-5">
			<section className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-muted-foreground text-sm">机构设置</p>
					<h1 className="font-semibold text-2xl">操作审计</h1>
				</div>
				<Select
					value={action}
					onValueChange={(value) => setAction(value as typeof action)}
				>
					<SelectTrigger className="w-48">
						<SelectValue aria-label="筛选操作类型">
							{() => actions.find((item) => item.value === action)?.label}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{actions.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>
			{query.isPending ? (
				<div className="space-y-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			) : null}
			{query.isError ? (
				<Empty className="min-h-56 border">
					<EmptyHeader>
						<EmptyTitle>审计记录加载失败</EmptyTitle>
						<EmptyDescription>暂时无法读取操作记录。</EmptyDescription>
					</EmptyHeader>
					<Button onClick={() => query.refetch()}>重试</Button>
				</Empty>
			) : null}
			{query.data?.items.length === 0 ? (
				<Empty className="min-h-56 border">
					<EmptyHeader>
						<EmptyTitle>暂无操作记录</EmptyTitle>
						<EmptyDescription>
							后续关键操作会在这里保留可追溯记录。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{query.data?.items.length ? (
				<section className="border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>操作</TableHead>
								<TableHead>对象</TableHead>
								<TableHead>操作者</TableHead>
								<TableHead>时间</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{query.data.items.map((item) => (
								<TableRow key={item.id}>
									<TableCell>
										{actions.find((entry) => entry.value === item.action)
											?.label ?? item.action}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{entityLabels[item.entityType] ?? item.entityType}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{item.actorName ?? "系统"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{new Intl.DateTimeFormat("zh-CN", {
											dateStyle: "medium",
											timeStyle: "short",
											timeZone: "Asia/Shanghai",
										}).format(new Date(item.createdAt))}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</section>
			) : null}
		</div>
	);
}
