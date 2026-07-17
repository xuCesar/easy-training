const AUTH_CHANNEL_NAME = "easy-training-auth";
const AUTH_STORAGE_KEY = "easy-training:auth-change";

export function notifyAuthChange(): void {
	if (typeof window === "undefined") return;

	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
		channel.postMessage({ type: "session-changed" });
		channel.close();
		return;
	}

	window.localStorage.setItem(
		AUTH_STORAGE_KEY,
		`${Date.now()}:${crypto.randomUUID()}`,
	);
}

export function subscribeToAuthChanges(onChange: () => void): () => void {
	if (typeof window === "undefined") return () => undefined;

	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
		channel.addEventListener("message", onChange);
		return () => channel.close();
	}

	const handleStorage = (event: StorageEvent) => {
		if (event.key === AUTH_STORAGE_KEY) onChange();
	};
	window.addEventListener("storage", handleStorage);
	return () => window.removeEventListener("storage", handleStorage);
}
