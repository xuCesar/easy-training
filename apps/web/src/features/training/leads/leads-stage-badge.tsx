import type { LeadRecordStage } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { getStageLabel } from "./leads-utils";

export function LeadStageBadge({
	stage,
}: {
	stage: LeadRecordStage | "enrolled";
}) {
	return (
		<Badge
			variant={
				stage === "lost"
					? "destructive"
					: stage === "enrolled"
						? "default"
						: "secondary"
			}
		>
			{getStageLabel(stage)}
		</Badge>
	);
}
