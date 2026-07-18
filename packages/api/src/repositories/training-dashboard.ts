import {
	getDashboardLeadSummary,
	getDashboardLearningSummary,
	getDashboardLessonSummary,
	getDashboardReceivableSummary,
	getDashboardTaskSummary,
} from "@easy-training/db/repositories/training-dashboard";
import { ORPCError } from "@orpc/server";

import {
	financeManagementRoles,
	leadManagementRoles,
	type OrganizationRole,
	organizationOperationsRoles,
} from "../authorization/training";
import type { DashboardSnapshot } from "../contracts/training";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_IN_MS = 8 * 60 * 60 * 1000;

type DashboardScope = {
	organizationId: string;
	userId: string;
	role: OrganizationRole;
	campusAccess?: Parameters<
		typeof getDashboardLearningSummary
	>[0]["campusAccess"];
};

export function getDashboardTimeWindow(now: Date) {
	const shanghaiTimestamp = now.getTime() + SHANGHAI_OFFSET_IN_MS;
	const localDayStart = Math.floor(shanghaiTimestamp / DAY_IN_MS) * DAY_IN_MS;
	const dayStart = new Date(localDayStart - SHANGHAI_OFFSET_IN_MS);
	const nextDayStart = new Date(dayStart.getTime() + DAY_IN_MS);

	return {
		now,
		today: new Date(shanghaiTimestamp).toISOString().slice(0, 10),
		nextDayStart,
		lessonWindowEnd: new Date(dayStart.getTime() + 7 * DAY_IN_MS),
	};
}

export async function getTrainingDashboardSnapshot(
	scope: DashboardScope,
	now = new Date(),
): Promise<DashboardSnapshot> {
	const canViewLeads = leadManagementRoles.has(scope.role);
	const canViewFinance = financeManagementRoles.has(scope.role);
	const canViewOrganizationOperations = organizationOperationsRoles.has(
		scope.role,
	);
	const window = getDashboardTimeWindow(now);

	try {
		const [
			leadSummary,
			learningSummary,
			taskSummary,
			lessonSummary,
			receivableSummary,
		] = await Promise.all([
			canViewLeads
				? getDashboardLeadSummary({
						organizationId: scope.organizationId,
						campusAccess: scope.campusAccess ?? { kind: "all" },
						now: window.now,
						nextDayStart: window.nextDayStart,
					})
				: Promise.resolve({ total: 0, items: [] }),
			getDashboardLearningSummary({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess ?? { kind: "all" },
			}),
			getDashboardTaskSummary({
				organizationId: scope.organizationId,
				now: window.now,
				nextDayStart: window.nextDayStart,
				ownerUserId:
					canViewOrganizationOperations &&
					(scope.campusAccess ?? { kind: "all" }).kind === "all"
						? undefined
						: scope.userId,
			}),
			getDashboardLessonSummary({
				organizationId: scope.organizationId,
				campusAccess: scope.campusAccess ?? { kind: "all" },
				now: window.now,
				windowEnd: window.lessonWindowEnd,
				teacherUserId: scope.role === "teacher" ? scope.userId : undefined,
			}),
			canViewFinance
				? getDashboardReceivableSummary({
						organizationId: scope.organizationId,
						campusAccess: scope.campusAccess ?? { kind: "all" },
						today: window.today,
					})
				: Promise.resolve({
						total: 0,
						outstandingAmountInCents: 0,
						items: [],
					}),
		]);

		return {
			asOf: now.toISOString(),
			permissions: { canViewLeads, canViewFinance },
			metrics: {
				followUpCount: canViewLeads ? leadSummary.total : null,
				studentCount: learningSummary.studentCount,
				enrollmentCount: learningSummary.enrollmentCount,
				activeClassCount: learningSummary.activeClassCount,
				dueTaskCount: taskSummary.total,
				upcomingLessonCount: lessonSummary.total,
				pendingInvoiceCount: canViewFinance ? receivableSummary.total : null,
				outstandingAmountInCents: canViewFinance
					? receivableSummary.outstandingAmountInCents
					: null,
			},
			followUps: leadSummary.items.map((item) => ({
				id: item.id,
				name: item.name,
				stage: item.stage === "trial_booked" ? "trialBooked" : item.stage,
				interestedCourse: item.interestedCourse,
				nextFollowAt: item.nextFollowAt?.toISOString() ?? null,
			})),
			tasks: taskSummary.items.map((item) => ({
				id: item.id,
				title: item.title,
				module: item.module,
				owner: item.owner,
				dueAt: item.dueAt.toISOString(),
				priority: item.priority,
			})),
			upcomingLessons: lessonSummary.items.map((item) => ({
				id: item.id,
				className: item.className,
				courseName: item.courseName,
				campusName: item.campusName,
				teacherName: item.teacherName,
				room: item.room,
				startsAt: item.startsAt.toISOString(),
				endsAt: item.endsAt.toISOString(),
			})),
			receivables: receivableSummary.items.map((item) => ({
				id: item.id,
				studentName: item.studentName,
				courseName: item.courseName,
				outstandingAmountInCents: item.outstandingAmountInCents,
				status:
					item.status === "overdue" || item.isPastDue ? "overdue" : "pending",
				dueDate: item.dueDate,
			})),
		};
	} catch {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "暂时无法加载运营工作台，请稍后重试。",
		});
	}
}
