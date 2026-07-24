import { ORPCError } from "@orpc/server";

type ORPCErrorCode = ConstructorParameters<typeof ORPCError>[0];

export const repositoryErrorOrpcCodeMap = {
	CAMPUS_OUT_OF_SCOPE: "FORBIDDEN",
	MEMBER_FORBIDDEN: "FORBIDDEN",
	SELF_APPROVAL_FORBIDDEN: "FORBIDDEN",
	CANCELLATION_FORBIDDEN: "FORBIDDEN",
	PACKAGE_TERMS_OVERRIDE_FORBIDDEN: "FORBIDDEN",
	CAMPUS_INACTIVE: "CONFLICT",
	CAMPUS_INVALID: "CONFLICT",
	IDEMPOTENCY_CONFLICT: "CONFLICT",
	INVALID_CURSOR: "BAD_REQUEST",
	INVALID_INPUT: "BAD_REQUEST",
} as const satisfies Record<string, ORPCErrorCode>;

export type MappedRepositoryErrorCode = keyof typeof repositoryErrorOrpcCodeMap;

export function getRepositoryErrorOrpcCode(code: string): ORPCErrorCode | null {
	return repositoryErrorOrpcCodeMap[code as MappedRepositoryErrorCode] ?? null;
}

export function throwMappedRepositoryError(
	code: MappedRepositoryErrorCode,
	options: { message: string; data?: Record<string, unknown> },
): never {
	throw new ORPCError(repositoryErrorOrpcCodeMap[code], options);
}
