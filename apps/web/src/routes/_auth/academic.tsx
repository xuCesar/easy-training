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
import { AcademicWorkspace } from "@/features/training/academic-workspace";
import { useOrganization } from "@/features/training/organization-context";

const academicTabs = [
	"classes",
	"lessons",
	"rooms",
	"courses",
	"teachers",
] as const;
const optionalUuid = z
	.string()
	.optional()
	.transform((value) =>
		z.uuid().safeParse(value).success ? value : undefined,
	);

export const Route = createFileRoute("/_auth/academic")({
	validateSearch: z.object({
		tab: z.enum(academicTabs).optional(),
		lessonId: optionalUuid,
		courseId: optionalUuid,
		classGroupId: optionalUuid,
	}),
	component: AcademicRoute,
});

function AcademicRoute() {
	const sessionUserId = Route.useRouteContext().session.data?.user.id;
	const { organization } = useOrganization();
	const { tab, lessonId, courseId, classGroupId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const canManageAcademic = ["owner", "admin", "campus_manager"].includes(
		organization.role,
	);
	if (!canManageAcademic) {
		return (
			<Empty className="min-h-72 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<LockKeyholeIcon />
					</EmptyMedia>
					<EmptyTitle>无权访问教务排课</EmptyTitle>
					<EmptyDescription>
						请联系机构负责人开通教务管理权限。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<AcademicWorkspace
			initialTab={tab ?? "classes"}
			initialLessonId={lessonId}
			initialCourseId={courseId}
			initialClassGroupId={classGroupId}
			onTargetClear={() =>
				void navigate({ search: { tab: tab ?? "classes" }, replace: true })
			}
			organizationId={organization.id}
			sessionUserId={sessionUserId}
			role={organization.role}
		/>
	);
}
