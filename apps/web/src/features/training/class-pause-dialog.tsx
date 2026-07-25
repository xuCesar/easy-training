import type { ClassGroup } from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

export function ClassPauseDialog({
	classGroup,
	action,
	onClose,
	onSaved,
}: {
	classGroup: ClassGroup;
	action: "pause" | "resume";
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [futureLessonPolicy, setFutureLessonPolicy] = useState<
		"keep" | "cancel"
	>("keep");
	const requestId = useRef(crypto.randomUUID());
	const pauseMutation = useMutation(
		orpc.training.teaching.classes.pause.mutationOptions(),
	);
	const resumeMutation = useMutation(
		orpc.training.teaching.classes.resume.mutationOptions(),
	);
	const pending = pauseMutation.isPending || resumeMutation.isPending;

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const reason = String(
			new FormData(event.currentTarget).get("reason") ?? "",
		).trim();
		if (!reason) {
			toast.error(`${action === "pause" ? "停课" : "复课"}原因不能为空`);
			return;
		}
		const request =
			action === "pause"
				? pauseMutation.mutateAsync({
						id: classGroup.id,
						reason,
						futureLessonPolicy,
						requestId: requestId.current,
					})
				: resumeMutation.mutateAsync({
						id: classGroup.id,
						reason,
						requestId: requestId.current,
					});

		void request
			.then(async () => {
				if (action === "pause") {
					toast.success(
						futureLessonPolicy === "cancel"
							? "班级已停课，未来待上课次已按提交时状态批量取消"
							: "班级已停课，未来课次保持不变",
					);
				} else {
					toast.success("班级已复课，已取消课次不会自动恢复");
				}
				await onSaved();
				onClose();
			})
			.catch((error: Error) => toast.error(error.message));
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{classGroup.name} · {action === "pause" ? "停课" : "复课"}
					</DialogTitle>
					<DialogDescription>
						{action === "pause"
							? "停课后将禁止排课、调课、点名和结课；周期规则会保留。"
							: "复课只恢复班级可操作状态，不会恢复已取消课次或自动补排。"}
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					{action === "pause" ? (
						<fieldset className="grid gap-2">
							<legend className="font-medium text-sm">未来待上课次</legend>
							<label className="flex gap-2 border p-3 text-sm">
								<input
									type="radio"
									name="futureLessonPolicy"
									value="keep"
									checked={futureLessonPolicy === "keep"}
									onChange={() => setFutureLessonPolicy("keep")}
								/>
								<span>
									<span className="block font-medium">保留未来课次</span>
									<span className="text-muted-foreground text-xs">
										课次时间与教室保持不变，复课后可继续处理。
									</span>
								</span>
							</label>
							<label className="flex gap-2 border p-3 text-sm">
								<input
									type="radio"
									name="futureLessonPolicy"
									value="cancel"
									checked={futureLessonPolicy === "cancel"}
									onChange={() => setFutureLessonPolicy("cancel")}
								/>
								<span>
									<span className="block font-medium">取消未来课次</span>
									<span className="text-muted-foreground text-xs">
										原子取消所有尚未开始的待上课次，历史课次不受影响。
									</span>
								</span>
							</label>
						</fieldset>
					) : null}
					<div className="grid gap-1 text-sm">
						<label htmlFor="class-status-reason">
							{action === "pause" ? "停课原因" : "复课原因"}
						</label>
						<Textarea
							id="class-status-reason"
							name="reason"
							maxLength={500}
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
						<Button
							type="submit"
							variant={action === "pause" ? "destructive" : "default"}
							disabled={pending}
						>
							{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
							确认{action === "pause" ? "停课" : "复课"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
