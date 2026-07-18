import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	lt,
	lte,
	ne,
	or,
} from "drizzle-orm";

import { db } from "../index";
import {
	campus,
	course,
	lead,
	leadActivity,
	organizationMember,
	user,
} from "../schema";

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

const activityTypeFromDatabase = {
	created: "created",
	updated: "updated",
	followed_up: "followedUp",
	converted: "converted",
} as const;

export type WritableLeadStage = keyof typeof stageToDatabase;
export type LeadActivityType =
	(typeof activityTypeFromDatabase)[keyof typeof activityTypeFromDatabase];

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

export type LeadActivityRow = {
	id: string;
	type: LeadActivityType;
	content: string;
	stage: WritableLeadStage | "enrolled";
	nextFollowAt: Date | null;
	lostReason: string | null;
	operator: string;
	operatorUserId: string | null;
	createdAt: Date;
};

export type CreateLeadRecordInput = {
	organizationId: string;
	ownerUserId: string;
	requestId: string;
	name: string;
	phone: string;
	source: string;
	stage: Exclude<WritableLeadStage, "lost">;
	campusId: string | null;
	interestedCourseId: string | null;
	nextFollowAt: Date | null;
	note: string | null;
};

export type UpdateLeadRecordInput = Partial<
	Pick<
		CreateLeadRecordInput,
		"name" | "phone" | "source" | "campusId" | "interestedCourseId" | "note"
	>
>;

export class LeadRepositoryError extends Error {
	constructor(
		public readonly code:
			| "LEAD_NOT_FOUND"
			| "LEAD_ENROLLED"
			| "IDEMPOTENCY_CONFLICT"
			| "INVALID_CURSOR",
	) {
		super(code);
		this.name = "LeadRepositoryError";
	}
}

type LeadCursor = { createdAt: string; id: string };

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
	if (row.stage === "enrolled") return null;
	return { ...row, stage: stageFromDatabase[row.stage] };
}

function toActivityRecord(row: {
	id: string;
	type: (typeof leadActivity.$inferSelect)["type"];
	content: string;
	stage: (typeof lead.$inferSelect)["stage"];
	nextFollowAt: Date | null;
	lostReason: string | null;
	operatorName: string;
	operatorUserId: string | null;
	createdAt: Date;
}): LeadActivityRow {
	return {
		id: row.id,
		type: activityTypeFromDatabase[row.type],
		content: row.content,
		stage: row.stage === "enrolled" ? "enrolled" : stageFromDatabase[row.stage],
		nextFollowAt: row.nextFollowAt,
		lostReason: row.lostReason,
		operator: row.operatorName,
		operatorUserId: row.operatorUserId,
		createdAt: row.createdAt,
	};
}

function createLeadFilters(input: {
	organizationId: string;
	stage?: WritableLeadStage;
	query?: string;
	campusId?: string;
	ownerUserId?: string;
	createdAtFrom?: Date;
	createdAtTo?: Date;
	cursor?: LeadCursor;
}) {
	const filters = [
		eq(lead.organizationId, input.organizationId),
		ne(lead.stage, "enrolled"),
	];

	if (input.stage) filters.push(eq(lead.stage, stageToDatabase[input.stage]));
	if (input.campusId) filters.push(eq(lead.campusId, input.campusId));
	if (input.ownerUserId) filters.push(eq(lead.ownerUserId, input.ownerUserId));
	if (input.createdAtFrom)
		filters.push(gte(lead.createdAt, input.createdAtFrom));
	if (input.createdAtTo) filters.push(lte(lead.createdAt, input.createdAtTo));
	if (input.query) {
		const pattern = `%${input.query}%`;
		const search = or(
			ilike(lead.name, pattern),
			ilike(lead.phone, pattern),
			ilike(lead.source, pattern),
		);
		if (search) filters.push(search);
	}
	if (input.cursor) {
		const cursorFilter = or(
			lt(lead.createdAt, new Date(input.cursor.createdAt)),
			and(
				eq(lead.createdAt, new Date(input.cursor.createdAt)),
				lt(lead.id, input.cursor.id),
			),
		);
		if (cursorFilter) filters.push(cursorFilter);
	}

	return and(...filters);
}

function encodeCursor(row: LeadRecordRow): string {
	return Buffer.from(
		JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
		"utf8",
	).toString("base64url");
}

function decodeCursor(cursor: string | undefined): LeadCursor | undefined {
	if (!cursor) return undefined;

	try {
		const value: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof value !== "object" ||
			value === null ||
			!("id" in value) ||
			!("createdAt" in value) ||
			typeof value.id !== "string" ||
			typeof value.createdAt !== "string" ||
			Number.isNaN(new Date(value.createdAt).getTime())
		) {
			throw new Error("Invalid cursor.");
		}
		return { id: value.id, createdAt: value.createdAt };
	} catch {
		throw new LeadRepositoryError("INVALID_CURSOR");
	}
}

function getDatabaseError(
	error: unknown,
): { code?: string; constraint?: string } | null {
	if (typeof error !== "object" || error === null) return null;
	if ("code" in error) return error as { code?: string; constraint?: string };
	return "cause" in error ? getDatabaseError(error.cause) : null;
}

async function getLeadRecord(input: {
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

function leadPayloadMatches(
	record: {
		name: string;
		phone: string;
		source: string;
		stage: (typeof lead.$inferSelect)["stage"];
		campusId: string | null;
		interestedCourseId: string | null;
		nextFollowAt: Date | null;
		note: string | null;
	},
	input: CreateLeadRecordInput,
): boolean {
	return (
		record.name === input.name &&
		record.phone === input.phone &&
		record.source === input.source &&
		record.stage === stageToDatabase[input.stage] &&
		record.campusId === input.campusId &&
		record.interestedCourseId === input.interestedCourseId &&
		record.nextFollowAt?.getTime() === input.nextFollowAt?.getTime() &&
		record.note === input.note
	);
}

export async function listLeadRecords(input: {
	organizationId: string;
	stage?: WritableLeadStage;
	query?: string;
	campusId?: string;
	ownerUserId?: string;
	createdAtFrom?: Date;
	createdAtTo?: Date;
	cursor?: string;
	pageSize: number;
}): Promise<{
	items: LeadRecordRow[];
	nextCursor: string | null;
	total: number;
}> {
	const cursor = decodeCursor(input.cursor);
	const where = createLeadFilters({ ...input, cursor });
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
			.orderBy(desc(lead.createdAt), desc(lead.id))
			.limit(input.pageSize + 1),
		db
			.select({ value: count() })
			.from(lead)
			.where(createLeadFilters({ ...input, cursor: undefined })),
	]);
	const items = rows
		.slice(0, input.pageSize)
		.map(toLeadRecord)
		.filter((row): row is LeadRecordRow => row !== null);
	const hasNextPage = rows.length > input.pageSize;
	const lastItem = items.at(-1);

	return {
		items,
		nextCursor: hasNextPage && lastItem ? encodeCursor(lastItem) : null,
		total: totalRows[0]?.value ?? 0,
	};
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
): Promise<{ lead: LeadRecordRow; replayed: boolean }> {
	try {
		const result = await db.transaction(async (tx) => {
			const [existing] = await tx
				.select({
					id: lead.id,
					name: lead.name,
					phone: lead.phone,
					source: lead.source,
					stage: lead.stage,
					campusId: lead.campusId,
					interestedCourseId: lead.interestedCourseId,
					nextFollowAt: lead.nextFollowAt,
					note: lead.note,
				})
				.from(lead)
				.where(
					and(
						eq(lead.organizationId, input.organizationId),
						eq(lead.requestId, input.requestId),
					),
				)
				.limit(1);

			if (existing) {
				if (!leadPayloadMatches(existing, input)) {
					throw new LeadRepositoryError("IDEMPOTENCY_CONFLICT");
				}
				return { id: existing.id, replayed: true };
			}

			const [operator] = await tx
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.ownerUserId))
				.limit(1);
			if (!operator) throw new Error("Lead creator was not found.");

			const [created] = await tx
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
					requestId: input.requestId,
				})
				.returning({ id: lead.id });
			if (!created) throw new Error("Lead creation did not return a record.");

			await tx.insert(leadActivity).values({
				organizationId: input.organizationId,
				leadId: created.id,
				type: "created",
				content: input.note || "创建线索",
				stage: stageToDatabase[input.stage],
				nextFollowAt: input.nextFollowAt,
				operatorUserId: input.ownerUserId,
				operatorName: operator.name,
			});

			return { id: created.id, replayed: false };
		});

		const created = await getLeadRecord({
			organizationId: input.organizationId,
			id: result.id,
		});
		if (!created) throw new Error("Lead result could not be loaded.");
		return { lead: created, replayed: result.replayed };
	} catch (error) {
		if (error instanceof LeadRepositoryError) throw error;

		const databaseError = getDatabaseError(error);
		if (
			databaseError?.code === "23505" &&
			databaseError.constraint === "lead_org_request_uidx"
		) {
			const [existing] = await db
				.select({ id: lead.id })
				.from(lead)
				.where(
					and(
						eq(lead.organizationId, input.organizationId),
						eq(lead.requestId, input.requestId),
					),
				)
				.limit(1);
			if (!existing) throw error;

			const record = await getLeadRecord({
				organizationId: input.organizationId,
				id: existing.id,
			});
			if (
				!record ||
				!leadPayloadMatches(
					{ ...record, stage: stageToDatabase[record.stage] },
					input,
				)
			) {
				throw new LeadRepositoryError("IDEMPOTENCY_CONFLICT");
			}
			return { lead: record, replayed: true };
		}

		throw error;
	}
}

export async function updateLeadRecord(input: {
	organizationId: string;
	id: string;
	operatorUserId: string;
	data: UpdateLeadRecordInput;
}): Promise<LeadRecordRow> {
	const updatedId = await db.transaction(async (tx) => {
		const [current] = await tx
			.select({
				id: lead.id,
				stage: lead.stage,
				nextFollowAt: lead.nextFollowAt,
			})
			.from(lead)
			.where(
				and(
					eq(lead.id, input.id),
					eq(lead.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new LeadRepositoryError("LEAD_NOT_FOUND");
		if (current.stage === "enrolled") {
			throw new LeadRepositoryError("LEAD_ENROLLED");
		}

		const [operator] = await tx
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, input.operatorUserId))
			.limit(1);
		if (!operator) throw new Error("Lead operator was not found.");

		await tx
			.update(lead)
			.set({ ...input.data, updatedAt: new Date() })
			.where(
				and(
					eq(lead.id, input.id),
					eq(lead.organizationId, input.organizationId),
				),
			);
		await tx.insert(leadActivity).values({
			organizationId: input.organizationId,
			leadId: input.id,
			type: "updated",
			content: "更新基础资料",
			stage: current.stage,
			nextFollowAt: current.nextFollowAt,
			operatorUserId: input.operatorUserId,
			operatorName: operator.name,
		});

		return current.id;
	});

	const updated = await getLeadRecord({
		organizationId: input.organizationId,
		id: updatedId,
	});
	if (!updated) throw new LeadRepositoryError("LEAD_NOT_FOUND");
	return updated;
}

export async function addLeadFollowUpRecord(input: {
	organizationId: string;
	leadId: string;
	operatorUserId: string;
	content: string;
	stage: WritableLeadStage;
	nextFollowAt: Date | null;
	lostReason: string | null;
}): Promise<LeadRecordRow> {
	if (input.stage === "lost" && !input.lostReason) {
		throw new Error("Lost lead requires a reason.");
	}

	const leadId = await db.transaction(async (tx) => {
		const [current] = await tx
			.select({ id: lead.id, stage: lead.stage })
			.from(lead)
			.where(
				and(
					eq(lead.id, input.leadId),
					eq(lead.organizationId, input.organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!current) throw new LeadRepositoryError("LEAD_NOT_FOUND");
		if (current.stage === "enrolled") {
			throw new LeadRepositoryError("LEAD_ENROLLED");
		}

		const [operator] = await tx
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, input.operatorUserId))
			.limit(1);
		if (!operator) throw new Error("Lead operator was not found.");

		await tx
			.update(lead)
			.set({
				stage: stageToDatabase[input.stage],
				nextFollowAt: input.nextFollowAt,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(lead.id, current.id),
					eq(lead.organizationId, input.organizationId),
				),
			);
		await tx.insert(leadActivity).values({
			organizationId: input.organizationId,
			leadId: current.id,
			type: "followed_up",
			content: input.content,
			stage: stageToDatabase[input.stage],
			nextFollowAt: input.nextFollowAt,
			lostReason: input.stage === "lost" ? input.lostReason : null,
			operatorUserId: input.operatorUserId,
			operatorName: operator.name,
		});

		return current.id;
	});

	const updated = await getLeadRecord({
		organizationId: input.organizationId,
		id: leadId,
	});
	if (!updated) throw new LeadRepositoryError("LEAD_NOT_FOUND");
	return updated;
}

export async function listLeadActivities(input: {
	organizationId: string;
	leadId: string;
}): Promise<LeadActivityRow[]> {
	const exists = await findLeadStage({
		organizationId: input.organizationId,
		id: input.leadId,
	});
	if (!exists) throw new LeadRepositoryError("LEAD_NOT_FOUND");

	const rows = await db
		.select({
			id: leadActivity.id,
			type: leadActivity.type,
			content: leadActivity.content,
			stage: leadActivity.stage,
			nextFollowAt: leadActivity.nextFollowAt,
			lostReason: leadActivity.lostReason,
			operatorName: leadActivity.operatorName,
			operatorUserId: leadActivity.operatorUserId,
			createdAt: leadActivity.createdAt,
		})
		.from(leadActivity)
		.where(
			and(
				eq(leadActivity.organizationId, input.organizationId),
				eq(leadActivity.leadId, input.leadId),
			),
		)
		.orderBy(desc(leadActivity.createdAt), desc(leadActivity.id))
		.limit(100);

	return rows.map(toActivityRecord);
}

export async function listLeadFilterOptions(input: {
	organizationId: string;
}): Promise<{
	campuses: Array<{ id: string; name: string }>;
	owners: Array<{ id: string; name: string }>;
}> {
	const [campuses, owners] = await Promise.all([
		db
			.select({ id: campus.id, name: campus.name })
			.from(campus)
			.where(eq(campus.organizationId, input.organizationId))
			.orderBy(asc(campus.name), asc(campus.id)),
		db
			.select({ id: organizationMember.userId, name: user.name })
			.from(organizationMember)
			.innerJoin(user, eq(user.id, organizationMember.userId))
			.where(eq(organizationMember.organizationId, input.organizationId))
			.orderBy(asc(user.name), asc(organizationMember.userId)),
	]);

	return { campuses, owners };
}

export async function exportLeadRecords(input: {
	organizationId: string;
	stage?: WritableLeadStage;
	query?: string;
	campusId?: string;
	ownerUserId?: string;
	createdAtFrom?: Date;
	createdAtTo?: Date;
	limit: number;
}): Promise<LeadRecordRow[]> {
	const rows = await db
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
		.where(createLeadFilters(input))
		.orderBy(desc(lead.updatedAt), desc(lead.id))
		.limit(input.limit);

	return rows
		.map(toLeadRecord)
		.filter((row): row is LeadRecordRow => row !== null);
}
