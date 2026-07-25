import { orpc, queryClient } from "@/utils/orpc";

export function invalidateAcademicQueries() {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.courses.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.teachers.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.lessons.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classes.enrollments.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.lessons.attendance.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.classrooms.list.key(),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.training.teaching.makeups.list.key(),
		}),
	]);
}
