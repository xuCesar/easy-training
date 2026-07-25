import {
	Field,
	FieldError,
	FieldLabel,
} from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";
import { toLocalInputValue } from "./leads-utils";

export function DateTimeField({
	label,
	value,
	onChange,
	error,
}: {
	label: string;
	value: string | null;
	onChange: (value: string) => void;
	error?: string;
}) {
	const id = label.replaceAll(" ", "-");
	return (
		<Field name={id} invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type="datetime-local"
				value={toLocalInputValue(value)}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={Boolean(error)}
			/>
			<FieldError match={Boolean(error)}>{error}</FieldError>
		</Field>
	);
}
