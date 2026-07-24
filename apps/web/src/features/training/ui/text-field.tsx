import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";

export function TextField({
	id,
	label,
	value,
	onChange,
	name,
	type = "text",
	required = false,
	error,
	minLength,
	maxLength,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	name?: string;
	type?: "text" | "date" | "datetime-local" | "tel";
	required?: boolean;
	error?: string;
	minLength?: number;
	maxLength?: number;
}) {
	return (
		<Field name={name} invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				name={name}
				type={type}
				required={required}
				value={value}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? `${id}-error` : undefined}
				minLength={minLength}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
			/>
			<FieldError id={`${id}-error`} match={Boolean(error)}>
				{error}
			</FieldError>
		</Field>
	);
}
