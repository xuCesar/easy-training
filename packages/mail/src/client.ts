import { env } from "@easy-training/env/server";
import tencentcloud from "tencentcloud-sdk-nodejs-ses";

type SesClient = InstanceType<typeof tencentcloud.ses.v20201002.Client>;

let client: SesClient | undefined;

export function getSesClient(): SesClient {
	client ??= new tencentcloud.ses.v20201002.Client({
		credential: {
			secretId: env.TENCENT_SES_SECRET_ID ?? "",
			secretKey: env.TENCENT_SES_SECRET_KEY ?? "",
		},
		region: env.TENCENT_SES_REGION,
		profile: {
			httpProfile: {
				reqMethod: "POST",
				reqTimeout: 30,
			},
		},
	});
	return client;
}

export function buildInvitationUrl(token: string): string {
	const origin = env.CORS_ORIGIN.replace(/\/$/, "");
	return `${origin}/invite#token=${encodeURIComponent(token)}`;
}

export function getMailConfigStatus():
	| { enabled: false; reason: "disabled" | "missing_config" }
	| { enabled: true } {
	if (!env.EMAIL_ENABLED) {
		return { enabled: false, reason: "disabled" };
	}
	if (
		!env.TENCENT_SES_SECRET_ID ||
		!env.TENCENT_SES_SECRET_KEY ||
		!env.TENCENT_SES_FROM_ADDRESS
	) {
		return { enabled: false, reason: "missing_config" };
	}
	return { enabled: true };
}
