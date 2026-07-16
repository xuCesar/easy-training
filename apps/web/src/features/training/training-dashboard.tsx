import type { TrainingSnapshot } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { buttonVariants } from "@easy-training/ui/components/button";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CalendarDaysIcon,
	CircleDollarSignIcon,
} from "lucide-react";

import { formatCurrency, formatDateTime } from "./format";

interface TrainingDashboardProps {
	snapshot: TrainingSnapshot;
}

export function TrainingDashboard({ snapshot }: TrainingDashboardProps) {
	const followUps = snapshot.leads
		.filter((lead) => lead.stage !== "enrolled" && lead.stage !== "lost")
		.slice(0, 5);
	const pendingInvoices = snapshot.invoices.filter(
		(invoice) => invoice.status === "pending" || invoice.status === "overdue",
	);
	const dueAmount = pendingInvoices.reduce(
		(total, invoice) => total + invoice.amount - invoice.paidAmount,
		0,
	);
	return (
		<div className="flex flex-col gap-6">
			<section>
				<p className="text-muted-foreground text-sm">运营工作台</p>
				<h1 className="mt-1 font-semibold text-2xl">今日工作概览</h1>
			</section>
			<section
				className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4"
				aria-label="关键数据"
			>
				<Metric
					label="待跟进线索"
					value={`${followUps.length}`}
					helper="需要安排下一步动作"
				/>
				<Metric
					label="今日待办"
					value={`${snapshot.tasks.length}`}
					helper="招生、教务、财务待处理"
				/>
				<Metric
					label="近期课程"
					value={`${snapshot.lessons.length}`}
					helper="已排课的课程安排"
				/>
				<Metric
					label="待收款"
					value={formatCurrency(dueAmount)}
					helper={`${pendingInvoices.length} 笔待处理账单`}
				/>
			</section>
			<div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
				<section className="border">
					<SectionHeader
						title="今日待办"
						description="按优先级处理，避免遗漏关键动作"
					/>
					<div className="divide-y">
						{snapshot.tasks.slice(0, 5).map((task) => (
							<div className="flex items-center gap-3 px-4 py-3" key={task.id}>
								<Badge
									variant={
										task.priority === "high" ? "destructive" : "secondary"
									}
								>
									{task.priority === "high" ? "高优" : "待办"}
								</Badge>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{task.title}</p>
									<p className="mt-0.5 text-muted-foreground text-xs">
										{task.module} · {task.owner}
									</p>
								</div>
								<span className="text-muted-foreground text-xs">
									{formatDateTime(task.dueAt)}
								</span>
							</div>
						))}
					</div>
				</section>
				<section className="border">
					<SectionHeader
						title="需跟进线索"
						description="优先处理未完成转化的咨询"
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
					<div className="divide-y">
						{followUps.map((lead) => (
							<div className="flex items-center gap-3 px-4 py-3" key={lead.id}>
								<div className="grid size-8 place-items-center rounded-full bg-muted font-medium text-xs">
									{lead.name.slice(0, 1)}
								</div>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-sm">{lead.name}</p>
									<p className="truncate text-muted-foreground text-xs">
										{lead.interestedCourse}
									</p>
								</div>
								<span className="text-muted-foreground text-xs">
									{formatDateTime(lead.nextFollowAt)}
								</span>
							</div>
						))}
					</div>
				</section>
			</div>
			<div className="grid gap-6 lg:grid-cols-2">
				<section className="border">
					<SectionHeader title="近期课程" description="接下来需要准备的课程" />
					<div className="divide-y">
						{snapshot.lessons.slice(0, 4).map((lesson) => (
							<div
								className="flex items-center gap-3 px-4 py-3"
								key={lesson.id}
							>
								<CalendarDaysIcon className="size-4 text-muted-foreground" />
								<div>
									<p className="font-medium text-sm">{lesson.room} 教室课程</p>
									<p className="text-muted-foreground text-xs">
										{formatDateTime(lesson.startsAt)}
									</p>
								</div>
							</div>
						))}
					</div>
				</section>
				<section className="border">
					<SectionHeader title="待收款" description="关注逾期和待处理账单" />
					<div className="divide-y">
						{pendingInvoices.slice(0, 4).map((invoice) => (
							<div
								className="flex items-center gap-3 px-4 py-3"
								key={invoice.id}
							>
								<CircleDollarSignIcon className="size-4 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<p className="font-medium text-sm">
										{formatCurrency(invoice.amount - invoice.paidAmount)}
									</p>
									<p className="text-muted-foreground text-xs">
										到期日 {invoice.dueDate}
									</p>
								</div>
								<Badge
									variant={
										invoice.status === "overdue" ? "destructive" : "secondary"
									}
								>
									{invoice.status === "overdue" ? "已逾期" : "待收款"}
								</Badge>
							</div>
						))}
					</div>
				</section>
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
		<div className="bg-background p-4">
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-3 font-semibold text-2xl tabular-nums">{value}</p>
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
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-4 px-4 py-4">
			<div>
				<h2 className="font-semibold text-sm">{title}</h2>
				<p className="mt-1 text-muted-foreground text-xs">{description}</p>
			</div>
			{action}
		</div>
	);
}
