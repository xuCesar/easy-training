import type { DashboardSnapshot } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { buttonVariants } from "@easy-training/ui/components/button";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CalendarDaysIcon,
	CheckCheckIcon,
	CircleDollarSignIcon,
	ClipboardCheckIcon,
	type LucideIcon,
	UserRoundSearchIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatCentsToCurrency, formatDate, formatDateTime } from "./format";

interface TrainingDashboardProps {
	snapshot: DashboardSnapshot;
}

const taskModuleLabels: Record<
	DashboardSnapshot["tasks"][number]["module"],
	string
> = {
	enrollment: "招生",
	academic: "教务",
	finance: "财务",
	student_service: "学员服务",
};

const leadStageLabels: Record<
	DashboardSnapshot["followUps"][number]["stage"],
	string
> = {
	new: "新线索",
	contacted: "已联系",
	trialBooked: "已约试听",
};

export function TrainingDashboard({ snapshot }: TrainingDashboardProps) {
	const { metrics, permissions } = snapshot;

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<section>
				<p className="text-muted-foreground text-sm">运营工作台</p>
				<div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					<h1 className="font-semibold text-2xl">今日工作概览</h1>
					<p className="text-muted-foreground text-xs">
						数据截至 {formatDateTime(snapshot.asOf)}
					</p>
				</div>
			</section>

			<section
				className="grid min-w-0 gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
				aria-label="关键数据"
			>
				{permissions.canViewLeads ? (
					<Metric
						label="待跟进线索"
						value={formatMetricCount(metrics.followUpCount)}
						helper="当前仍需推进的咨询线索"
					/>
				) : null}
				<Metric
					label="学员档案"
					value={`${metrics.studentCount}`}
					helper="机构内已建立的学员档案"
				/>
				<Metric
					label="报名记录"
					value={`${metrics.enrollmentCount}`}
					helper="机构内累计创建的报名记录"
				/>
				<Metric
					label="活跃班级"
					value={`${metrics.activeClassCount}`}
					helper="招生中和进行中的班级"
				/>
				<Metric
					label="今日待办"
					value={`${metrics.dueTaskCount}`}
					helper="包含今日到期和历史逾期"
				/>
				<Metric
					label="近期课程"
					value={`${metrics.upcomingLessonCount}`}
					helper="接下来需要准备的课程"
				/>
				{permissions.canViewFinance ? (
					<Metric
						label="待收金额"
						value={formatNullableAmount(metrics.outstandingAmountInCents)}
						helper={formatInvoiceCount(metrics.pendingInvoiceCount)}
					/>
				) : null}
			</section>

			<div className="grid min-w-0 gap-6 lg:grid-cols-2">
				<section className="min-w-0 border">
					<SectionHeader
						title="今日待办"
						description="按优先级处理，避免遗漏关键动作"
						action={
							<Link
								to="/tasks"
								className={buttonVariants({ variant: "ghost", size: "sm" })}
							>
								管理任务
								<ArrowRightIcon data-icon="inline-end" />
							</Link>
						}
					/>
					{snapshot.tasks.length > 0 ? (
						<div className="divide-y">
							{snapshot.tasks.map((task) => (
								<div
									className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
									key={task.id}
								>
									<Badge
										variant={
											task.priority === "high" ? "destructive" : "secondary"
										}
									>
										{formatPriority(task.priority)}
									</Badge>
									<div className="min-w-0">
										<p className="break-words font-medium text-sm">
											{task.title}
										</p>
										<p className="mt-0.5 break-words text-muted-foreground text-xs">
											{taskModuleLabels[task.module]} ·{" "}
											{task.owner ?? "暂未分配"}
										</p>
									</div>
									<span className="col-start-2 text-muted-foreground text-xs tabular-nums sm:col-start-3 sm:row-start-1 sm:whitespace-nowrap">
										{formatDateTime(task.dueAt)}
									</span>
								</div>
							))}
						</div>
					) : (
						<EmptyState
							icon={CheckCheckIcon}
							title="今日待办已处理完毕"
							description="当前没有需要立即处理的运营任务。"
						/>
					)}
				</section>

				{permissions.canViewLeads ? (
					<section className="min-w-0 border">
						<SectionHeader
							title="需跟进线索"
							description="优先推进临近跟进时间的咨询"
							action={
								<Link
									to="/leads"
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									查看全部
									<ArrowRightIcon data-icon="inline-end" />
								</Link>
							}
						/>
						{snapshot.followUps.length > 0 ? (
							<div className="divide-y">
								{snapshot.followUps.map((lead) => (
									<div
										className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
										key={lead.id}
									>
										<div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-medium text-xs">
											{lead.name.slice(0, 1)}
										</div>
										<div className="min-w-0">
											<p className="break-words font-medium text-sm">
												{lead.name}
											</p>
											<p className="mt-0.5 break-words text-muted-foreground text-xs">
												{leadStageLabels[lead.stage]} ·{" "}
												{lead.interestedCourse ?? "意向课程待确认"}
											</p>
										</div>
										<span className="col-start-2 text-muted-foreground text-xs tabular-nums sm:col-start-3 sm:row-start-1 sm:whitespace-nowrap">
											{lead.nextFollowAt
												? formatDateTime(lead.nextFollowAt)
												: "待安排跟进"}
										</span>
									</div>
								))}
							</div>
						) : (
							<EmptyState
								icon={UserRoundSearchIcon}
								title="暂无需跟进线索"
								description="当前没有进入待跟进队列的咨询线索。"
								action={
									<Link
										to="/leads"
										className={buttonVariants({
											variant: "outline",
											size: "sm",
										})}
									>
										前往线索管理
									</Link>
								}
							/>
						)}
					</section>
				) : null}

				<section className="min-w-0 border">
					<SectionHeader
						title="近期课程"
						description="查看即将开始的课程安排"
					/>
					{snapshot.upcomingLessons.length > 0 ? (
						<div className="divide-y">
							{snapshot.upcomingLessons.map((lesson) => (
								<div
									className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
									key={lesson.id}
								>
									<CalendarDaysIcon className="mt-0.5 size-4 text-muted-foreground" />
									<div className="min-w-0">
										<p className="break-words font-medium text-sm">
											{lesson.className} · {lesson.courseName}
										</p>
										<p className="mt-0.5 break-words text-muted-foreground text-xs">
											{lesson.campusName} · {lesson.teacherName} · {lesson.room}
										</p>
									</div>
									<span className="col-start-2 text-muted-foreground text-xs tabular-nums sm:col-start-3 sm:row-start-1 sm:whitespace-nowrap">
										{formatLessonTime(lesson.startsAt, lesson.endsAt)}
									</span>
								</div>
							))}
						</div>
					) : (
						<EmptyState
							icon={CalendarDaysIcon}
							title="近期暂无课程"
							description="当前时间窗口内没有需要准备的课程安排。"
						/>
					)}
				</section>

				{permissions.canViewFinance ? (
					<section className="min-w-0 border">
						<SectionHeader
							title="待收款"
							description="优先关注逾期与临近到期账单"
							action={
								<Link
									to="/finance"
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									查看全部
									<ArrowRightIcon data-icon="inline-end" />
								</Link>
							}
						/>
						{snapshot.receivables.length > 0 ? (
							<div className="divide-y">
								{snapshot.receivables.map((receivable) => (
									<div
										className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
										key={receivable.id}
									>
										<CircleDollarSignIcon className="mt-0.5 size-4 text-muted-foreground" />
										<div className="min-w-0">
											<p className="break-words font-medium text-sm">
												{receivable.studentName}
											</p>
											<p className="mt-0.5 break-words text-muted-foreground text-xs">
												{receivable.source === "manual"
													? receivable.summary
													: (receivable.courseName ?? receivable.summary)}{" "}
												· 到期日 {formatDate(receivable.dueDate)}
											</p>
										</div>
										<div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:flex-nowrap sm:justify-end">
											<span className="font-medium text-sm tabular-nums sm:whitespace-nowrap">
												{formatCentsToCurrency(
													receivable.outstandingAmountInCents,
												)}
											</span>
											<Badge
												variant={
													receivable.status === "overdue"
														? "destructive"
														: "secondary"
												}
											>
												{receivable.status === "overdue" ? "已逾期" : "待收款"}
											</Badge>
										</div>
									</div>
								))}
							</div>
						) : (
							<EmptyState
								icon={ClipboardCheckIcon}
								title="暂无待收款项"
								description="当前没有逾期或待处理的应收账单。"
							/>
						)}
					</section>
				) : null}
			</div>
		</div>
	);
}

function Metric({
	label,
	value,
	helper,
}: {
	label: string;
	value: string;
	helper: string;
}) {
	return (
		<div className="min-w-0 bg-background p-4">
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-3 break-words font-semibold text-2xl tabular-nums">
				{value}
			</p>
			<p className="mt-2 text-muted-foreground text-xs">{helper}</p>
		</div>
	);
}

function SectionHeader({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-start justify-between gap-3 px-4 py-4">
			<div className="min-w-0">
				<h2 className="font-semibold text-sm">{title}</h2>
				<p className="mt-1 break-words text-muted-foreground text-xs">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}

function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-h-40 flex-col items-center justify-center border-t px-4 py-8 text-center">
			<Icon className="size-5 text-muted-foreground" aria-hidden="true" />
			<p className="mt-3 font-medium text-sm">{title}</p>
			<p className="mt-1 max-w-sm text-muted-foreground text-xs">
				{description}
			</p>
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	);
}

function formatMetricCount(value: number | null): string {
	return value === null ? "—" : `${value}`;
}

function formatNullableAmount(valueInCents: number | null): string {
	return valueInCents === null ? "—" : formatCentsToCurrency(valueInCents);
}

function formatInvoiceCount(value: number | null): string {
	return value === null ? "应收数据暂不可用" : `${value} 笔待处理账单`;
}

function formatPriority(
	priority: DashboardSnapshot["tasks"][number]["priority"],
): string {
	if (priority === "high") return "高优";
	if (priority === "medium") return "中优";
	return "低优";
}

function formatLessonTime(startsAt: string, endsAt: string): string {
	const endTime = new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(endsAt));
	return `${formatDateTime(startsAt)}–${endTime}`;
}
