export const unavailableTargetMessage = "目标记录不存在或当前账号无权访问。";

export function isUnavailableTargetError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return false;
	}
	return error.code === "NOT_FOUND" || error.code === "FORBIDDEN";
}
