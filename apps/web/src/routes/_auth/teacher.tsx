import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { useOrganization } from "@/features/training/organization-context";
import { TeacherWorkbench } from "@/features/training/teacher-workbench";

export const Route = createFileRoute("/_auth/teacher")({
	validateSearch: z.object({
		lessonId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
	}),
	component: TeacherRoute,
});

function TeacherRoute() {
	const { organization } = useOrganization();
	const { lessonId } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<TeacherWorkbench
			organizationId={organization.id}
			initialLessonId={lessonId}
			onTargetClear={() => void navigate({ search: {}, replace: true })}
		/>
	);
}
