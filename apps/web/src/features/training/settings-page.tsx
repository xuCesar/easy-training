import { useOrganization } from "@/features/training/organization-context";
import { PermissionDenied } from "./settings/settings-states";
import { managementRoles } from "./settings/settings-types";
import { SettingsWorkspace } from "./settings/settings-workspace";

export function SettingsPage({
	sessionUserId,
}: {
	sessionUserId: string | undefined;
}) {
	const { organization } = useOrganization();

	if (!managementRoles.has(organization.role)) {
		return <PermissionDenied />;
	}

	return (
		<SettingsWorkspace
			organizationId={organization.id}
			sessionUserId={sessionUserId}
			operatorRole={organization.role}
		/>
	);
}
