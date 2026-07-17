const AUTH_CHANNEL_NAME = "easy-training-auth";
const AUTH_STORAGE_KEY = "easy-training:auth-change";
const AUTH_SOURCE_ID = crypto.randomUUID();

export type AuthContextChange =
	| { type: "session-changed" }
	| { type: "organization-switch-started" }
	| { type: "organization-changed"; organizationId: string };

type AuthContextMessage = {
	change: AuthContextChange;
	sourceId: string;
};

export function notifyAuthChange(): void {
	notifyContextChange({ type: "session-changed" });
}

export function notifyOrganizationChange(organizationId: string): void {
	notifyContextChange({ type: "organization-changed", organizationId });
}

export function notifyOrganizationSwitchStarted(): void {
	notifyContextChange({ type: "organization-switch-started" });
}

function notifyContextChange(change: AuthContextChange): void {
	if (typeof window === "undefined") return;
	const message: AuthContextMessage = { change, sourceId: AUTH_SOURCE_ID };

	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
		channel.postMessage(message);
		channel.close();
		return;
	}

	window.localStorage.setItem(
		AUTH_STORAGE_KEY,
		JSON.stringify({ ...message, nonce: crypto.randomUUID(), at: Date.now() }),
	);
}

export function subscribeToAuthChanges(
	onChange: (change: AuthContextChange) => void,
): () => void {
	if (typeof window === "undefined") return () => undefined;

	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
		const handleMessage = (event: MessageEvent<unknown>) => {
			if (isMessageFromCurrentTab(event.data)) return;

			const change = getContextChange(event.data);
			if (change) onChange(change);
		};
		channel.addEventListener("message", handleMessage);
		return () => channel.close();
	}

	const handleStorage = (event: StorageEvent) => {
		if (event.key !== AUTH_STORAGE_KEY) return;

		try {
			const message: unknown = JSON.parse(event.newValue ?? "null");
			if (isMessageFromCurrentTab(message)) return;

			const change = getContextChange(message);
			if (change) onChange(change);
		} catch {
			return;
		}
	};
	window.addEventListener("storage", handleStorage);
	return () => window.removeEventListener("storage", handleStorage);
}

function getContextChange(value: unknown): AuthContextChange | null {
	if (typeof value !== "object" || value === null) return null;

	const candidate = "change" in value ? value.change : value;
	if (typeof candidate !== "object" || candidate === null) return null;
	if (!("type" in candidate) || typeof candidate.type !== "string") return null;

	switch (candidate.type) {
		case "session-changed":
		case "organization-switch-started":
			return { type: candidate.type };
		case "organization-changed":
			return "organizationId" in candidate &&
				typeof candidate.organizationId === "string"
				? {
						type: candidate.type,
						organizationId: candidate.organizationId,
					}
				: null;
		default:
			return null;
	}
}

function isMessageFromCurrentTab(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"sourceId" in value &&
		value.sourceId === AUTH_SOURCE_ID
	);
}
