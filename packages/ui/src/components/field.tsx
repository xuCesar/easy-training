import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cn } from "@easy-training/ui/lib/utils";

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
	return (
		<FieldPrimitive.Root className={cn("grid gap-1.5", className)} {...props} />
	);
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
	return (
		<FieldPrimitive.Label
			className={cn("font-medium text-sm", className)}
			{...props}
		/>
	);
}

function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
	return (
		<FieldPrimitive.Error
			className={cn("text-destructive text-xs", className)}
			{...props}
		/>
	);
}

export { Field, FieldError, FieldLabel };
