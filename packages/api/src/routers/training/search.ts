import {
	globalSearchInputSchema,
	globalSearchResultSchema,
} from "../../contracts/training";
import { organizationProcedure } from "../../index";
import { searchGlobal } from "../../repositories/global-search";

export const searchRouter = {
	global: organizationProcedure
		.input(globalSearchInputSchema)
		.output(globalSearchResultSchema)
		.handler(({ context, input }) =>
			searchGlobal(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
					role: context.role,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
};
