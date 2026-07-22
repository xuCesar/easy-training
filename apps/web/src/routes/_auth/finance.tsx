import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@easy-training/ui/components/empty";
import { createFileRoute } from "@tanstack/react-router";
import { LockKeyholeIcon } from "lucide-react";
import { z } from "zod";

import { FinanceWorkspace } from "@/features/training/finance-workspace";
import { useOrganization } from "@/features/training/organization-context";

export const Route = createFileRoute("/_auth/finance")({
	validateSearch: z.object({
		invoiceId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
		receiptId: z
			.string()
			.optional()
			.transform((value) =>
				z.uuid().safeParse(value).success ? value : undefined,
			),
	}),
	component: FinanceRoute,
});

const financeRoles = new Set(["owner", "admin", "campus_manager", "finance"]);

function FinanceRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const navigate = Route.useNavigate();
	const { invoiceId } = Route.useSearch();
	const { organization } = useOrganization();

	if (!financeRoles.has(organization.role)) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<LockKeyholeIcon />
					</EmptyMedia>
					<EmptyTitle>无权访问应收账单</EmptyTitle>
					<EmptyDescription>
						请联系机构负责人为你开通财务管理权限。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	if (!sessionUserId) return null;

	return (
		<FinanceWorkspace
			organizationId={organization.id}
			organizationRole={organization.role}
			sessionUserId={sessionUserId}
			initialInvoiceId={invoiceId}
			onInvoiceIdChange={(nextInvoiceId) =>
				void navigate({
					search: nextInvoiceId ? { invoiceId: nextInvoiceId } : {},
					replace: true,
				})
			}
		/>
	);
}
