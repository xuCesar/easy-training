import { createFileRoute } from "@tanstack/react-router";

import { useOrganization } from "@/features/training/organization-context";
import { TeacherWorkbench } from "@/features/training/teacher-workbench";

export const Route = createFileRoute("/_auth/teacher")({
	component: TeacherRoute,
});

function TeacherRoute() {
	const { organization } = useOrganization();
	return <TeacherWorkbench organizationId={organization.id} />;
}
