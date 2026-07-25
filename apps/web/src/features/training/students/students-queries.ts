import { orpc, queryClient } from "@/utils/orpc";

export function invalidateStudentQueries() {
	return queryClient.invalidateQueries({
		queryKey: orpc.training.students.list.key(),
	});
}

export function invalidateTagQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.students.tags.list.key(),
		}),
		invalidateStudentQueries(),
	]);
}
