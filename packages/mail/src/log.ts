export type EmailKind = "password_reset" | "invitation" | "email_verification";

export type EmailLogEvent =
	| {
			event: "email.sent";
			kind: EmailKind;
			messageId?: string;
	  }
	| {
			event: "email.failed";
			kind: EmailKind;
			error: string;
	  }
	| {
			event: "email.skipped";
			kind: EmailKind;
			reason: "disabled" | "missing_config";
	  }
	| {
			event: "email.dev_fallback";
			kind: EmailKind;
	  };

export function logEmailEvent(event: EmailLogEvent) {
	console.log(JSON.stringify(event));
}
