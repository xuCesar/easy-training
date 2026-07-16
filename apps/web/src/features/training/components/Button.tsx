import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	variant?: "primary" | "secondary" | "ghost";
}

export function Button({
	children,
	variant = "primary",
	...props
}: ButtonProps) {
	return (
		<button className={`button button-${variant}`} type="button" {...props}>
			{children}
		</button>
	);
}
