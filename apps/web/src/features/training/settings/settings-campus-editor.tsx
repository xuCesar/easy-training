import {
	type CreateCampusInput,
	createCampusInputSchema,
	type UpdateCampusInput,
	updateCampusInputSchema,
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
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { CampusField } from "./settings-form-fields";
import type { Campus, CampusFormValues } from "./settings-types";
import {
	showMutationError,
	toCampusInput,
	toCampusValues,
	toFormErrors,
} from "./settings-utils";

export function CampusEditor({
	campus,
	open,
	onOpenChange,
	onChanged,
}: {
	campus: Campus | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => Promise<void>;
}) {
	const [values, setValues] = useState<CampusFormValues>(() =>
		toCampusValues(campus),
	);
	const [errors, setErrors] = useState<
		Partial<Record<keyof CampusFormValues, string>>
	>({});
	useEffect(() => {
		if (open) {
			setValues(toCampusValues(campus));
			setErrors({});
		}
	}, [campus, open]);
	const createMutation = useMutation({
		...orpc.training.campuses.create.mutationOptions(),
		onSuccess: async () => {
			toast.success("校区已创建");
			await onChanged();
		},
		onError: showMutationError,
	});
	const updateMutation = useMutation({
		...orpc.training.campuses.update.mutationOptions(),
		onSuccess: async () => {
			toast.success("校区已更新");
			await onChanged();
		},
		onError: showMutationError,
	});
	const pending = createMutation.isPending || updateMutation.isPending;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = campus
			? updateCampusInputSchema.safeParse({
					id: campus.id,
					data: toCampusInput(values),
				})
			: createCampusInputSchema.safeParse(toCampusInput(values));
		if (!data.success) {
			setErrors(toFormErrors(data.error.issues));
			toast.error("请检查校区信息");
			return;
		}
		setErrors({});
		if (campus) updateMutation.mutate(data.data as UpdateCampusInput);
		else createMutation.mutate(data.data as CreateCampusInput);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{campus ? "编辑校区" : "新建校区"}</DialogTitle>
					<DialogDescription>
						编码在当前机构内唯一；停用请使用校区卡片中的操作。
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit} noValidate>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="校区名称"
							name="name"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="校区编码"
							name="code"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="城市"
							name="city"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="地址"
							name="address"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<CampusField
							label="教室数"
							name="roomCount"
							type="number"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
						<CampusField
							label="容纳人数"
							name="capacity"
							type="number"
							values={values}
							setValues={setValues}
							errors={errors}
						/>
					</div>
					<DialogFooter className="flex-col-reverse sm:flex-row">
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={() => onOpenChange(false)}
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
							{campus ? "保存" : "创建校区"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
