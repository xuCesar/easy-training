export const ONBOARDING_TOKEN_KEY = "easy-training:onboarding-token";
export const ONBOARDING_TOKEN_HEADER = "X-Onboarding-Token";

export function getOnboardingToken(): string | null {
	if (typeof window === "undefined") return null;
	return window.sessionStorage.getItem(ONBOARDING_TOKEN_KEY);
}

export function clearOnboardingToken(): void {
	if (typeof window === "undefined") return;
	window.sessionStorage.removeItem(ONBOARDING_TOKEN_KEY);
}
