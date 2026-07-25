import { orpc, queryClient } from "@/utils/orpc";

export function invalidateLeadQueries() {
	return queryClient.invalidateQueries({
		queryKey: orpc.training.leads.list.key(),
	});
}
