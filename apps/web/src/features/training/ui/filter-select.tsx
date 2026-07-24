import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@easy-training/ui/components/select";

export type FilterSelectItem<TValue extends string = string> =
	| {
			value: TValue;
			label: string;
	  }
	| { id: TValue; name: string };

function toOption<TValue extends string>(item: FilterSelectItem<TValue>) {
	return "value" in item ? item : { value: item.id, label: item.name };
}

export function FilterSelect<TValue extends string>({
	label,
	value,
	onValueChange,
	items,
	id,
	ariaLabel,
	showLabel = false,
	containerClassName,
	className = "w-full",
}: {
	label: string;
	value: TValue;
	onValueChange: (value: TValue) => void;
	items: Array<FilterSelectItem<TValue>>;
	id?: string;
	ariaLabel?: string;
	showLabel?: boolean;
	containerClassName?: string;
	className?: string;
}) {
	return (
		<div className={containerClassName}>
			{showLabel ? (
				<span className="mb-1 block text-muted-foreground text-xs">
					{label}
				</span>
			) : null}
			<Select
				value={value}
				onValueChange={(next) => next && onValueChange(next as TValue)}
			>
				<SelectTrigger
					id={id}
					className={className}
					aria-label={ariaLabel ?? label}
				>
					<SelectValue>
						{() =>
							items.map(toOption).find((item) => item.value === value)?.label ??
							ariaLabel ??
							label
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((item) => {
							const option = toOption(item);
							return (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							);
						})}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}
