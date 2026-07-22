import { searchGlobalRecords } from "@easy-training/db";

import {
	getGlobalSearchKindsForRole,
	type OrganizationRole,
} from "../authorization/training";
import type {
	GlobalSearchInput,
	GlobalSearchResult,
} from "../contracts/training";

export async function searchGlobal(
	scope: {
		organizationId: string;
		userId: string;
		role: OrganizationRole;
		campusAccess: Parameters<typeof searchGlobalRecords>[0]["campusAccess"];
	},
	input: GlobalSearchInput,
): Promise<GlobalSearchResult> {
	return {
		groups: (await searchGlobalRecords({
			organizationId: scope.organizationId,
			userId: scope.userId,
			campusAccess: scope.campusAccess,
			kinds: getGlobalSearchKindsForRole(scope.role),
			query: input.query,
		})) as GlobalSearchResult["groups"],
	};
}
