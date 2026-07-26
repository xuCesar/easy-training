import { getSesClient } from "../src/client";

function encodeBase64(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

const passwordResetHtml = `<!doctype html>
<html lang="zh-CN">
	<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2328;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;padding:32px;">
			<h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">{{appName}} 密码重置</h1>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">您好，{{userName}}：</p>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">您正在重置 {{appName}} 账号密码。请点击下方按钮完成重置，链接 1 小时内有效。</p>
			<p style="margin:0 0 24px;">
				<a href="{{link}}" style="display:inline-block;padding:10px 20px;background:#1f2328;color:#ffffff;text-decoration:none;font-size:14px;">重置密码</a>
			</p>
			<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#57606a;">若按钮无法点击，请复制以下链接到浏览器打开：<br />{{link}}</p>
			<p style="margin:0;font-size:13px;line-height:1.6;color:#57606a;">如非本人操作，请忽略此邮件，您的密码不会发生变化。</p>
		</div>
	</body>
</html>`;

const passwordResetText = `您好，{{userName}}：

您正在重置 {{appName}} 账号密码。请打开以下链接完成重置（链接 1 小时内有效）：
{{link}}

如非本人操作，请忽略此邮件，您的密码不会发生变化。`;

const invitationHtml = `<!doctype html>
<html lang="zh-CN">
	<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2328;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;padding:32px;">
			<h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">{{appName}} 机构邀请</h1>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">您好：</p>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">您已被邀请加入「{{organizationName}}」，角色为 {{role}}。请点击下方按钮创建账号或登录后加入机构，链接 7 天内有效。</p>
			<p style="margin:0 0 24px;">
				<a href="{{link}}" style="display:inline-block;padding:10px 20px;background:#1f2328;color:#ffffff;text-decoration:none;font-size:14px;">接受邀请</a>
			</p>
			<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#57606a;">若按钮无法点击，请复制以下链接到浏览器打开：<br />{{link}}</p>
			<p style="margin:0;font-size:13px;line-height:1.6;color:#57606a;">如非本人操作，请忽略此邮件。</p>
		</div>
	</body>
</html>`;

const invitationText = `您好：

您已被邀请加入「{{organizationName}}」，角色为 {{role}}。
请打开以下链接创建账号或登录后加入机构（链接 7 天内有效）：
{{link}}

如非本人操作，请忽略此邮件。`;

const emailVerificationHtml = `<!doctype html>
<html lang="zh-CN">
	<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2328;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;padding:32px;">
			<h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">{{appName}} 邮箱验证</h1>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">您好，{{userName}}：</p>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">请验证您的邮箱以完成 {{appName}} 账号激活。点击下方按钮即可完成验证，链接 24 小时内有效。</p>
			<p style="margin:0 0 24px;">
				<a href="{{link}}" style="display:inline-block;padding:10px 20px;background:#1f2328;color:#ffffff;text-decoration:none;font-size:14px;">验证邮箱</a>
			</p>
			<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#57606a;">若按钮无法点击，请复制以下链接到浏览器打开：<br />{{link}}</p>
			<p style="margin:0;font-size:13px;line-height:1.6;color:#57606a;">如非本人操作，请忽略此邮件。</p>
		</div>
	</body>
</html>`;

const emailVerificationText = `您好，{{userName}}：

请验证您的邮箱以完成 {{appName}} 账号激活。请打开以下链接完成验证（链接 24 小时内有效）：
{{link}}

如非本人操作，请忽略此邮件。`;

const templates = [
	{
		name: "EasyTrainingPasswordReset",
		html: passwordResetHtml,
		text: passwordResetText,
	},
	{
		name: "EasyTrainingEmailVerification",
		html: emailVerificationHtml,
		text: emailVerificationText,
	},
	{
		name: "EasyTrainingInvitation",
		html: invitationHtml,
		text: invitationText,
	},
];

async function main() {
	const client = getSesClient();

	const existing = await client.ListEmailTemplates({ Limit: 100, Offset: 0 });
	const existingNames = new Set(
		(existing.TemplatesMetadata ?? []).map((item) => item.TemplateName),
	);

	for (const template of templates) {
		if (existingNames.has(template.name)) {
			console.log(`skip ${template.name}: already exists`);
			continue;
		}
		try {
			const created = await client.CreateEmailTemplate({
				TemplateName: template.name,
				TemplateContent: {
					Html: encodeBase64(template.html),
					Text: encodeBase64(template.text),
				},
			});
			console.log(`created ${template.name}:`, JSON.stringify(created));
		} catch (error) {
			console.error(
				`create ${template.name} failed:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	console.log("\n--- templates after creation ---");
	const list = await client.ListEmailTemplates({ Limit: 50, Offset: 0 });
	console.log(JSON.stringify(list.TemplatesMetadata ?? [], null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
