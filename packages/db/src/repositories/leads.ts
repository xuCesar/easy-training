import { and, count, desc, eq, ilike, ne, or } from "drizzle-orm";

import { db } from "../index";
import { campus, course, lead, user } from "../schema";

const stageToDatabase = {
	new: "new",
	contacted: "contacted",
	trialBooked: "trial_booked",
	lost: "lost",
} as const;

const stageFromDatabase = {
	new: "new",
	contacted: "contacted",
	trial_booked: "trialBooked",
	lost: "lost",
} as const;

export type WritableLeadStage = keyof typeof stageToDatabase;

export type LeadRecordRow = {
	id: string;
	name: string;
	phone: string;
	source: string;
	stage: WritableLeadStage;
	interestedCourse: string | null;
	owner: string | null;
	nextFollowAt: Date | null;
	note: string | null;
	campusId: string | null;
	interestedCourseId: string | null;
	ownerUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CreateLeadRecordInput = {
	organizationId: string;
	ownerUserId: string;
	name: string;
	phone: string;
	source: string;
	stage: WritableLeadStage;
	campusId: string | null;
	interestedCourseId: string | null;
	nextFollowAt: Date | null;
	note: string | null;
};

export type UpdateLeadRecordInput = Partial<
	Pick<
		CreateLeadRecordInput,
		| "name"
		| "phone"
		| "source"
		| "stage"
		| "campusId"
		| "interestedCourseId"
		| "nextFollowAt"
		| "note"
	>
>;

const leadRecordSelection = {
	id: lead.id,
	name: lead.name,
	phone: lead.phone,
	source: lead.source,
	stage: lead.stage,
	interestedCourse: course.name,
	owner: user.name,
	nextFollowAt: lead.nextFollowAt,
	note: lead.note,
	campusId: lead.campusId,
	interestedCourseId: lead.interestedCourseId,
	ownerUserId: lead.ownerUserId,
	createdAt: lead.createdAt,
	updatedAt: lead.updatedAt,
};

function toLeadRecord(row: {
	id: string;
	name: string;
	phone: string;
	source: string;
	stage: (typeof lead.$inferSelect)["stage"];
	interestedCourse: string | null;
	owner: string | null;
	nextFollowAt: Date | null;
	note: string | null;
	campusId: string | null;
	interestedCourseId: string | null;
	ownerUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}): LeadRecordRow | null {
	if (row.stage === "enrolled") {
		return null;
	}

	return { ...row, stage: stageFromDatabase[row.stage] };
}

export async function listLeadRecords(input: {
	organizationId: string;
	stage?: WritableLeadStage;
	query?: string;
}): Promise<{ items: LeadRecordRow[]; total: number }> {
	const filters = [
		eq(lead.organizationId, input.organizationId),
		ne(lead.stage, "enrolled"),
	];

	if (input.stage) {
		filters.push(eq(lead.stage, stageToDatabase[input.stage]));
	}
	if (input.query) {
		const pattern = `%${input.query}%`;
		const search = or(
			ilike(lead.name, pattern),
			ilike(lead.phone, pattern),
			ilike(lead.source, pattern),
		);
		if (search) {
			filters.push(search);
		}
	}

	const where = and(...filters);
	const [rows, totalRows] = await Promise.all([
		db
			.select(leadRecordSelection)
			.from(lead)
			.leftJoin(
				course,
				and(
					eq(course.id, lead.interestedCourseId),
					eq(course.organizationId, input.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, lead.ownerUserId))
			.where(where)
			.orderBy(desc(lead.updatedAt), desc(lead.createdAt)),
		db.select({ value: count() }).from(lead).where(where),
	]);

	return {
		items: rows
			.map(toLeadRecord)
			.filter((row): row is LeadRecordRow => row !== null),
		total: totalRows[0]?.value ?? 0,
	};
}

export async function findLeadRecord(input: {
	organizationId: string;
	id: string;
}): Promise<LeadRecordRow | null> {
	const [row] = await db
		.select(leadRecordSelection)
		.from(lead)
		.leftJoin(
			course,
			and(
				eq(course.id, lead.interestedCourseId),
				eq(course.organizationId, input.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, lead.ownerUserId))
		.where(
			and(eq(lead.id, input.id), eq(lead.organizationId, input.organizationId)),
		)
		.limit(1);

	return row ? toLeadRecord(row) : null;
}

export async function findLeadStage(input: {
	organizationId: string;
	id: string;
}): Promise<(typeof lead.$inferSelect)["stage"] | null> {
	const [row] = await db
		.select({ stage: lead.stage })
		.from(lead)
		.where(
			and(eq(lead.id, input.id), eq(lead.organizationId, input.organizationId)),
		)
		.limit(1);

	return row?.stage ?? null;
}

export async function campusExistsInOrganization(input: {
	organizationId: string;
	id: string;
}): Promise<boolean> {
	const [row] = await db
		.select({ id: campus.id })
		.from(campus)
		.where(
			and(
				eq(campus.id, input.id),
				eq(campus.organizationId, input.organizationId),
			),
		)
		.limit(1);

	return Boolean(row);
}

export async function courseExistsInOrganization(input: {
	organizationId: string;
	id: string;
}): Promise<boolean> {
	const [row] = await db
		.select({ id: course.id })
		.from(course)
		.where(
			and(
				eq(course.id, input.id),
				eq(course.organizationId, input.organizationId),
			),
		)
		.limit(1);

	return Boolean(row);
}

export async function createLeadRecord(
	input: CreateLeadRecordInput,
): Promise<LeadRecordRow | null> {
	const [created] = await db
		.insert(lead)
		.values({
			organizationId: input.organizationId,
			campusId: input.campusId,
			interestedCourseId: input.interestedCourseId,
			ownerUserId: input.ownerUserId,
			name: input.name,
			phone: input.phone,
			source: input.source,
			stage: stageToDatabase[input.stage],
			nextFollowAt: input.nextFollowAt,
			note: input.note,
		})
		.returning({ id: lead.id });

	return created
		? findLeadRecord({ organizationId: input.organizationId, id: created.id })
		: null;
}

export async function updateLeadRecord(input: {
	organizationId: string;
	id: string;
	data: UpdateLeadRecordInput;
}): Promise<LeadRecordRow | null> {
	const [updated] = await db
		.update(lead)
		.set({
			...input.data,
			stage: input.data.stage ? stageToDatabase[input.data.stage] : undefined,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(lead.id, input.id),
				eq(lead.organizationId, input.organizationId),
				ne(lead.stage, "enrolled"),
			),
		)
		.returning({ id: lead.id });

	return updated
		? findLeadRecord({ organizationId: input.organizationId, id: updated.id })
		: null;
}
