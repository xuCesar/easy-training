import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Field, FieldLabel } from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";
import { type ReactNode, useState } from "react";
import { formatDateTime } from "../format";

export function getAffectedLessons(error: unknown): Array<{
	className: string;
	startsAt: string;
	roomName: string;
	occupancy: number;
	capacity: number;
}> {
	if (!error || typeof error !== "object") return [];
	const data = (error as { data?: unknown }).data;
	if (!data || typeof data !== "object") return [];
	const values = (data as { affectedLessons?: unknown }).affectedLessons;
	if (!Array.isArray(values)) return [];
	return values.filter(
		(
			value,
		): value is {
			className: string;
			startsAt: string;
			roomName: string;
			occupancy: number;
			capacity: number;
		} =>
			Boolean(
				value &&
					typeof value === "object" &&
					typeof (value as { className?: unknown }).className === "string" &&
					typeof (value as { startsAt?: unknown }).startsAt === "string" &&
					typeof (value as { roomName?: unknown }).roomName === "string" &&
					typeof (value as { occupancy?: unknown }).occupancy === "number" &&
					typeof (value as { capacity?: unknown }).capacity === "number",
			),
	);
}

export function formatAffectedLessonsDescription(
	error: unknown,
): string | undefined {
	const affectedLessons = getAffectedLessons(error);
	if (affectedLessons.length === 0) return undefined;
	return `${affectedLessons
		.slice(0, 2)
		.map(
			(lesson) =>
				`${lesson.className} · ${formatDateTime(lesson.startsAt)} · ${lesson.roomName}（${lesson.occupancy}/${lesson.capacity} 人）`,
		)
		.join("；")}。请先到课次管理调课或取消。`;
}

export function EditorDialog({
	title,
	description,
	pending,
	onClose,
	children,
}: {
	title: string;
	description: string;
	pending: boolean;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	);
}

export function TextField({
	label,
	name,
	defaultValue,
	type = "text",
	required,
	step,
	placeholder,
}: {
	label: string;
	name: string;
	defaultValue?: string | number;
	type?: string;
	required?: boolean;
	step?: string;
	placeholder?: string;
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Input
				name={name}
				type={type}
				defaultValue={defaultValue}
				required={required}
				step={step}
				placeholder={placeholder}
			/>
		</Field>
	);
}

export function SelectField({
	label,
	name,
	defaultValue,
	items,
	onValueChange,
	disabled,
}: {
	label: string;
	name: string;
	defaultValue: string;
	items: Array<{ value: string; label: string }>;
	onValueChange?: (value: string) => void;
	disabled?: boolean;
}) {
	const [value, setValue] = useState(defaultValue);
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Select
				value={value}
				onValueChange={(next) => {
					if (next !== null) {
						setValue(next);
						onValueChange?.(next);
					}
				}}
				disabled={disabled}
			>
				<SelectTrigger aria-label={label}>
					<SelectValue placeholder={`选择${label}`}>
						{() =>
							items.find((item) => item.value === value)?.label ??
							`选择${label}`
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<input type="hidden" name={name} value={value} />
		</Field>
	);
}

export function readFormText(data: FormData, name: string) {
	return String(data.get(name) ?? "").trim();
}

export function readFormNumber(data: FormData, name: string) {
	return Number(readFormText(data, name));
}

export function toShanghaiIso(value: string) {
	if (!value) return null;
	const date = new Date(`${value}:00+08:00`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
