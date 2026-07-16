import type { ReactNode } from "react";

interface PanelProps {
	title: string;
	description?: string;
	action?: ReactNode;
	children: ReactNode;
}

export function Panel({ title, description, action, children }: PanelProps) {
	return (
		<section className="panel">
			<header className="panel-header">
				<div>
					<h2>{title}</h2>
					{description ? <p>{description}</p> : null}
				</div>
				{action ? <div className="panel-action">{action}</div> : null}
			</header>
			{children}
		</section>
	);
}
