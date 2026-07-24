import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LeadsPage } from "@/features/training/leads-page";

export const Route = createFileRoute("/_auth/leads")({
	validateSearch: z.object({
		leadId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
	}),
	component: LeadsRoute,
});

function LeadsRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { leadId } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<LeadsPage
			sessionUserId={sessionUserId}
			leadId={leadId}
			onClearLeadId={() => void navigate({ search: {}, replace: true })}
		/>
	);
}
