import type { Campus, Classroom } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import {
	LoaderCircleIcon,
	PencilIcon,
	PlusIcon,
	PowerIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { formatDateTime } from "./format";

export function RoomsPanel({
	campuses,
	rooms,
	isPending,
	isError,
	onRetry,
	onSaved,
}: {
	campuses: Campus[];
	rooms: Classroom[];
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [campusId, setCampusId] = useState<string>("all");
	const [editor, setEditor] = useState<Classroom | "create" | null>(null);
	const [activeTarget, setActiveTarget] = useState<Classroom | null>(null);
	const visibleRooms = rooms.filter(
		(room) => campusId === "all" || room.campusId === campusId,
	);

	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-end justify-between gap-2 border p-3">
				<div className="grid min-w-0 gap-1 text-sm sm:min-w-48">
					<span>校区</span>
					<Select
						value={campusId}
						onValueChange={(value) => value && setCampusId(value)}
					>
						<SelectTrigger>
							<SelectValue>
								{() =>
									campusId === "all"
										? "全部校区"
										: (campuses.find((campus) => campus.id === campusId)
												?.name ?? "选择校区")
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">全部校区</SelectItem>
							{campuses.map((campus) => (
								<SelectItem key={campus.id} value={campus.id}>
									{campus.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Button onClick={() => setEditor("create")}>
					<PlusIcon /> 新建教室
				</Button>
			</div>
			{isPending ? (
				<div className="grid gap-2">
					{[1, 2, 3].map((item) => (
						<Skeleton key={item} className="h-20" />
					))}
				</div>
			) : isError ? (
				<div className="grid place-items-center gap-3 border py-12 text-center">
					<p className="text-muted-foreground text-sm">教室列表加载失败</p>
					<Button variant="outline" onClick={onRetry}>
						重试
					</Button>
				</div>
			) : visibleRooms.length === 0 ? (
				<div className="grid place-items-center gap-2 border py-12 text-center">
					<p className="font-medium">还没有教室</p>
					<p className="px-4 text-muted-foreground text-sm">
						先为校区建立教室资源，再用于排课、调课和补课。
					</p>
				</div>
			) : (
				<div className="grid gap-2">
					{visibleRooms.map((room) => (
						<article
							key={room.id}
							className="grid gap-3 border p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(8rem,1fr)_auto_auto] sm:items-center"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{room.name}</p>
								<p className="truncate text-muted-foreground text-xs">
									{campuses.find((campus) => campus.id === room.campusId)
										?.name ?? "未知校区"}
								</p>
							</div>
							<p className="text-sm">
								<span className="text-muted-foreground">容量</span>{" "}
								{room.capacity} 人
							</p>
							<Badge variant={room.isActive ? "default" : "outline"}>
								{room.isActive ? "启用" : "停用"}
							</Badge>
							<div className="flex flex-wrap gap-1 sm:justify-end">
								<Button
									size="sm"
									variant="outline"
									onClick={() => setEditor(room)}
								>
									<PencilIcon /> 编辑
								</Button>
								<Button
									size="sm"
									variant={room.isActive ? "destructive" : "outline"}
									onClick={() => setActiveTarget(room)}
								>
									<PowerIcon /> {room.isActive ? "停用" : "启用"}
								</Button>
							</div>
						</article>
					))}
				</div>
			)}
			{editor ? (
				<RoomEditorDialog
					room={editor === "create" ? null : editor}
					campuses={campuses}
					onClose={() => setEditor(null)}
					onSaved={onSaved}
				/>
			) : null}
			{activeTarget ? (
				<RoomActiveConfirmationDialog
					room={activeTarget}
					onClose={() => setActiveTarget(null)}
					onSaved={onSaved}
				/>
			) : null}
		</div>
	);
}

function RoomEditorDialog({
	room,
	campuses,
	onClose,
	onSaved,
}: {
	room: Classroom | null;
	campuses: Campus[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const createMutation = useMutation(
		orpc.training.teaching.classrooms.create.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.classrooms.update.mutationOptions(),
	);
	const [campusId, setCampusId] = useState(campuses[0]?.id ?? "");
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const name = String(data.get("name") ?? "").trim();
		const capacity = Number(data.get("capacity"));
		const request = room
			? updateMutation.mutateAsync({ id: room.id, data: { name, capacity } })
			: createMutation.mutateAsync({
					campusId: String(data.get("campusId") ?? ""),
					name,
					capacity,
				});
		void request
			.then(async () => {
				toast.success(room ? "教室已更新" : "教室已创建");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => showAffectedLessonError(error));
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{room ? "编辑教室" : "新建教室"}</DialogTitle>
					<DialogDescription>
						教室名称在同一校区内不可重复，容量会用于排课硬校验。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-3" onSubmit={submit}>
					{room ? null : (
						<div className="grid gap-1 text-sm">
							<span>校区</span>
							<Select
								name="campusId"
								value={campusId}
								onValueChange={(value) => value && setCampusId(value)}
							>
								<SelectTrigger>
									<SelectValue placeholder="选择校区">
										{() =>
											campuses.find((campus) => campus.id === campusId)?.name ??
											"选择校区"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{campuses.map((campus) => (
										<SelectItem key={campus.id} value={campus.id}>
											{campus.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<div className="grid gap-1 text-sm">
						<label htmlFor="classroom-name">教室名称</label>
						<Input
							id="classroom-name"
							name="name"
							defaultValue={room?.name}
							maxLength={100}
							required
						/>
					</div>
					<div className="grid gap-1 text-sm">
						<label htmlFor="classroom-capacity">容量</label>
						<Input
							id="classroom-capacity"
							name="capacity"
							type="number"
							min={1}
							max={10000}
							defaultValue={room?.capacity ?? 20}
							required
						/>
					</div>
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							取消
						</Button>
						<Button type="submit" disabled={pending || campuses.length === 0}>
							{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
							保存教室
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RoomActiveConfirmationDialog({
	room,
	onClose,
	onSaved,
}: {
	room: Classroom;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const mutation = useMutation(
		orpc.training.teaching.classrooms.setActive.mutationOptions(),
	);
	function confirm() {
		void mutation
			.mutateAsync({ id: room.id, isActive: !room.isActive })
			.then(async () => {
				toast.success(room.isActive ? "教室已停用" : "教室已启用");
				await onSaved();
				onClose();
			})
			.catch((error: Error) => showAffectedLessonError(error));
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !mutation.isPending && onClose()}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{room.isActive ? "停用教室" : "启用教室"}</DialogTitle>
					<DialogDescription>
						确认{room.isActive ? "停用" : "启用"}“{room.name}”吗？
					</DialogDescription>
				</DialogHeader>
				{room.isActive ? (
					<p className="text-muted-foreground text-sm">
						若教室仍有未来待上课次，系统会阻止停用并提示先调课或取消课次。
					</p>
				) : null}
				<DialogFooter className="flex-col-reverse sm:flex-row">
					<Button
						variant="outline"
						disabled={mutation.isPending}
						onClick={onClose}
					>
						取消
					</Button>
					<Button
						variant={room.isActive ? "destructive" : "default"}
						disabled={mutation.isPending}
						onClick={confirm}
					>
						{mutation.isPending ? (
							<LoaderCircleIcon className="animate-spin" />
						) : null}
						确认{room.isActive ? "停用" : "启用"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type AffectedLesson = {
	className: string;
	startsAt: string;
	roomName: string;
	occupancy?: number;
	capacity?: number;
};

function showAffectedLessonError(error: Error) {
	const affectedLessons = getAffectedLessons(error);
	toast.error(error.message, {
		description: affectedLessons.length
			? `${affectedLessons
					.slice(0, 2)
					.map(
						(item) =>
							`${item.className} · ${formatDateTime(item.startsAt)} · ${item.roomName}${item.occupancy !== undefined ? `（${item.occupancy}/${item.capacity} 人）` : ""}`,
					)
					.join("；")}。请前往课次管理调课或取消。`
			: undefined,
	});
}

function getAffectedLessons(error: unknown): AffectedLesson[] {
	if (!error || typeof error !== "object") return [];
	const data = (error as { data?: unknown }).data;
	if (!data || typeof data !== "object") return [];
	const values = (data as { affectedLessons?: unknown }).affectedLessons;
	if (!Array.isArray(values)) return [];
	return values.filter((value): value is AffectedLesson =>
		Boolean(
			value &&
				typeof value === "object" &&
				typeof (value as AffectedLesson).className === "string" &&
				typeof (value as AffectedLesson).startsAt === "string" &&
				typeof (value as AffectedLesson).roomName === "string",
		),
	);
}
