import { Field, FieldLabel } from "@easy-training/ui/components/field";
import { Input } from "@easy-training/ui/components/input";

export function DateFilter({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<Field name={label}>
			<FieldLabel className="sr-only" htmlFor={label}>
				{label}
			</FieldLabel>
			<Input
				id={label}
				type="datetime-local"
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}
