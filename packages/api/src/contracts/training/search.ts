import { z } from "zod";

const globalSearchItemBaseSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	subtitle: z.string().nullable(),
});
export const globalSearchInputSchema = z.object({
	query: z.string().trim().min(2).max(100),
});
export const globalSearchItemSchema = z.discriminatedUnion("kind", [
	globalSearchItemBaseSchema.extend({ kind: z.literal("lead") }),
	globalSearchItemBaseSchema.extend({ kind: z.literal("student") }),
	globalSearchItemBaseSchema.extend({ kind: z.literal("course") }),
	globalSearchItemBaseSchema.extend({ kind: z.literal("classGroup") }),
	globalSearchItemBaseSchema.extend({ kind: z.literal("lesson") }),
	globalSearchItemBaseSchema.extend({ kind: z.literal("invoice") }),
	globalSearchItemBaseSchema.extend({
		kind: z.literal("receipt"),
		invoiceId: z.uuid(),
	}),
]);
export const globalSearchResultSchema = z.object({
	groups: z.array(
		z.object({
			kind: z.enum([
				"lead",
				"student",
				"course",
				"classGroup",
				"lesson",
				"invoice",
				"receipt",
			]),
			items: z.array(globalSearchItemSchema).max(5),
			hasMore: z.boolean(),
		}),
	),
});
export type GlobalSearchInput = z.infer<typeof globalSearchInputSchema>;
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;
