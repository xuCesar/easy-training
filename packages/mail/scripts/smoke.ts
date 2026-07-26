import { env } from "@easy-training/env/server";

import { getMailConfigStatus, getSesClient } from "../src/client";
import {
	sendEmailVerificationEmail,
	sendInvitationEmail,
	sendPasswordResetEmail,
} from "../src/send";

function mask(value: string | undefined): string {
	if (!value) return "(unset)";
	if (value.length <= 8) return "***";
	return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function main() {
	const recipient = process.argv[2];

	console.log("--- mail config ---");
	console.log({
		EMAIL_ENABLED: env.EMAIL_ENABLED,
		APP_PUBLIC_NAME: env.APP_PUBLIC_NAME,
		TENCENT_SES_REGION: env.TENCENT_SES_REGION,
		TENCENT_SES_SECRET_ID: mask(env.TENCENT_SES_SECRET_ID),
		TENCENT_SES_SECRET_KEY: mask(env.TENCENT_SES_SECRET_KEY),
		TENCENT_SES_FROM_ADDRESS: env.TENCENT_SES_FROM_ADDRESS,
		templatePasswordReset:
			env.TENCENT_SES_TEMPLATE_ID_PASSWORD_RESET ?? "(simple mode)",
		templateInvitation:
			env.TENCENT_SES_TEMPLATE_ID_INVITATION ?? "(simple mode)",
		templateEmailVerification:
			env.TENCENT_SES_TEMPLATE_ID_EMAIL_VERIFICATION ?? "(simple mode)",
		status: getMailConfigStatus(),
	});

	const client = getSesClient();

	console.log("\n--- sender domains (ListEmailIdentities) ---");
	try {
		const identities = await client.ListEmailIdentities({});
		console.log(JSON.stringify(identities.EmailIdentities ?? [], null, 2));
	} catch (error) {
		console.error("ListEmailIdentities failed:", error);
	}

	console.log("\n--- sender addresses (ListEmailAddress) ---");
	try {
		const addresses = await client.ListEmailAddress({});
		console.log(JSON.stringify(addresses.EmailSenders ?? [], null, 2));
	} catch (error) {
		console.error("ListEmailAddress failed:", error);
	}

	console.log("\n--- templates (ListEmailTemplates) ---");
	try {
		const templates = await client.ListEmailTemplates({
			Limit: 50,
			Offset: 0,
		});
		console.log(JSON.stringify(templates.TemplatesMetadata ?? [], null, 2));
	} catch (error) {
		console.error("ListEmailTemplates failed:", error);
	}

	console.log("\n--- recent send statistics ---");
	try {
		const today = new Date();
		const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
		const toDate = (value: Date) => value.toISOString().slice(0, 10);
		const stats = await client.GetStatisticsReport({
			StartDate: toDate(start),
			EndDate: toDate(today),
		});
		console.log(JSON.stringify(stats.DailyVolumes ?? [], null, 2));
	} catch (error) {
		console.error("GetStatisticsReport failed:", error);
	}

	if (!recipient) {
		console.log(
			"\nNo recipient argument supplied; skipping real send. Pass an address to send test mail.",
		);
		return;
	}

	console.log(`\n--- sending password reset mail to ${recipient} ---`);
	await sendPasswordResetEmail({
		to: recipient,
		userName: "测试用户",
		resetUrl: `${env.CORS_ORIGIN}/reset-password?token=smoke-test-token`,
	});

	console.log(`\n--- sending invitation mail to ${recipient} ---`);
	await sendInvitationEmail({
		to: recipient,
		organizationName: "冒烟测试机构",
		role: "课程顾问",
		invitationUrl: `${env.CORS_ORIGIN}/invite#token=smoke-test-token`,
	});

	console.log(`\n--- sending email verification mail to ${recipient} ---`);
	await sendEmailVerificationEmail({
		to: recipient,
		userName: "测试用户",
		verificationUrl: `${env.BETTER_AUTH_URL}/api/auth/verify-email?token=smoke-test-token`,
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
