import { env } from "@easy-training/env/server";

function encodeBase64(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

export function buildPasswordResetContent(input: {
	userName: string;
	resetUrl: string;
}) {
	const appName = env.APP_PUBLIC_NAME;
	const subject = `${appName} 密码重置`;
	const text = [
		`您好${input.userName ? `，${input.userName}` : ""}：`,
		"",
		`您正在重置 ${appName} 账号密码。请点击以下链接完成重置（链接 1 小时内有效）：`,
		input.resetUrl,
		"",
		"如非本人操作，请忽略此邮件。",
	].join("\n");
	const html = [
		`<p>您好${input.userName ? `，${escapeHtml(input.userName)}` : ""}：</p>`,
		`<p>您正在重置 <strong>${escapeHtml(appName)}</strong> 账号密码。请点击下方链接完成重置（链接 1 小时内有效）：</p>`,
		`<p><a href="${escapeHtmlAttribute(input.resetUrl)}">重置密码</a></p>`,
		"<p>如非本人操作，请忽略此邮件。</p>",
	].join("");

	return {
		subject,
		templateData: {
			appName,
			userName: input.userName || "用户",
			link: input.resetUrl,
		},
		simple: {
			Html: encodeBase64(html),
			Text: encodeBase64(text),
		},
	};
}

export function buildEmailVerificationContent(input: {
	userName: string;
	verificationUrl: string;
}) {
	const appName = env.APP_PUBLIC_NAME;
	const subject = `${appName} 邮箱验证`;
	const text = [
		`您好${input.userName ? `，${input.userName}` : ""}：`,
		"",
		`请验证您的邮箱以完成 ${appName} 账号激活。点击以下链接即可完成验证：`,
		input.verificationUrl,
		"",
		"如非本人操作，请忽略此邮件。",
	].join("\n");
	const html = [
		`<p>您好${input.userName ? `，${escapeHtml(input.userName)}` : ""}：</p>`,
		`<p>请验证您的邮箱以完成 <strong>${escapeHtml(appName)}</strong> 账号激活。点击下方链接即可完成验证：</p>`,
		`<p><a href="${escapeHtmlAttribute(input.verificationUrl)}">验证邮箱</a></p>`,
		"<p>如非本人操作，请忽略此邮件。</p>",
	].join("");

	return {
		subject,
		templateData: {
			appName,
			userName: input.userName || "用户",
			link: input.verificationUrl,
		},
		simple: {
			Html: encodeBase64(html),
			Text: encodeBase64(text),
		},
	};
}

export function buildInvitationContent(input: {
	organizationName: string;
	role: string;
	invitationUrl: string;
}) {
	const appName = env.APP_PUBLIC_NAME;
	const subject = `${appName} 机构邀请`;
	const text = [
		"您好：",
		"",
		`您已被邀请加入「${input.organizationName}」，角色为 ${input.role}。`,
		"请点击以下链接创建账号或登录后加入机构（链接 7 天内有效）：",
		input.invitationUrl,
		"",
		"如非本人操作，请忽略此邮件。",
	].join("\n");
	const html = [
		"<p>您好：</p>",
		`<p>您已被邀请加入「${escapeHtml(input.organizationName)}」，角色为 ${escapeHtml(input.role)}。</p>`,
		"<p>请点击下方链接创建账号或登录后加入机构（链接 7 天内有效）：</p>",
		`<p><a href="${escapeHtmlAttribute(input.invitationUrl)}">接受邀请</a></p>`,
		"<p>如非本人操作，请忽略此邮件。</p>",
	].join("");

	return {
		subject,
		templateData: {
			appName,
			organizationName: input.organizationName,
			role: input.role,
			link: input.invitationUrl,
		},
		simple: {
			Html: encodeBase64(html),
			Text: encodeBase64(text),
		},
	};
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replaceAll("`", "&#96;");
}
