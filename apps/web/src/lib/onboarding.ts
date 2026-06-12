export const ONBOARDING_VERSION = 1;

export const ONBOARDING_COMPLETED_KEY = "uav-gcs.onboarding.completed";
export const ONBOARDING_VERSION_KEY = "uav-gcs.onboarding.version";

export function hasCompletedOnboarding(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }

  const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "1";
  const version = Number(localStorage.getItem(ONBOARDING_VERSION_KEY) ?? "0");
  return completed && version >= ONBOARDING_VERSION;
}

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, "1");
  localStorage.setItem(ONBOARDING_VERSION_KEY, String(ONBOARDING_VERSION));
}

export function clearOnboardingCompletion(): void {
  localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
  localStorage.removeItem(ONBOARDING_VERSION_KEY);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
