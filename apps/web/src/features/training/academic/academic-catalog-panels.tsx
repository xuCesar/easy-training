import type { Course, Teacher } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { PencilIcon, PowerIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	DataCell,
	PanelState,
	StatusBadge,
} from "../academic-workspace-shared";
import { formatCentsToCurrency } from "../format";
import { invalidateAcademicQueries } from "./academic-workspace-queries";
import { categoryLabels } from "./academic-workspace-types";

function CoursePowerButton({ course }: { course: Course }) {
	const mutation = useMutation(
		orpc.training.teaching.courses.setActive.mutationOptions({
			onSuccess: () => {
				toast.success(course.isActive ? "课程已停用" : "课程已启用");
				void invalidateAcademicQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			disabled={mutation.isPending}
			aria-label={course.isActive ? `停用${course.name}` : `启用${course.name}`}
			onClick={() =>
				mutation.mutate({ id: course.id, isActive: !course.isActive })
			}
		>
			<PowerIcon />
		</Button>
	);
}

export function CoursesPanel({
	courses,
	highlightedCourseId,
	canManage,
	isPending,
	isError,
	onCreate,
	onEdit,
	onRetry,
}: {
	courses: Course[];
	highlightedCourseId?: string;
	canManage: boolean;
	isPending: boolean;
	isError: boolean;
	onCreate?: () => void;
	onEdit: (item: Course) => void;
	onRetry: () => void;
}) {
	return (
		<PanelState
			pending={isPending}
			error={isError}
			empty={courses.length === 0}
			emptyTitle="还没有课程产品"
			emptyDescription="课程是开班与报名的基础，请先建立课程目录。"
			onRetry={onRetry}
			onCreate={onCreate}
		>
			<div className="grid gap-2">
				{courses.map((item) => (
					<article
						key={item.id}
						id={`courses-${item.id}`}
						className={`grid scroll-mt-20 gap-3 border p-3 md:grid-cols-[minmax(14rem,1.4fr)_repeat(3,minmax(0,1fr))_auto] md:items-center ${highlightedCourseId === item.id ? "ring-2 ring-primary" : ""}`}
					>
						<div className="min-w-0">
							<p className="truncate font-medium">{item.name}</p>
							<p className="truncate text-muted-foreground text-xs">
								{item.code} · {categoryLabels[item.category]} · {item.level}
							</p>
						</div>
						<DataCell
							label="课包"
							value={`${item.lessonsPerPackage} 课次 / ${item.durationMinutes} 分钟`}
						/>
						<DataCell
							label="标准价"
							value={formatCentsToCurrency(item.listPriceInCents)}
						/>
						<div>
							<StatusBadge status={item.isActive ? "active" : "inactive"} />
							<p className="mt-1 truncate text-muted-foreground text-xs">
								{item.tags.join(" · ") || "无标签"}
							</p>
						</div>
						{canManage ? (
							<div className="flex gap-1">
								<Button
									size="icon-sm"
									variant="ghost"
									aria-label={`编辑${item.name}`}
									onClick={() => onEdit(item)}
								>
									<PencilIcon />
								</Button>
								<CoursePowerButton course={item} />
							</div>
						) : null}
					</article>
				))}
			</div>
		</PanelState>
	);
}

export function TeachersPanel({
	teachers,
	campuses,
	isPending,
	isError,
	onCreate,
	onEdit,
	onRetry,
}: {
	teachers: Teacher[];
	campuses: Array<{ id: string; name: string }>;
	isPending: boolean;
	isError: boolean;
	onCreate: () => void;
	onEdit: (item: Teacher) => void;
	onRetry: () => void;
}) {
	const campusNames = new Map(campuses.map((item) => [item.id, item.name]));
	return (
		<PanelState
			pending={isPending}
			error={isError}
			empty={teachers.length === 0}
			emptyTitle="还没有教师档案"
			emptyDescription="为教师分配可授课校区后，才能在班级中选择主讲教师。"
			onRetry={onRetry}
			onCreate={onCreate}
		>
			<div className="grid gap-2">
				{teachers.map((item) => (
					<article
						key={item.id}
						className="grid gap-3 border p-3 md:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(0,1fr))_auto] md:items-center"
					>
						<div>
							<p className="font-medium">{item.name}</p>
							<p className="text-muted-foreground text-xs">
								{item.phone ?? "未登记手机号"}
							</p>
						</div>
						<DataCell label="科目" value={item.subjects.join(" · ")} />
						<DataCell
							label="周容量"
							value={`${item.weeklyCapacityHours} 小时`}
						/>
						<DataCell
							label="授课校区"
							value={item.campusIds
								.map((id) => campusNames.get(id) ?? "已移除校区")
								.join(" · ")}
						/>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label={`编辑${item.name}`}
							onClick={() => onEdit(item)}
						>
							<PencilIcon />
						</Button>
					</article>
				))}
			</div>
		</PanelState>
	);
}
