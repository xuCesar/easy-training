import { Badge } from "@easy-training/ui/components/badge";
import { Checkbox } from "@easy-training/ui/components/checkbox";
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
import type { Dispatch, SetStateAction } from "react";
import type {
	AccessMode,
	Campus,
	CampusFormValues,
	Invitation,
	Role,
} from "./settings-types";
import { roleOptions } from "./settings-types";
import { isActiveInvitation, roleLabel } from "./settings-utils";

export function RoleField({
	value,
	onChange,
	allowOwner,
}: {
	value: Role;
	onChange: (role: Role) => void;
	allowOwner: boolean;
}) {
	return (
		<Field>
			<FieldLabel>机构角色</FieldLabel>
			<Select
				value={value}
				onValueChange={(next) => next && onChange(next as Role)}
			>
				<SelectTrigger className="w-full" aria-label="选择机构角色">
					<SelectValue>{() => roleLabel(value)}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{roleOptions
							.filter((option) => allowOwner || option.value !== "owner")
							.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}
export function ScopeFields({
	className,
	mode,
	campusIds,
	campuses,
	disabled = false,
	onModeChange,
	onCampusIdsChange,
}: {
	className?: string;
	mode: AccessMode;
	campusIds: string[];
	campuses: Campus[];
	disabled?: boolean;
	onModeChange: (mode: AccessMode) => void;
	onCampusIdsChange: (ids: string[]) => void;
}) {
	return (
		<Field className={className}>
			<FieldLabel>校区访问范围</FieldLabel>
			<Select
				value={mode}
				disabled={disabled}
				onValueChange={(next) => next && onModeChange(next as AccessMode)}
			>
				<SelectTrigger className="w-full" aria-label="选择校区访问范围">
					<SelectValue>
						{() => (mode === "all" ? "全部校区" : "指定校区")}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value="all">全部校区</SelectItem>
						<SelectItem value="selected">指定校区</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
			{mode === "selected" && !disabled ? (
				<div className="mt-3 grid gap-2 rounded-md border p-3">
					{campuses.length === 0 ? (
						<p className="text-muted-foreground text-sm">暂无校区可分配。</p>
					) : (
						campuses.map((campus) => {
							const checked = campusIds.includes(campus.id);
							const id = `scope-campus-${campus.id}`;
							return (
								<label
									key={campus.id}
									htmlFor={id}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<Checkbox
										id={id}
										checked={checked}
										onCheckedChange={(next) =>
											onCampusIdsChange(
												next
													? [...campusIds, campus.id]
													: campusIds.filter((id) => id !== campus.id),
											)
										}
									/>
									<span>{campus.name}</span>
									{!campus.isActive ? (
										<Badge variant="secondary">已停用</Badge>
									) : null}
								</label>
							);
						})
					)}
				</div>
			) : (
				<p className="mt-2 text-muted-foreground text-xs">
					{disabled
						? "该角色固定拥有全部校区访问权限。"
						: "可访问当前机构的全部校区。"}
				</p>
			)}
		</Field>
	);
}
export function CampusField({
	label,
	name,
	type = "text",
	values,
	setValues,
	errors,
}: {
	label: string;
	name: keyof CampusFormValues;
	type?: "text" | "number";
	values: CampusFormValues;
	setValues: Dispatch<SetStateAction<CampusFormValues>>;
	errors: Partial<Record<keyof CampusFormValues, string>>;
}) {
	const id = `campus-${name}`;
	return (
		<Field invalid={Boolean(errors[name])}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type={type}
				min={type === "number" ? 0 : undefined}
				required
				value={values[name]}
				onChange={(event) =>
					setValues((current) => ({ ...current, [name]: event.target.value }))
				}
				aria-invalid={Boolean(errors[name])}
			/>
			<FieldError match={Boolean(errors[name])}>{errors[name]}</FieldError>
		</Field>
	);
}
export function InvitationStatus({ invitation }: { invitation: Invitation }) {
	if (invitation.claimedAt) return <Badge variant="secondary">已领取</Badge>;
	if (invitation.revokedAt) return <Badge variant="secondary">已撤销</Badge>;
	if (!isActiveInvitation(invitation))
		return <Badge variant="secondary">已过期</Badge>;
	return <Badge>待领取</Badge>;
}
