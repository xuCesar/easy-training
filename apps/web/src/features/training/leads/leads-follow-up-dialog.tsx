import {
	addLeadFollowUpInputSchema,
	type LeadRecord,
	type LeadRecordStage,
} from "@easy-training/api/contracts/training";
import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Textarea } from "@easy-training/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardPlusIcon, LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { orpc, queryClient } from "@/utils/orpc";
import { DateTimeField } from "./leads-datetime-field";
import { LeadHistory } from "./leads-history";
import { invalidateLeadQueries } from "./leads-queries";
import {
	type FollowUpErrors,
	type FollowUpValues,
	followUpStageOptions,
} from "./leads-types";
import { getStageLabel, toApiDateTime, toFieldErrors } from "./leads-utils";

export function LeadFollowUpDialog({
	lead,
	onClose,
}: {
	lead: LeadRecord;
	onClose: () => void;
}) {
	const historyQuery = useQuery(
		orpc.training.leads.history.queryOptions({ input: { leadId: lead.id } }),
	);
	const [values, setValues] = useState<FollowUpValues>({
		content: "",
		stage: lead.stage,
		nextFollowAt: lead.nextFollowAt,
		lostReason: null,
	});
	const [errors, setErrors] = useState<FollowUpErrors>({});
	const mutation = useMutation(
		orpc.training.leads.followUp.mutationOptions({
			onSuccess: () => {
				toast.success("跟进已记录");
				void invalidateLeadQueries();
				void queryClient.invalidateQueries({
					queryKey: orpc.training.leads.history.key(),
				});
				onClose();
			},
			onError: (error) => toast.error(`跟进保存失败：${error.message}`),
		}),
	);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = addLeadFollowUpInputSchema.safeParse({
			leadId: lead.id,
			content: values.content,
			stage: values.stage,
			nextFollowAt: toApiDateTime(values.nextFollowAt),
			lostReason: values.lostReason || null,
		});
		if (!parsed.success) {
			setErrors(toFieldErrors(parsed.error.issues, values));
			toast.error("请补充本次跟进信息");
			return;
		}
		setErrors({});
		mutation.mutate(parsed.data);
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>跟进 {lead.name}</DialogTitle>
					<DialogDescription>
						每次保存都会留下不可编辑的跟进记录。
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
					<Field name="content" invalid={Boolean(errors.content)}>
						<FieldLabel htmlFor="follow-up-content">本次跟进</FieldLabel>
						<Textarea
							id="follow-up-content"
							value={values.content}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									content: event.target.value,
								}))
							}
							maxLength={1000}
							aria-invalid={Boolean(errors.content)}
							placeholder="记录沟通内容、家长反馈和下一步安排"
						/>
						<FieldError match={Boolean(errors.content)}>
							{errors.content}
						</FieldError>
					</Field>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field name="stage" invalid={Boolean(errors.stage)}>
							<FieldLabel htmlFor="follow-up-stage">当前阶段</FieldLabel>
							<Select
								value={values.stage}
								onValueChange={(stage) =>
									stage &&
									setValues((current) => ({
										...current,
										stage: stage as LeadRecordStage,
										lostReason: stage === "lost" ? current.lostReason : null,
									}))
								}
							>
								<SelectTrigger
									id="follow-up-stage"
									aria-invalid={Boolean(errors.stage)}
								>
									<SelectValue>{() => getStageLabel(values.stage)}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{followUpStageOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<FieldError match={Boolean(errors.stage)}>
								{errors.stage}
							</FieldError>
						</Field>
						<DateTimeField
							label="下次跟进"
							value={values.nextFollowAt}
							onChange={(value) =>
								setValues((current) => ({
									...current,
									nextFollowAt: value || null,
								}))
							}
							error={errors.nextFollowAt}
						/>
					</div>
					{values.stage === "lost" ? (
						<Field name="lostReason" invalid={Boolean(errors.lostReason)}>
							<FieldLabel htmlFor="lost-reason">失单原因</FieldLabel>
							<Textarea
								id="lost-reason"
								value={values.lostReason ?? ""}
								onChange={(event) =>
									setValues((current) => ({
										...current,
										lostReason: event.target.value,
									}))
								}
								maxLength={500}
								aria-invalid={Boolean(errors.lostReason)}
								required
							/>
							<FieldError match={Boolean(errors.lostReason)}>
								{errors.lostReason}
							</FieldError>
						</Field>
					) : null}
					<LeadHistory
						history={historyQuery.data?.items ?? []}
						isPending={historyQuery.isPending}
						isError={historyQuery.isError}
						onRetry={() => historyQuery.refetch()}
					/>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={mutation.isPending}
						>
							取消
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<ClipboardPlusIcon data-icon="inline-start" />
							)}
							保存跟进
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
