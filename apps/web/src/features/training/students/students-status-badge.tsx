import type { StudentStatus } from "@easy-training/api/contracts/training";
import { Badge } from "@easy-training/ui/components/badge";
import { studentStatuses } from "./students-types";

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
	return (
		<Badge
			variant={
				status === "atRisk"
					? "destructive"
					: status === "active"
						? "default"
						: "secondary"
			}
		>
			{studentStatuses.find((item) => item.value === status)?.label}
		</Badge>
	);
}
