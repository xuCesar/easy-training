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
import type { InputHTMLAttributes } from "react";

import { formatCentsAsYuan } from "./finance-form-utils";

type CampusOption = {
	id: string;
	name: string;
};

type CourseOption = {
	id: string;
	name: string;
	listPriceInCents: number;
	lessonsPerPackage: number;
};

type ClassOption = {
	id: string;
	name: string;
	seatsRemaining: number;
	scheduleText: string;
};

export function EnrollmentTextField({
	id,
	label,
	value,
	onChange,
	error,
	type = "text",
	readOnly,
	required,
	maxLength,
	min,
	max,
	inputMode,
	placeholder,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	type?: string;
	readOnly?: boolean;
	required?: boolean;
	maxLength?: number;
	min?: string | number;
	max?: string | number;
	inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
	placeholder?: string;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type={type}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
				readOnly={readOnly}
				required={required}
				maxLength={maxLength}
				min={min}
				max={max}
				inputMode={inputMode}
				placeholder={placeholder}
			/>
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

export function EnrollmentCampusField({
	id,
	label,
	campuses,
	campusId,
	error,
	emptyMessage,
	placeholder = "请选择校区",
	emptyTone = "muted",
	onChange,
}: {
	id: string;
	label: string;
	campuses: CampusOption[];
	campusId: string;
	error?: string;
	emptyMessage: string;
	placeholder?: string;
	emptyTone?: "muted" | "destructive";
	onChange: (value: string) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{campuses.length === 0 ? (
				<p
					className={`border p-2 text-xs ${
						emptyTone === "destructive"
							? "border-destructive/50 text-destructive"
							: "text-muted-foreground"
					}`}
				>
					{emptyMessage}
				</p>
			) : (
				<Select
					value={campusId || null}
					onValueChange={(value) => onChange(value ?? "")}
				>
					<SelectTrigger
						id={id}
						className="w-full"
						aria-invalid={Boolean(error)}
					>
						<SelectValue>
							{() =>
								campuses.find((campus) => campus.id === campusId)?.name ??
								placeholder
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{campuses.map((campus) => (
								<SelectItem key={campus.id} value={campus.id}>
									{campus.name}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

export function EnrollmentCourseField({
	id,
	courses,
	courseId,
	error,
	emptyMessage,
	placeholder = "请选择课程",
	onChange,
}: {
	id: string;
	courses: CourseOption[];
	courseId: string;
	error?: string;
	emptyMessage: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>课程</FieldLabel>
			{courses.length === 0 ? (
				<p className="border p-2 text-muted-foreground text-xs">
					{emptyMessage}
				</p>
			) : (
				<Select
					value={courseId || null}
					onValueChange={(value) => {
						if (value) onChange(value);
					}}
				>
					<SelectTrigger
						id={id}
						className="w-full"
						aria-invalid={Boolean(error)}
					>
						<SelectValue>
							{() =>
								courses.find((course) => course.id === courseId)?.name ??
								placeholder
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{courses.map((course) => (
								<SelectItem key={course.id} value={course.id}>
									{course.name} · {formatCentsAsYuan(course.listPriceInCents)}{" "}
									元 / {course.lessonsPerPackage} 课时
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}

export function EnrollmentClassField({
	id,
	courseId,
	campusId,
	classes,
	classGroupId,
	error,
	onChange,
}: {
	id: string;
	courseId: string;
	campusId?: string;
	classes: ClassOption[];
	classGroupId: string | null;
	error?: string;
	onChange: (value: string | null) => void;
}) {
	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>班级（可选）</FieldLabel>
			{!courseId || !campusId ? (
				<p className="border p-2 text-muted-foreground text-xs">
					请先选择学员、校区和课程。
				</p>
			) : classes.length === 0 ? (
				<p className="border p-2 text-muted-foreground text-xs">
					该课程在所选校区暂无可选班级，可暂不分班。
				</p>
			) : (
				<Select
					value={classGroupId ?? "unassigned"}
					onValueChange={(value) =>
						onChange(value === "unassigned" ? null : (value ?? null))
					}
				>
					<SelectTrigger id={id} className="w-full">
						<SelectValue>
							{() => {
								const selected = classes.find(
									(item) => item.id === classGroupId,
								);
								return selected
									? `${selected.name} · 余 ${selected.seatsRemaining}`
									: "暂不分班";
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectItem value="unassigned">暂不分班</SelectItem>
							{classes.map((classGroup) => (
								<SelectItem key={classGroup.id} value={classGroup.id}>
									{classGroup.name} · 余 {classGroup.seatsRemaining} ·{" "}
									{classGroup.scheduleText || "排课待定"}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}
