import type {
	StudentListResult,
	StudentTimelineResult,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button, buttonVariants } from "@easy-training/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "@easy-training/ui/components/sheet";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	HistoryIcon,
	LoaderCircleIcon,
	XIcon,
} from "lucide-react";

import { client } from "@/utils/orpc";
import { formatCentsToCurrency, formatDateTime } from "./format";

type StudentSummary = StudentListResult["items"][number];
type TimelineItem = StudentTimelineResult["items"][number];

const eventTitles: Record<TimelineItem["kind"], string> = {
	enrollment_created: "创建报名",
	enrollment_lifecycle: "报名状态变更",
	invoice_issued: "开立账单",
	payment_received: "登记收款",
	enrollment_renewed: "报名续费",
	enrollment_transferred: "课程转课",
	refund_created: "登记退款",
	attendance_recorded: "记录考勤",
	lesson_consumed: "课时消耗",
	student_status_changed: "学员状态变更",
};

const statusLabels: Record<string, string> = {
	active: "在读",
	trial: "试听",
	paused: "暂停",
	graduated: "已归档",
	at_risk: "需关注",
	atRisk: "需关注",
	frozen: "冻结",
	transferred: "已转课",
	class_assigned: "已入班",
	class_transferred: "已转班",
	class_withdrawn: "已退班",
	resumed: "已复课",
	present: "到课",
	absent: "缺勤",
	late: "迟到",
	leave: "请假",
	pending: "待收款",
	partial: "部分收款",
	paid: "已结清",
	refunded: "已退款",
	cash: "现金",
	wechat: "微信",
	alipay: "支付宝",
	bank_transfer: "银行转账",
	pos: "POS",
	other: "其他",
};

function labelStatus(value: string | null): string | null {
	if (!value) return null;
	return statusLabels[value] ?? value;
}

function describeEvent(item: TimelineItem): string {
	const course = item.courseName ?? "未命名课程";
	const invoiceSubject =
		item.invoiceSource === "manual"
			? (item.invoiceSummary ?? "手工账单")
			: (item.courseName ?? item.invoiceSummary ?? "账单");
	const invoiceSource =
		item.invoiceSource === "manual"
			? "手工开单"
			: item.invoiceSource === "renewal"
				? "续费开单"
				: "报名开单";
	const className = item.className ? ` · ${item.className}` : "";
	switch (item.kind) {
		case "enrollment_created":
			return `${course}${item.lessonCount === null ? "" : ` · ${item.lessonCount} 课时`}`;
		case "enrollment_lifecycle":
			return `${course}${className} · ${labelStatus(item.status) ?? "状态变更"}`;
		case "invoice_issued":
			return `${invoiceSource} · ${invoiceSubject}${item.amountInCents === null ? "" : ` · ${formatCentsToCurrency(item.amountInCents)}`}`;
		case "payment_received":
			return `${invoiceSubject} · ${item.amountInCents === null ? "" : formatCentsToCurrency(item.amountInCents)}${labelStatus(item.status) ? ` · ${labelStatus(item.status)}` : ""}`;
		case "enrollment_renewed":
			return `${course}${item.lessonCount === null ? "" : ` · 增加 ${item.lessonCount} 课时`}`;
		case "enrollment_transferred":
			return `${course}${item.lessonCount === null ? "" : ` · 转移 ${item.lessonCount} 课时`}`;
		case "refund_created":
			return `${invoiceSubject} · ${item.amountInCents === null ? "" : formatCentsToCurrency(item.amountInCents)}`;
		case "attendance_recorded":
			return `${course}${className} · ${labelStatus(item.status) ?? "已登记"}`;
		case "lesson_consumed":
			return `${course}${className}${item.previousRemainingLessons === null || item.remainingLessons === null ? "" : ` · 剩余 ${item.previousRemainingLessons} → ${item.remainingLessons} 课时`}`;
		case "student_status_changed":
			return `${labelStatus(item.beforeStatus) ?? "未知"} → ${labelStatus(item.afterStatus) ?? "未知"}`;
	}
}

function SourceLink({ item }: { item: TimelineItem }) {
	if (item.source.type === "invoice") {
		return (
			<Link
				to="/finance"
				search={{ invoiceId: item.source.invoiceId }}
				className={buttonVariants({ size: "sm", variant: "ghost" })}
			>
				查看账单
				<ArrowRightIcon data-icon="inline-end" />
			</Link>
		);
	}
	if (item.source.type === "lesson") {
		return (
			<Link
				to="/academic"
				search={{ tab: "lessons", lessonId: item.source.lessonId }}
				className={buttonVariants({ size: "sm", variant: "ghost" })}
			>
				查看课次
				<ArrowRightIcon data-icon="inline-end" />
			</Link>
		);
	}
	return null;
}

export function StudentTimelineSheet({
	student,
	organizationId,
	sessionUserId,
	onClose,
}: {
	student: StudentSummary;
	organizationId: string;
	sessionUserId?: string;
	onClose: () => void;
}) {
	const timelineQuery = useInfiniteQuery({
		queryKey: ["student-timeline", organizationId, sessionUserId, student.id],
		queryFn: ({ pageParam }) =>
			client.training.students.timeline({
				studentId: student.id,
				cursor: pageParam ?? undefined,
				pageSize: 20,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const items = timelineQuery.data?.pages.flatMap((page) => page.items) ?? [];

	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side="right"
				className="w-full max-w-2xl overflow-y-auto border-r-0 border-l p-0 sm:w-[min(42rem,94vw)]"
			>
				<header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-popover px-4 py-4 sm:px-5">
					<div className="min-w-0">
						<SheetTitle>{student.name}的业务时间线</SheetTitle>
						<p className="mt-1 text-muted-foreground text-xs">
							按业务发生时间倒序，历史事实不会被状态变更覆盖。
						</p>
					</div>
					<SheetClose
						render={
							<Button variant="ghost" size="icon-sm" aria-label="关闭时间线" />
						}
					>
						<XIcon data-icon="inline" />
					</SheetClose>
				</header>

				<div className="p-4 sm:p-5">
					{timelineQuery.isPending ? (
						<div className="space-y-3">
							<Skeleton className="h-28 w-full" />
							<Skeleton className="h-28 w-full" />
							<Skeleton className="h-28 w-full" />
						</div>
					) : timelineQuery.isError ? (
						<Empty className="min-h-72 border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HistoryIcon />
								</EmptyMedia>
								<EmptyTitle>时间线加载失败</EmptyTitle>
								<EmptyDescription>
									暂时无法读取该学员的业务记录，请重试。
								</EmptyDescription>
							</EmptyHeader>
							<Button onClick={() => void timelineQuery.refetch()}>重试</Button>
						</Empty>
					) : items.length === 0 ? (
						<Empty className="min-h-72 border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HistoryIcon />
								</EmptyMedia>
								<EmptyTitle>暂无业务记录</EmptyTitle>
								<EmptyDescription>
									报名、收款、上课或状态变更后会在这里显示。
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="space-y-3">
							{items.map((item) => (
								<article key={item.id} className="border p-4">
									<div className="flex flex-wrap items-start justify-between gap-2">
										<div>
											<div className="flex flex-wrap items-center gap-2">
												<p className="font-medium">{eventTitles[item.kind]}</p>
												<Badge variant="outline">
													{formatDateTime(item.occurredAt)}
												</Badge>
											</div>
											<p className="mt-2 text-sm">{describeEvent(item)}</p>
										</div>
										<SourceLink item={item} />
									</div>
									<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-muted-foreground text-xs">
										<span>操作人：{item.actorName ?? "历史记录未登记"}</span>
										{item.recordedAt &&
										Math.abs(
											new Date(item.recordedAt).getTime() -
												new Date(item.occurredAt).getTime(),
										) > 1000 ? (
											<span>实际登记：{formatDateTime(item.recordedAt)}</span>
										) : null}
									</div>
								</article>
							))}
							{timelineQuery.hasNextPage ? (
								<Button
									className="w-full"
									variant="outline"
									disabled={timelineQuery.isFetchingNextPage}
									onClick={() => void timelineQuery.fetchNextPage()}
								>
									{timelineQuery.isFetchingNextPage ? (
										<LoaderCircleIcon className="animate-spin" />
									) : null}
									加载更多
								</Button>
							) : null}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
