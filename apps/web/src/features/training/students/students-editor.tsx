import {
	type Campus,
	createStudentInputSchema,
	type StudentStatus,
	type StudentTag,
	updateStudentInputSchema,
} from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { Button } from "@easy-training/ui/components/button";
import { Checkbox } from "@easy-training/ui/components/checkbox";
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
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { Skeleton } from "@easy-training/ui/components/skeleton";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, PlusIcon, UserPlusIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TextField } from "@/features/training/ui/text-field";
import { orpc, queryClient } from "@/utils/orpc";
import { invalidateStudentQueries } from "./students-queries";
import {
	type EditorTarget,
	type StudentFormValues,
	studentStatuses,
} from "./students-types";
import {
	emptyStudentForm,
	isConflictError,
	mergeTags,
	omitCampus,
	toStudentForm,
} from "./students-utils";

export function StudentEditor({
	editor,
	campuses,
	tags,
	onClose,
}: {
	editor: Exclude<EditorTarget, null>;
	campuses: Campus[];
	tags: StudentTag[];
	onClose: () => void;
}) {
	const isEditing = editor !== "new";
	const studentId = isEditing
		? editor.id
		: "00000000-0000-0000-0000-000000000000";
	const detailOptions = orpc.training.students.get.queryOptions({
		input: { id: studentId },
	});
	const detailQuery = useQuery({ ...detailOptions, enabled: isEditing });
	const [values, setValues] = useState<StudentFormValues>(emptyStudentForm);
	const ownerCandidatesQuery = useQuery({
		...orpc.training.students.ownerCandidates.queryOptions({
			input: {
				campusId: values.campusId || "00000000-0000-0000-0000-000000000000",
			},
		}),
		enabled: Boolean(values.campusId),
	});
	const [formError, setFormError] = useState<string | null>(null);
	const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
	const [hasInitializedDraft, setHasInitializedDraft] = useState(false);
	const [hasVersionConflict, setHasVersionConflict] = useState(false);
	const [isRefreshingDetails, setIsRefreshingDetails] = useState(false);
	const duplicateCandidateQueries = useQueries({
		queries: values.contacts.map((contact) => ({
			...orpc.training.students.duplicateCandidates.queryOptions({
				input: {
					phone: contact.phone.trim() || "00000",
					...(isEditing ? { excludeStudentId: studentId } : {}),
				},
			}),
			enabled: contact.phone.trim().length >= 5,
		})),
	});
	const duplicateCandidates = useMemo(
		() =>
			Array.from(
				new Map(
					duplicateCandidateQueries
						.flatMap((query) => query.data?.items ?? [])
						.map((candidate) => [candidate.id, candidate]),
				).values(),
			),
		[duplicateCandidateQueries],
	);
	useEffect(() => {
		if (!hasInitializedDraft && detailQuery.data) {
			setValues(toStudentForm(detailQuery.data));
			setExpectedVersion(detailQuery.data.version);
			setHasInitializedDraft(true);
		}
	}, [detailQuery.data, hasInitializedDraft]);
	const createMutation = useMutation(
		orpc.training.students.create.mutationOptions({
			onSuccess: () => {
				toast.success("学员已新增");
				void invalidateStudentQueries();
				onClose();
			},
			onError: (error) => toast.error(`创建失败：${error.message}`),
		}),
	);
	const updateMutation = useMutation(
		orpc.training.students.update.mutationOptions({
			onSuccess: (updatedStudent) => {
				queryClient.setQueryData(detailOptions.queryKey, updatedStudent);
				toast.success("学员档案已更新");
				void invalidateStudentQueries();
				onClose();
			},
			onError: (error) => {
				if (isConflictError(error)) {
					setHasVersionConflict(true);
					setFormError(
						"当前资料已被其他人更新。请刷新最新资料后检查草稿，再次保存。",
					);
					return;
				}
				toast.error(`保存失败：${error.message}`);
			},
		}),
	);
	const pending =
		createMutation.isPending || updateMutation.isPending || isRefreshingDetails;
	const activeCampuses = campuses.filter((campus) => campus.isActive);
	const availableTags = mergeTags(tags, detailQuery.data?.tags ?? []);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalized = {
			...values,
			birthDate: values.birthDate || null,
			contacts: values.contacts.map((contact) => ({
				...contact,
				relationship: contact.relationship.trim() || null,
			})),
		};
		if (isEditing) {
			if (!expectedVersion) {
				setFormError("未能获取资料版本，请刷新页面后重试。");
				return;
			}
			const parsed = updateStudentInputSchema.safeParse({
				id: studentId,
				expectedVersion,
				data: omitCampus(normalized),
			});
			if (!parsed.success) {
				setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
				return;
			}
			setFormError(null);
			updateMutation.mutate(parsed.data);
			return;
		}
		const parsed = createStudentInputSchema.safeParse(normalized);
		if (!parsed.success) {
			setFormError(parsed.error.issues[0]?.message ?? "请检查表单信息。");
			return;
		}
		setFormError(null);
		createMutation.mutate(parsed.data);
	}

	async function refreshLatestDetails() {
		setIsRefreshingDetails(true);
		try {
			const result = await detailQuery.refetch();
			if (result.isSuccess && result.data) {
				setExpectedVersion(result.data.version);
				setHasVersionConflict(false);
				setFormError(null);
				toast.success("已刷新最新资料版本，当前草稿未改动。");
				return;
			}
			setFormError("无法刷新最新资料，请稍后重试。");
		} finally {
			setIsRefreshingDetails(false);
		}
	}

	const detailLoading =
		isEditing && detailQuery.isPending && !hasInitializedDraft;
	const detailError = isEditing && detailQuery.isError && !hasInitializedDraft;
	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{isEditing ? "编辑学员档案" : "新增学员"}</DialogTitle>
					<DialogDescription>
						{isEditing
							? "校区归属创建后不可直接修改。"
							: "请填写基础资料并指定一位主要联系人。"}
					</DialogDescription>
				</DialogHeader>
				{detailLoading ? (
					<div className="space-y-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-32 w-full" />
					</div>
				) : detailError ? (
					<div className="flex flex-col gap-3">
						<p className="text-destructive text-sm">
							无法加载学员详情：{detailQuery.error.message}
						</p>
						<Button
							className="self-start"
							variant="outline"
							onClick={() => void detailQuery.refetch()}
						>
							重试
						</Button>
					</div>
				) : (
					<form className="flex flex-col gap-5" onSubmit={submit} noValidate>
						<div className="grid gap-4 sm:grid-cols-2">
							<TextField
								id="student-name"
								label="学员姓名"
								value={values.name}
								onChange={(name) =>
									setValues((current) => ({ ...current, name }))
								}
								required
							/>
							<Field>
								<FieldLabel htmlFor="student-campus">所属校区</FieldLabel>
								{isEditing ? (
									<Input
										id="student-campus"
										readOnly
										value={editor.campusName}
									/>
								) : (
									<Select
										value={values.campusId}
										onValueChange={(campusId) =>
											campusId &&
											setValues((current) => ({
												...current,
												campusId,
												ownerUserId: null,
											}))
										}
									>
										<SelectTrigger id="student-campus">
											<SelectValue>
												{() =>
													activeCampuses.find(
														(campus) => campus.id === values.campusId,
													)?.name ?? "选择校区"
												}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{activeCampuses.map((campus) => (
													<SelectItem key={campus.id} value={campus.id}>
														{campus.name}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								)}
							</Field>
							<Field>
								<FieldLabel htmlFor="student-owner">运营负责人</FieldLabel>
								<Select
									value={values.ownerUserId ?? "unassigned"}
									onValueChange={(ownerUserId) =>
										ownerUserId &&
										setValues((current) => ({
											...current,
											ownerUserId:
												ownerUserId === "unassigned" ? null : ownerUserId,
										}))
									}
									disabled={!values.campusId || ownerCandidatesQuery.isPending}
								>
									<SelectTrigger id="student-owner">
										<SelectValue>
											{() =>
												ownerCandidatesQuery.data?.items.find(
													(item) => item.userId === values.ownerUserId,
												)?.name ?? "未分配"
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											<SelectItem value="unassigned">未分配</SelectItem>
											{(ownerCandidatesQuery.data?.items ?? []).map((owner) => (
												<SelectItem key={owner.userId} value={owner.userId}>
													{owner.name} · {owner.email}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								{ownerCandidatesQuery.isError ? (
									<FieldError>负责人列表加载失败，请稍后重试。</FieldError>
								) : null}
							</Field>
							<TextField
								id="student-birth-date"
								label="出生日期"
								type="date"
								value={values.birthDate}
								onChange={(birthDate) =>
									setValues((current) => ({ ...current, birthDate }))
								}
							/>
							<Field>
								<FieldLabel htmlFor="student-status">学员状态</FieldLabel>
								<Select
									value={values.status}
									onValueChange={(status) =>
										status &&
										setValues((current) => ({
											...current,
											status: status as StudentStatus,
										}))
									}
								>
									<SelectTrigger id="student-status">
										<SelectValue>
											{() =>
												studentStatuses.find(
													(item) => item.value === values.status,
												)?.label
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{studentStatuses.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						</div>
						<ContactsEditor
							contacts={values.contacts}
							duplicateCandidates={duplicateCandidates}
							isCheckingDuplicates={duplicateCandidateQueries.some(
								(query) => query.isFetching,
							)}
							onChange={(contacts) =>
								setValues((current) => ({ ...current, contacts }))
							}
						/>
						<TagSelector
							tags={availableTags}
							selectedIds={values.tagIds}
							onChange={(tagIds) =>
								setValues((current) => ({ ...current, tagIds }))
							}
						/>
						{hasVersionConflict ? (
							<div
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-3"
								role="alert"
							>
								<p className="text-destructive text-sm">
									资料已被其他人更新，当前填写内容已保留。
								</p>
								<Button
									type="button"
									variant="outline"
									disabled={pending}
									onClick={() => void refreshLatestDetails()}
								>
									{isRefreshingDetails ? (
										<LoaderCircleIcon
											className="animate-spin"
											data-icon="inline-start"
										/>
									) : null}
									刷新最新资料
								</Button>
							</div>
						) : null}
						{formError ? <FieldError match>{formError}</FieldError> : null}
						<DialogFooter className="flex-col-reverse sm:flex-row">
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={onClose}
							>
								取消
							</Button>
							<Button type="submit" disabled={pending}>
								{pending ? (
									<LoaderCircleIcon
										className="animate-spin"
										data-icon="inline-start"
									/>
								) : (
									<UserPlusIcon data-icon="inline-start" />
								)}
								{isEditing ? "保存" : "创建学员"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ContactsEditor({
	contacts,
	duplicateCandidates,
	isCheckingDuplicates,
	onChange,
}: {
	contacts: StudentFormValues["contacts"];
	duplicateCandidates: Array<{
		id: string;
		name: string;
		campusName: string;
		phoneMasked: string;
	}>;
	isCheckingDuplicates: boolean;
	onChange: (contacts: StudentFormValues["contacts"]) => void;
}) {
	function update(
		index: number,
		patch: Partial<StudentFormValues["contacts"][number]>,
	) {
		onChange(
			contacts.map((contact, currentIndex) =>
				currentIndex === index ? { ...contact, ...patch } : contact,
			),
		);
	}
	return (
		<section className="space-y-3" aria-labelledby="contacts-heading">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 id="contacts-heading" className="font-medium text-sm">
						联系人
					</h2>
					<p className="text-muted-foreground text-xs">
						至少一位，且必须指定一位主要联系人。
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={contacts.length >= 10}
					onClick={() =>
						onChange([
							...contacts,
							{ name: "", phone: "", relationship: "", isPrimary: false },
						])
					}
				>
					<PlusIcon data-icon="inline-start" />
					添加联系人
				</Button>
			</div>
			<div className="space-y-3">
				{contacts.map((contact, index) => (
					<div
						key={contact.id ?? `new-${index}`}
						className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
					>
						<TextField
							id={`contact-name-${index}`}
							label="姓名"
							required
							value={contact.name}
							onChange={(name) => update(index, { name })}
						/>
						<TextField
							id={`contact-phone-${index}`}
							label="手机号"
							type="tel"
							required
							value={contact.phone}
							onChange={(phone) => update(index, { phone })}
						/>
						<TextField
							id={`contact-relationship-${index}`}
							label="关系称谓（可选）"
							value={contact.relationship}
							onChange={(relationship) => update(index, { relationship })}
						/>
						<div className="flex flex-wrap items-end justify-between gap-3">
							<label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
								<input
									type="radio"
									name="primary-contact"
									checked={contact.isPrimary}
									onChange={() =>
										onChange(
											contacts.map((item, currentIndex) => ({
												...item,
												isPrimary: currentIndex === index,
											})),
										)
									}
								/>
								主要联系人
							</label>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={contacts.length === 1}
								onClick={() => {
									const remaining = contacts.filter(
										(_, currentIndex) => currentIndex !== index,
									);
									const nextPrimary = remaining[0];
									if (contact.isPrimary && nextPrimary)
										remaining[0] = { ...nextPrimary, isPrimary: true };
									onChange(remaining);
								}}
							>
								删除
							</Button>
						</div>
					</div>
				))}
			</div>
			{isCheckingDuplicates ? (
				<p className="text-muted-foreground text-xs">正在检查疑似重复档案…</p>
			) : duplicateCandidates.length > 0 ? (
				<div className="border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
					<p className="font-medium">发现疑似重复学员</p>
					<p className="mt-1 text-muted-foreground text-xs">
						匹配仅基于同机构的标准化手机号，不会阻止保存；请确认是否应使用已有档案。
					</p>
					<ul className="mt-2 grid gap-1 text-xs">
						{duplicateCandidates.map((candidate) => (
							<li key={candidate.id}>
								{candidate.name} · {candidate.campusName} ·{" "}
								{candidate.phoneMasked}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function TagSelector({
	tags,
	selectedIds,
	onChange,
}: {
	tags: StudentTag[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}) {
	return (
		<fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
			<legend className="font-medium text-sm">运营标签</legend>
			<div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
				{tags.length ? (
					tags.map((tag) => {
						const checked = selectedIds.includes(tag.id);
						return (
							<label
								key={tag.id}
								htmlFor={`student-tag-${tag.id}`}
								className="flex w-fit cursor-pointer items-center gap-2 text-sm"
							>
								<Checkbox
									id={`student-tag-${tag.id}`}
									checked={checked}
									disabled={!tag.isActive && !checked}
									onCheckedChange={(next) =>
										onChange(
											next
												? [...selectedIds, tag.id]
												: selectedIds.filter((id) => id !== tag.id),
										)
									}
								/>
								<span>{tag.name}</span>
								{!tag.isActive ? (
									<Badge variant="secondary">已停用</Badge>
								) : null}
							</label>
						);
					})
				) : (
					<p className="text-muted-foreground text-sm">暂无可选标签。</p>
				)}
			</div>
			<p className="mt-2 text-muted-foreground text-xs">
				已停用标签会保留在历史档案中，不能新增分配。
			</p>
		</fieldset>
	);
}
