interface ProgressBarProps {
	value: number;
	label: string;
	tone?: "blue" | "green" | "amber" | "red";
}

export function ProgressBar({ value, label, tone = "blue" }: ProgressBarProps) {
	const percent = Math.max(0, Math.min(100, Math.round(value * 100)));

	return (
		<div
			className="progress-block"
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
		>
			<div className="progress-row">
				<span>{label}</span>
				<strong>{percent}%</strong>
			</div>
			<div className="progress-track">
				<span
					className={`progress-fill progress-${tone}`}
					style={{ width: `${percent}%` }}
				/>
			</div>
		</div>
	);
}
