import { orpc, queryClient } from "@/utils/orpc";

export function invalidateFinanceQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.invoices.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.invoices.detail.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.refundRequests.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.finance.arrears.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.snapshot.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.timeline.key(),
		}),
	]);
}
