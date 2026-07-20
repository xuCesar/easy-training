import type {
	ClassGroup,
	Classroom,
	ScheduleRule,
} from "@easy-training/api/contracts/training";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

type PreviewCandidate = {
	occurrenceDate: string;
	baselineStartsAt: string;
	startsAt: string;
	endsAt: string;
	room: string;
	roomId: string | null;
	conflicts: Array<"teacher" | "room" | "already_generated">;
	isConflictChecked: boolean;
};

const weekdayLabels = [
	{ value: 1, label: "周一" },
	{ value: 2, label: "周二" },
	{ value: 3, label: "周三" },
	{ value: 4, label: "周四" },
	{ value: 5, label: "周五" },
	{ value: 6, label: "周六" },
	{ value: 7, label: "周日" },
];

export function ScheduleRulesDialog({
	classGroup,
	classrooms,
	onClose,
	onSaved,
}: {
	classGroup: ClassGroup;
	classrooms: Classroom[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [selectedRule, setSelectedRule] = useState<ScheduleRule | null>(null);
	const [candidates, setCandidates] = useState<PreviewCandidate[]>([]);
	const [range, setRange] = useState({
		from: todayInShanghai(),
		to: addDays(todayInShanghai(), 28),
	});
	const [deactivateRule, setDeactivateRule] = useState<ScheduleRule | null>(
		null,
	);
	const [rulePendingDeletion, setRulePendingDeletion] =
		useState<ScheduleRule | null>(null);
	const [editingRule, setEditingRule] = useState<ScheduleRule | null>(null);
	const [futureLessonCount, setFutureLessonCount] = useState<number | null>(
		null,
	);
	const [isCreatingRule, setIsCreatingRule] = useState(false);
	const isCreatingRuleRef = useRef(false);
	const eligibleRooms = classrooms.filter(
		(item) => item.isActive && item.campusId === classGroup.campusId,
	);
	const rulesOptions = orpc.training.teaching.scheduleRules.list.queryOptions({
		input: { classGroupId: classGroup.id },
	});
	const rulesQuery = useQuery(rulesOptions);
	const createMutation = useMutation(
		orpc.training.teaching.scheduleRules.create.mutationOptions(),
	);
	const previewMutation = useMutation(
		orpc.training.teaching.scheduleRules.previewGenerate.mutationOptions(),
	);
	const generateMutation = useMutation(
		orpc.training.teaching.scheduleRules.generate.mutationOptions(),
	);
	const previewDeactivateMutation = useMutation(
		orpc.training.teaching.scheduleRules.previewDeactivate.mutationOptions(),
	);
	const deactivateMutation = useMutation(
		orpc.training.teaching.scheduleRules.deactivate.mutationOptions(),
	);
	const deleteMutation = useMutation(
		orpc.training.teaching.scheduleRules.delete.mutationOptions(),
	);

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: orpc.training.teaching.scheduleRules.list.key(),
			}),
			onSaved(),
		]);
	}

	function createRule(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isCreatingRuleRef.current) return;
		const form = event.currentTarget;
		const data = new FormData(form);
		const startTime = String(data.get("startTime") ?? "");
		const [hour = 0, minute = 0] = startTime.split(":").map(Number);
		const roomId = String(data.get("roomId") ?? "");
		const room = eligibleRooms.find((item) => item.id === roomId);
		if (!room) {
			toast.error("请选择启用中的教室");
			return;
		}
		isCreatingRuleRef.current = true;
		setIsCreatingRule(true);
		void (async () => {
			try {
				await createMutation.mutateAsync({
					classGroupId: classGroup.id,
					data: {
						weekdays: data.getAll("weekday").map(Number),
						startMinuteOfDay: hour * 60 + minute,
						room: room.name,
						roomId: room.id,
						validFrom: String(data.get("validFrom") ?? ""),
						validUntil: String(data.get("validUntil") ?? ""),
					},
				});
				toast.success("周期规则已创建");
				form.reset();
				try {
					await refresh();
				} catch {
					toast.error("规则已创建，但列表刷新失败，请刷新页面后确认。");
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "创建周期规则失败",
				);
			} finally {
				isCreatingRuleRef.current = false;
				setIsCreatingRule(false);
			}
		})();
	}

	function preview(rule: ScheduleRule, nextCandidates = candidates) {
		let overrides: Array<{
			occurrenceDate: string;
			startsAt: string;
			room: string;
			roomId: string;
		}> = [];
		try {
			overrides = nextCandidates.map((item) => {
				if (!item.roomId) throw new Error("ROOM_REQUIRED");
				return {
					occurrenceDate: item.occurrenceDate,
					startsAt: item.startsAt,
					room: item.room,
					roomId: item.roomId,
				};
			});
		} catch {
			toast.error("请选择启用中的教室资源后再检测冲突");
			return;
		}
		void previewMutation
			.mutateAsync({
				ruleId: rule.id,
				...range,
				overrides,
			})
			.then((result) => {
				setSelectedRule(result.rule);
				setCandidates(
					result.candidates.map((candidate) => ({
						...candidate,
						isConflictChecked: true,
					})),
				);
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function generate() {
		if (
			!selectedRule ||
			candidates.some(
				(item) => !item.isConflictChecked || item.conflicts.length > 0,
			)
		) {
			toast.error("请先调节并重新预览，确认所有冲突均已消除");
			return;
		}
		let generatedCandidates: Array<{
			occurrenceDate: string;
			startsAt: string;
			room: string;
			roomId: string;
		}>;
		try {
			generatedCandidates = candidates.map((item) => {
				if (!item.roomId) throw new Error("ROOM_REQUIRED");
				return {
					occurrenceDate: item.occurrenceDate,
					startsAt: item.startsAt,
					room: item.room,
					roomId: item.roomId,
				};
			});
		} catch {
			toast.error("候选课次缺少有效教室，请重新预览");
			return;
		}
		void generateMutation
			.mutateAsync({
				ruleId: selectedRule.id,
				expectedRevision: selectedRule.revision,
				...range,
				requestId: crypto.randomUUID(),
				overrides: [],
				candidates: generatedCandidates,
			})
			.then(async (result) => {
				toast.success(`已生成 ${result.lessonIds.length} 节课次`);
				setCandidates([]);
				setSelectedRule(null);
				await refresh();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function openDeactivate(rule: ScheduleRule) {
		void previewDeactivateMutation
			.mutateAsync({ ruleId: rule.id })
			.then((result) => {
				setDeactivateRule(rule);
				setFutureLessonCount(result.futureLessonIds.length);
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function deactivate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!deactivateRule) return;
		const data = new FormData(event.currentTarget);
		const cancelFuture = data.get("cancelFuture") === "yes";
		void deactivateMutation
			.mutateAsync({
				ruleId: deactivateRule.id,
				expectedRevision: deactivateRule.revision,
				cancelFuture,
				reason: cancelFuture ? String(data.get("reason") ?? "") : null,
				requestId: crypto.randomUUID(),
			})
			.then(async (result) => {
				toast.success(
					result.cancelledLessonIds.length > 0
						? `规则已停用，已取消 ${result.cancelledLessonIds.length} 节未来课次`
						: "规则已停用，已生成的未来课次保持不变",
				);
				setDeactivateRule(null);
				setFutureLessonCount(null);
				await refresh();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	function deleteRule(rule: ScheduleRule) {
		setRulePendingDeletion(rule);
	}

	function confirmDeleteRule() {
		if (!rulePendingDeletion) return;
		void deleteMutation
			.mutateAsync({ ruleId: rulePendingDeletion.id })
			.then(async () => {
				toast.success("周期规则已删除");
				setRulePendingDeletion(null);
				await refresh();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	return (
		<>
			<Dialog
				open
				onOpenChange={(open) =>
					!open &&
					!createMutation.isPending &&
					!previewMutation.isPending &&
					!generateMutation.isPending &&
					!deactivateMutation.isPending &&
					!deleteMutation.isPending &&
					onClose()
				}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle>{classGroup.name} · 周期排课</DialogTitle>
						<DialogDescription>
							先创建每周规则，再预览、调节冲突项并原子生成课次。
						</DialogDescription>
					</DialogHeader>
					<form
						className="grid gap-3 border p-3 md:grid-cols-5"
						onSubmit={createRule}
					>
						<fieldset className="grid gap-1 text-sm md:col-span-2">
							<legend>上课星期</legend>
							<span className="flex flex-wrap gap-2">
								{weekdayLabels.map((item) => (
									<label
										key={item.value}
										className="flex items-center gap-1 text-xs"
									>
										<input type="checkbox" name="weekday" value={item.value} />
										{item.label}
									</label>
								))}
							</span>
						</fieldset>
						<LabeledInput
							label="开始时间"
							name="startTime"
							type="time"
							required
						/>
						<RoomSelectField
							name="roomId"
							rooms={eligibleRooms}
							defaultValue={eligibleRooms[0]?.id ?? ""}
						/>
						<div className="hidden md:block" />
						<LabeledInput
							label="生效日期"
							name="validFrom"
							type="date"
							required
						/>
						<LabeledInput
							label="结束日期"
							name="validUntil"
							type="date"
							required
						/>
						<Button
							type="submit"
							disabled={isCreatingRule || createMutation.isPending}
							className="md:self-end"
						>
							<PlusIcon /> 创建规则
						</Button>
					</form>

					<div className="grid gap-2">
						{rulesQuery.data?.items.map((rule) => (
							<article
								key={rule.id}
								className="flex flex-wrap items-center justify-between gap-3 border p-3"
							>
								<div>
									<p className="font-medium">
										{rule.weekdays
											.map(
												(day) =>
													weekdayLabels.find((item) => item.value === day)
														?.label,
											)
											.join("、")}
										· {minuteLabel(rule.startMinuteOfDay)} · {rule.room}
									</p>
									<p className="text-muted-foreground text-xs">
										{rule.validFrom} 至 {rule.validUntil} · 版本 {rule.revision}
									</p>
								</div>
								<div className="flex gap-2">
									<Badge
										variant={rule.isActive ? "default" : "outline"}
										className="h-7 px-2.5"
									>
										{rule.isActive ? "启用" : "已停用"}
									</Badge>
									{rule.isActive ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => setEditingRule(rule)}
										>
											修改
										</Button>
									) : null}
									{!rule.hasGeneratedLessons ? (
										<Button
											size="sm"
											variant="ghost"
											onClick={() => deleteRule(rule)}
											disabled={deleteMutation.isPending}
										>
											删除
										</Button>
									) : null}
									{rule.isActive ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => preview(rule, [])}
										>
											生成课次
										</Button>
									) : null}
									{rule.isActive ? (
										<Button
											size="sm"
											variant="ghost"
											onClick={() => openDeactivate(rule)}
										>
											停用
										</Button>
									) : null}
								</div>
							</article>
						))}
					</div>

					{selectedRule ? (
						<section className="grid gap-3 border p-3">
							<div className="flex flex-wrap items-end gap-3">
								<LabeledInput
									label="生成自"
									type="date"
									value={range.from}
									onValueChange={(value) => {
										setRange((current) => ({ ...current, from: value }));
										setCandidates([]);
									}}
								/>
								<LabeledInput
									label="生成至"
									type="date"
									value={range.to}
									onValueChange={(value) => {
										setRange((current) => ({ ...current, to: value }));
										setCandidates([]);
									}}
								/>
								<Button
									variant="outline"
									onClick={() => preview(selectedRule)}
									disabled={previewMutation.isPending}
								>
									<RefreshCwIcon /> 重新检测冲突
								</Button>
							</div>
							<div className="grid max-h-80 gap-2 overflow-y-auto">
								{candidates.map((item, index) => (
									<div
										key={item.occurrenceDate}
										className="grid gap-2 border p-2 md:grid-cols-[9rem_1fr_1fr_auto] md:items-end"
									>
										<p className="text-sm">{item.occurrenceDate}</p>
										<LabeledInput
											label="开始时间"
											type="datetime-local"
											value={toLocalInput(item.startsAt)}
											onValueChange={(value) =>
												updateCandidate(setCandidates, index, {
													startsAt: toShanghaiIso(value),
													conflicts: [],
													isConflictChecked: false,
												})
											}
										/>
										<RoomSelectField
											rooms={eligibleRooms}
											value={item.roomId ?? ""}
											fallbackLabel={item.room}
											onValueChange={(roomId) => {
												const room = eligibleRooms.find(
													(value) => value.id === roomId,
												);
												if (room)
													updateCandidate(setCandidates, index, {
														room: room.name,
														roomId,
														conflicts: [],
														isConflictChecked: false,
													});
											}}
										/>
										<div className="flex flex-wrap gap-1">
											{item.conflicts.length === 0 ? (
												<Badge variant="outline">无冲突</Badge>
											) : (
												item.conflicts.map((conflict) => (
													<Badge variant="destructive" key={conflict}>
														{conflictLabel(conflict)}
													</Badge>
												))
											)}
										</div>
									</div>
								))}
							</div>
							<DialogFooter>
								<Button
									onClick={generate}
									disabled={
										generateMutation.isPending ||
										candidates.length === 0 ||
										candidates.some(
											(item) =>
												!item.isConflictChecked || item.conflicts.length > 0,
										)
									}
								>
									{generateMutation.isPending ? (
										<LoaderCircleIcon className="animate-spin" />
									) : null}
									确认生成 {candidates.length} 节课次
								</Button>
							</DialogFooter>
						</section>
					) : null}

					{editingRule ? (
						<ScheduleRuleUpdatePanel
							rule={editingRule}
							rooms={eligibleRooms}
							onClose={() => setEditingRule(null)}
							onSaved={async () => {
								setEditingRule(null);
								await refresh();
							}}
						/>
					) : null}

					{deactivateRule ? (
						<form
							className="grid gap-3 border border-destructive/40 p-3"
							onSubmit={deactivate}
						>
							<p className="font-medium">停用规则</p>
							<p className="text-muted-foreground text-sm">
								检测到 {futureLessonCount ?? 0} 节未来待上课次。请选择处理方式。
							</p>
							<label className="flex gap-2 text-sm">
								<input
									type="radio"
									name="cancelFuture"
									value="no"
									defaultChecked
								/>
								仅停用规则，保留已生成课次
							</label>
							<label className="flex gap-2 text-sm">
								<input type="radio" name="cancelFuture" value="yes" />
								停用并取消全部未来待上课次
							</label>
							<LabeledInput label="取消原因（选择取消时必填）" name="reason" />
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setDeactivateRule(null)}
								>
									返回
								</Button>
								<Button
									type="submit"
									variant="destructive"
									disabled={deactivateMutation.isPending}
								>
									确认停用
								</Button>
							</DialogFooter>
						</form>
					) : null}
				</DialogContent>
			</Dialog>
			<RuleDeletionConfirmationDialog
				rule={rulePendingDeletion}
				pending={deleteMutation.isPending}
				onOpenChange={(open) => !open && setRulePendingDeletion(null)}
				onConfirm={confirmDeleteRule}
			/>
		</>
	);
}

function RuleDeletionConfirmationDialog({
	rule,
	pending,
	onOpenChange,
	onConfirm,
}: {
	rule: ScheduleRule | null;
	pending: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	if (!rule) return null;
	const schedule = `${rule.weekdays
		.map((day) => weekdayLabels.find((item) => item.value === day)?.label)
		.join("、")} · ${minuteLabel(rule.startMinuteOfDay)} · ${rule.room}`;
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>删除周期规则</DialogTitle>
					<DialogDescription>
						确认删除“{schedule}”吗？该操作不可恢复。
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					仅未生成任何课次的规则可以删除；确认时服务端会再次校验。
				</p>
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
						variant="destructive"
						disabled={pending}
						onClick={onConfirm}
					>
						{pending ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : null}
						确认删除
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type RuleUpdatePreviewItem = {
	lessonId: string;
	expectedVersion: number;
	occurrenceDate: string;
	isOverride: boolean;
	preserved: boolean;
	current: { startsAt: string; endsAt: string; room: string };
	proposed: { startsAt: string; endsAt: string; room: string };
	conflicts: PreviewCandidate["conflicts"];
};

function ScheduleRuleUpdatePanel({
	rule,
	rooms,
	onClose,
	onSaved,
}: {
	rule: ScheduleRule;
	rooms: Classroom[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [weekdays, setWeekdays] = useState(rule.weekdays);
	const [startMinuteOfDay, setStartMinuteOfDay] = useState(
		rule.startMinuteOfDay,
	);
	const [room, setRoom] = useState(rule.room);
	const [roomId, setRoomId] = useState(rule.roomId ?? "");
	const [validFrom, setValidFrom] = useState(rule.validFrom);
	const [validUntil, setValidUntil] = useState(rule.validUntil);
	const [effectiveFrom, setEffectiveFrom] = useState(todayInShanghai());
	const [reapplyIds, setReapplyIds] = useState<string[]>([]);
	const [items, setItems] = useState<RuleUpdatePreviewItem[]>([]);
	const previewMutation = useMutation(
		orpc.training.teaching.scheduleRules.previewUpdate.mutationOptions(),
	);
	const updateMutation = useMutation(
		orpc.training.teaching.scheduleRules.update.mutationOptions(),
	);
	const data = {
		weekdays,
		startMinuteOfDay,
		room,
		roomId,
		validFrom,
		validUntil,
	};
	function invalidatePreview() {
		setItems([]);
	}
	function preview() {
		if (!roomId) {
			toast.error("请选择启用中的教室资源");
			return;
		}
		void previewMutation
			.mutateAsync({
				ruleId: rule.id,
				expectedRevision: rule.revision,
				data,
				effectiveFrom,
				reapplyOverrideLessonIds: reapplyIds,
			})
			.then((result) => setItems(result.items))
			.catch((error: Error) => toast.error(error.message));
	}
	function submit() {
		if (items.length === 0 || items.some((item) => item.conflicts.length > 0)) {
			toast.error("请先调整规则并重新预览，消除全部冲突");
			return;
		}
		void updateMutation
			.mutateAsync({
				ruleId: rule.id,
				expectedRevision: rule.revision,
				data,
				effectiveFrom,
				reapplyOverrideLessonIds: reapplyIds,
				requestId: crypto.randomUUID(),
			})
			.then(async (result) => {
				toast.success(`规则已更新，处理 ${result.lessonIds.length} 节未来课次`);
				await onSaved();
			})
			.catch((error: Error) => toast.error(error.message));
	}
	return (
		<section className="grid gap-3 border border-primary/30 p-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="font-medium">修改周期规则</p>
					<p className="text-muted-foreground text-xs">
						指定生效日期；人工例外默认保留，可逐节选择重新套用。
					</p>
				</div>
				<Button size="sm" variant="ghost" onClick={onClose}>
					关闭
				</Button>
			</div>
			<div className="grid gap-3 md:grid-cols-5">
				<fieldset className="grid gap-1 text-sm md:col-span-2">
					<legend>上课星期</legend>
					<span className="flex flex-wrap gap-2">
						{weekdayLabels.map((item) => (
							<label
								key={item.value}
								className="flex items-center gap-1 text-xs"
							>
								<input
									type="checkbox"
									checked={weekdays.includes(item.value)}
									onChange={(event) => {
										setWeekdays((current) =>
											event.target.checked
												? [...current, item.value].sort()
												: current.filter((value) => value !== item.value),
										);
										invalidatePreview();
									}}
								/>
								{item.label}
							</label>
						))}
					</span>
				</fieldset>
				<LabeledInput
					label="开始时间"
					type="time"
					value={minuteLabel(startMinuteOfDay)}
					onValueChange={(value) => {
						const [hour = 0, minute = 0] = value.split(":").map(Number);
						setStartMinuteOfDay(hour * 60 + minute);
						invalidatePreview();
					}}
				/>
				<RoomSelectField
					rooms={rooms}
					value={roomId}
					fallbackLabel={room}
					onValueChange={(nextRoomId) => {
						const nextRoom = rooms.find((item) => item.id === nextRoomId);
						if (!nextRoom) return;
						setRoomId(nextRoomId);
						setRoom(nextRoom.name);
						invalidatePreview();
					}}
				/>
				<LabeledInput
					label="同步生效日期"
					type="date"
					value={effectiveFrom}
					onValueChange={(value) => {
						setEffectiveFrom(value);
						invalidatePreview();
					}}
				/>
				<LabeledInput
					label="规则开始"
					type="date"
					value={validFrom}
					onValueChange={(value) => {
						setValidFrom(value);
						invalidatePreview();
					}}
				/>
				<LabeledInput
					label="规则结束"
					type="date"
					value={validUntil}
					onValueChange={(value) => {
						setValidUntil(value);
						invalidatePreview();
					}}
				/>
				<Button
					variant="outline"
					className="md:self-end"
					onClick={preview}
					disabled={previewMutation.isPending || !roomId}
				>
					<RefreshCwIcon /> 预览影响
				</Button>
			</div>
			{items.length > 0 ? (
				<div className="grid max-h-72 gap-2 overflow-y-auto">
					{items.map((item) => (
						<article
							key={item.lessonId}
							className="grid gap-2 border p-2 md:grid-cols-[8rem_1fr_1fr_auto] md:items-center"
						>
							<p className="text-sm">{item.occurrenceDate}</p>
							<p className="text-muted-foreground text-xs">
								原：{formatShanghai(item.current.startsAt)} /{" "}
								{item.current.room}
							</p>
							<p className="text-xs">
								新：{formatShanghai(item.proposed.startsAt)} /{" "}
								{item.proposed.room}
							</p>
							<div className="flex flex-wrap gap-1">
								{item.isOverride ? (
									<label className="flex items-center gap-1 text-xs">
										<input
											type="checkbox"
											checked={reapplyIds.includes(item.lessonId)}
											onChange={(event) =>
												setReapplyIds((current) =>
													event.target.checked
														? [...current, item.lessonId]
														: current.filter((id) => id !== item.lessonId),
												)
											}
										/>
										重新套用
									</label>
								) : null}
								{item.preserved ? (
									<Badge variant="outline">保留例外</Badge>
								) : null}
								{item.conflicts.map((conflict) => (
									<Badge key={conflict} variant="destructive">
										{conflictLabel(conflict)}
									</Badge>
								))}
							</div>
						</article>
					))}
				</div>
			) : null}
			<DialogFooter>
				<Button
					onClick={submit}
					disabled={
						updateMutation.isPending ||
						items.length === 0 ||
						items.some((item) => item.conflicts.length > 0)
					}
				>
					确认更新规则
				</Button>
			</DialogFooter>
		</section>
	);
}

function LabeledInput({
	label,
	onValueChange,
	...props
}: React.ComponentProps<typeof Input> & {
	label: string;
	onValueChange?: (value: string) => void;
}) {
	return (
		<div className="grid gap-1 text-sm">
			<span>{label}</span>
			<Input
				{...props}
				onChange={
					onValueChange
						? (event) => onValueChange(event.target.value)
						: undefined
				}
			/>
		</div>
	);
}

function RoomSelectField({
	rooms,
	value,
	defaultValue,
	name,
	fallbackLabel,
	onValueChange,
}: {
	rooms: Classroom[];
	value?: string;
	defaultValue?: string;
	name?: string;
	fallbackLabel?: string;
	onValueChange?: (value: string) => void;
}) {
	const selectedRoom = rooms.find(
		(room) => room.id === (value ?? defaultValue),
	);
	return (
		<div className="grid gap-1 text-sm">
			<span>教室</span>
			<Select
				name={name}
				value={value}
				defaultValue={defaultValue}
				onValueChange={(next) => next && onValueChange?.(next)}
			>
				<SelectTrigger>
					<SelectValue
						placeholder={
							fallbackLabel ? `历史教室：${fallbackLabel}` : "选择教室"
						}
					>
						{() =>
							selectedRoom
								? `${selectedRoom.name} · ${selectedRoom.capacity} 人`
								: undefined
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{rooms.map((room) => (
						<SelectItem key={room.id} value={room.id}>
							{room.name} · {room.capacity} 人
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function updateCandidate(
	setter: React.Dispatch<React.SetStateAction<PreviewCandidate[]>>,
	index: number,
	patch: Partial<PreviewCandidate>,
) {
	setter((current) =>
		current.map((item, itemIndex) =>
			itemIndex === index ? { ...item, ...patch } : item,
		),
	);
}

function minuteLabel(value: number) {
	return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function conflictLabel(value: PreviewCandidate["conflicts"][number]) {
	if (value === "teacher") return "教师冲突";
	if (value === "room") return "教室冲突";
	return "该日期已生成";
}

function todayInShanghai() {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

function addDays(value: string, days: number) {
	return new Date(Date.parse(`${value}T12:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

function toLocalInput(value: string) {
	const date = new Date(value);
	const parts = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toShanghaiIso(value: string) {
	return new Date(`${value}:00+08:00`).toISOString();
}

function formatShanghai(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(value));
}
