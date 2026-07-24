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
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useOrganization } from "@/features/training/organization-context";
import { client } from "@/utils/orpc";

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
	{ value: "payment_reversed", label: "冲正收款" },
	{ value: "receipt_generated", label: "开具收款凭证" },
	{ value: "receipt_voided", label: "作废收款凭证" },
	{ value: "receipt_reissued", label: "补开收款凭证" },
	{ value: "manual_invoice_created", label: "手工开单" },
	{ value: "invoice_adjusted", label: "调整账单" },
	{ value: "refund_created", label: "登记退款" },
	{ value: "refund_request_submitted", label: "提交退款申请" },
	{ value: "refund_request_approved", label: "批准退款申请" },
	{ value: "refund_request_rejected", label: "拒绝退款申请" },
	{ value: "refund_request_cancelled", label: "取消退款申请" },
	{ value: "arrears_status_changed", label: "欠费状态变更" },
	{ value: "enrollment_renewed", label: "报名续费" },
	{ value: "enrollment_transferred", label: "报名转课" },
	{ value: "enrollment_created", label: "独立办理报名" },
	{ value: "enrollment_frozen", label: "冻结报名" },
	{ value: "enrollment_resumed", label: "恢复报名" },
	{ value: "enrollment_class_transferred", label: "转班" },
	{ value: "enrollment_class_withdrawn", label: "退班" },
	{ value: "student_merged", label: "合并学员" },
	{ value: "lesson_completed", label: "课次结课" },
	{ value: "schedule_rule_created", label: "创建排课规则" },
	{ value: "schedule_rule_updated", label: "更新排课规则" },
	{ value: "schedule_rule_deactivated", label: "停用排课规则" },
	{ value: "schedule_rule_deleted", label: "删除排课规则" },
	{ value: "lessons_generated", label: "批量生成课次" },
	{ value: "lessons_bulk_rescheduled", label: "批量调课" },
	{ value: "lessons_bulk_cancelled", label: "批量取消课次" },
	{ value: "teacher_binding_changed", label: "教师账号绑定" },
	{ value: "class_paused", label: "班级停课" },
	{ value: "class_resumed", label: "班级复课" },
	{ value: "classroom_created", label: "新建教室" },
	{ value: "classroom_updated", label: "更新教室" },
	{ value: "classroom_activated", label: "启用教室" },
	{ value: "classroom_deactivated", label: "停用教室" },
	{ value: "makeup_lesson_created", label: "安排补课" },
	{ value: "makeup_lesson_cancelled", label: "取消补课" },
	{ value: "makeup_lesson_needs_reschedule", label: "补课待重排" },
	{ value: "lead_imported", label: "线索导入" },
	{ value: "lead_exported", label: "线索导出" },
	{ value: "student_imported", label: "学员导入" },
	{ value: "student_exported", label: "学员导出" },
	{ value: "students_bulk_updated", label: "批量更新学员" },
	{ value: "operation_task_created", label: "新建任务" },
	{ value: "operation_task_updated", label: "更新任务" },
	{ value: "operation_task_claimed", label: "认领任务" },
	{ value: "operation_task_completed", label: "完成任务" },
	{ value: "operation_task_reopened", label: "重新打开任务" },
	{ value: "operation_task_cancelled", label: "取消任务" },
	{ value: "analytics_filter_saved", label: "保存经营分析筛选" },
	{ value: "analytics_filter_updated", label: "更新经营分析筛选" },
	{ value: "analytics_filter_deleted", label: "删除经营分析筛选" },
	{ value: "analytics_exported", label: "导出经营分析" },
	{ value: "notification_read", label: "通知已读" },
	{ value: "notifications_marked_read", label: "通知全部已读" },
] as const;

const entityLabels: Record<string, string> = {
	campus: "校区",
	organization_invitation: "成员邀请",
	organization_member: "机构成员",
	payment: "收款",
	payment_reversal: "收款冲正",
	receipt_document: "收款凭证",
	invoice_arrears_cycle: "欠费周期",
	manual_invoice_creation: "手工开单",
	invoice_adjustment: "账单调整",
	refund: "退款",
	refund_request: "退款申请",
	enrollment_renewal: "报名续费",
	enrollment_transfer: "报名转课",
	enrollment_registration: "独立报名",
	enrollment_lifecycle_event: "报名状态操作",
	student_merge: "学员合并",
	lesson: "课次",
	lesson_schedule_rule: "排课规则",
	class_group: "班级",
	classroom: "教室",
	makeup_lesson: "补课安排",
	teacher: "教师",
	organization_notification: "站内通知",
	lead_import_batch: "线索导入批次",
	lead_export: "线索导出",
	student_import_batch: "学员导入批次",
	student_export: "学员导出",
	student_bulk_operation_batch: "学员批量操作",
	operation_task: "运营任务",
	analyticsSavedFilter: "经营分析筛选",
	analyticsExport: "经营分析导出",
};

function AuditRoute() {
	const { organization } = useOrganization();
	const [action, setAction] =
		useState<(typeof actions)[number]["value"]>("all");
	const query = useInfiniteQuery({
		queryKey: ["training-audit", organization.id, action],
		queryFn: ({ pageParam }) =>
			client.training.audit.list({
				action: action === "all" ? undefined : action,
				cursor: pageParam ?? undefined,
				pageSize: 50,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const auditItems = query.data?.pages.flatMap((page) => page.items) ?? [];
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
					<Button onClick={() => void query.refetch()}>重试</Button>
				</Empty>
			) : null}
			{query.data && auditItems.length === 0 ? (
				<Empty className="min-h-56 border">
					<EmptyHeader>
						<EmptyTitle>暂无操作记录</EmptyTitle>
						<EmptyDescription>
							后续关键操作会在这里保留可追溯记录。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{auditItems.length ? (
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
							{auditItems.map((item) => (
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
					{query.hasNextPage ? (
						<div className="flex justify-center border-t p-3">
							<Button
								variant="outline"
								disabled={query.isFetchingNextPage}
								onClick={() => void query.fetchNextPage()}
							>
								{query.isFetchingNextPage ? "正在加载更多" : "加载更多"}
							</Button>
						</div>
					) : null}
				</section>
			) : null}
		</div>
	);
}
