import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { StudentsPage } from "@/features/training/students-page";

export const Route = createFileRoute("/_auth/students")({
	validateSearch: z.object({
		studentId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
	}),
	component: StudentsRoute,
});

function StudentsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { studentId } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<StudentsPage
			sessionUserId={sessionUserId}
			studentId={studentId}
			onClearStudentId={() => void navigate({ search: {}, replace: true })}
		/>
	);
}
