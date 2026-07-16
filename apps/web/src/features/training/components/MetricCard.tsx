import type { DashboardMetric } from "../insights";

interface MetricCardProps {
	metric: DashboardMetric;
}

export function MetricCard({ metric }: MetricCardProps) {
	return (
		<article className={`metric-card metric-${metric.tone}`}>
			<p>{metric.label}</p>
			<strong>{metric.value}</strong>
			<span>{metric.helper}</span>
		</article>
	);
}
