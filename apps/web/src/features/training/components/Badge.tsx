import type { ReactNode } from "react";

export type BadgeTone =
	| "neutral"
	| "blue"
	| "green"
	| "amber"
	| "red"
	| "violet";

interface BadgeProps {
	children: ReactNode;
	tone?: BadgeTone;
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
	return <span className={`badge badge-${tone}`}>{children}</span>;
}
