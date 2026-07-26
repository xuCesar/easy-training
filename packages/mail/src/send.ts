import { env } from "@easy-training/env/server";

import {
	buildInvitationUrl,
	getMailConfigStatus,
	getSesClient,
} from "./client";
import { type EmailKind, logEmailEvent } from "./log";
import {
	buildEmailVerificationContent,
	buildInvitationContent,
	buildPasswordResetContent,
} from "./messages";

type SendEmailInput = {
	kind: EmailKind;
	to: string;
	subject: string;
	templateId?: number;
	templateData: Record<string, string>;
	simple: {
		Html?: string;
		Text?: string;
	};
};

async function sendEmail(input: SendEmailInput): Promise<void> {
	const status = getMailConfigStatus();
	if (!status.enabled) {
		logEmailEvent({
			event: "email.skipped",
			kind: input.kind,
			reason: status.reason,
		});
		if (env.NODE_ENV === "development") {
			logEmailEvent({ event: "email.dev_fallback", kind: input.kind });
		}
		return;
	}

	try {
		const client = getSesClient();
		const fromAddress = env.TENCENT_SES_FROM_ADDRESS;
		if (!fromAddress) {
			throw new Error("Missing TENCENT_SES_FROM_ADDRESS");
		}
		const response = await client.SendEmail({
			FromEmailAddress: fromAddress,
			Destination: [input.to],
			Subject: input.subject,
			TriggerType: 1,
			...(input.templateId
				? {
						Template: {
							TemplateID: input.templateId,
							TemplateData: JSON.stringify(input.templateData),
						},
					}
				: { Simple: input.simple }),
		});

		logEmailEvent({
			event: "email.sent",
			kind: input.kind,
			messageId: response.MessageId,
		});
	} catch (error) {
		logEmailEvent({
			event: "email.failed",
			kind: input.kind,
			error: error instanceof Error ? error.message : "Unknown email error",
		});
	}
}

export async function sendPasswordResetEmail(input: {
	to: string;
	userName: string;
	resetUrl: string;
}): Promise<void> {
	const content = buildPasswordResetContent(input);
	await sendEmail({
		kind: "password_reset",
		to: input.to,
		subject: content.subject,
		templateId: env.TENCENT_SES_TEMPLATE_ID_PASSWORD_RESET,
		templateData: content.templateData,
		simple: content.simple,
	});
}

export async function sendEmailVerificationEmail(input: {
	to: string;
	userName: string;
	verificationUrl: string;
}): Promise<void> {
	const content = buildEmailVerificationContent(input);
	await sendEmail({
		kind: "email_verification",
		to: input.to,
		subject: content.subject,
		templateId: env.TENCENT_SES_TEMPLATE_ID_EMAIL_VERIFICATION,
		templateData: content.templateData,
		simple: content.simple,
	});
}

export async function sendInvitationEmail(input: {
	to: string;
	organizationName: string;
	role: string;
	invitationUrl: string;
}): Promise<void> {
	const content = buildInvitationContent(input);
	await sendEmail({
		kind: "invitation",
		to: input.to,
		subject: content.subject,
		templateId: env.TENCENT_SES_TEMPLATE_ID_INVITATION,
		templateData: content.templateData,
		simple: content.simple,
	});
}

export async function dispatchInvitationEmail(input: {
	to: string;
	organizationName: string;
	role: string;
	token: string;
}): Promise<void> {
	await sendInvitationEmail({
		to: input.to,
		organizationName: input.organizationName,
		role: input.role,
		invitationUrl: buildInvitationUrl(input.token),
	});
}
