/**
 * 仅规范化用于同机构查重的展示差异，不推断姓名、地区或号码归属。
 */
export function normalizeStudentPhone(phone: string): string {
	return phone
		.trim()
		.replace(/[\s()（）-]/gu, "")
		.replace(/^\+?86/u, "");
}
