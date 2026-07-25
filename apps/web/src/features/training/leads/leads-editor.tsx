import {
	type CreateLeadInput,
	createLeadInputSchema,
	type LeadRecord,
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
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { TextField } from "@/features/training/ui/text-field";
import { orpc } from "@/utils/orpc";
import { DateTimeField } from "./leads-datetime-field";
import { invalidateLeadQueries } from "./leads-queries";
import {
	initialStageOptions,
	type LeadFormErrors,
	type LeadFormValues,
} from "./leads-types";
import { getStageLabel, toApiDateTime, toFieldErrors } from "./leads-utils";

export function LeadEditor({
	lead,
	onOpenChange,
}: {
	lead: LeadRecord | null | "new";
	onOpenChange: (open: boolean) => void;
}) {
	const isEditing = lead !== null && lead !== "new";
	const [requestId] = useState(() => crypto.randomUUID());
	const [values, setValues] = useState<LeadFormValues>(() =>
		isEditing
			? {
					name: lead.name,
					phone: lead.phone,
					source: lead.source,
					stage: "new",
					nextFollowAt: null,
					note: lead.note || null,
				}
			: {
					name: "",
					phone: "",
					source: "",
					stage: "new",
					nextFollowAt: null,
					note: null,
				},
	);
	const [errors, setErrors] = useState<LeadFormErrors>({});
	const createMutation = useMutation(
		orpc.training.leads.create.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.replayed ? "已确认创建，未重复新增" : "线索已新增",
				);
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`创建结果尚未确认：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.leads.update.mutationOptions({
			onSuccess: () => {
				toast.success("线索资料已更新");
				void invalidateLeadQueries();
				onOpenChange(false);
			},
			onError: (error) => toast.error(`保存失败：${error.message}`),
		}),
	);
	const pending = createMutation.isPending || updateMutation.isPending;

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = createLeadInputSchema.safeParse({
			...values,
			requestId,
			campusId: null,
			interestedCourseId: null,
			nextFollowAt: toApiDateTime(values.nextFollowAt),
			note: values.note || null,
		});
		if (!parsed.success) {
			setErrors(toFieldErrors(parsed.error.issues, values));
			toast.error("请检查表单中的必填项和格式");
			return;
		}

		setErrors({});
		if (isEditing) {
			updateMutation.mutate({
				id: lead.id,
				data: {
					name: parsed.data.name,
					phone: parsed.data.phone,
					source: parsed.data.source,
					note: parsed.data.note,
				},
			});
		} else {
			createMutation.mutate(parsed.data);
		}
	}

	return (
		<Dialog open={lead !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{isEditing ? "编辑线索资料" : "新增线索"}</DialogTitle>
					<DialogDescription>
						填写可用于后续招生跟进的基础信息。
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField
							id="lead-name"
							name="name"
							label="姓名"
							value={values.name}
							onChange={(name) =>
								setValues((current) => ({ ...current, name }))
							}
							error={errors.name}
							required
							maxLength={50}
						/>
						<TextField
							id="lead-phone"
							name="phone"
							label="电话"
							value={values.phone}
							onChange={(phone) =>
								setValues((current) => ({ ...current, phone }))
							}
							error={errors.phone}
							type="tel"
							required
							minLength={5}
							maxLength={30}
						/>
					</div>
					<TextField
						id="lead-source"
						name="source"
						label="来源"
						value={values.source}
						onChange={(source) =>
							setValues((current) => ({ ...current, source }))
						}
						error={errors.source}
						required
						maxLength={50}
					/>
					{!isEditing ? (
						<>
							<Field name="stage" invalid={Boolean(errors.stage)}>
								<FieldLabel htmlFor="lead-stage">初始阶段</FieldLabel>
								<Select
									value={values.stage}
									onValueChange={(stage) =>
										stage &&
										setValues((current) => ({
											...current,
											stage: stage as CreateLeadInput["stage"],
										}))
									}
								>
									<SelectTrigger
										id="lead-stage"
										className="w-full"
										aria-invalid={Boolean(errors.stage)}
									>
										<SelectValue>
											{() => getStageLabel(values.stage)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{initialStageOptions.map((item) => (
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
						</>
					) : null}
					<Field name="note" invalid={Boolean(errors.note)}>
						<FieldLabel htmlFor="lead-note">线索摘要</FieldLabel>
						<Textarea
							id="lead-note"
							name="note"
							aria-invalid={Boolean(errors.note)}
							maxLength={1000}
							value={values.note ?? ""}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									note: event.target.value,
								}))
							}
							placeholder="记录基础诉求或来源说明"
						/>
						<FieldError match={Boolean(errors.note)}>{errors.note}</FieldError>
					</Field>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={pending}
						>
							取消
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : null}
							{isEditing ? "保存" : pending ? "正在创建" : "创建"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
