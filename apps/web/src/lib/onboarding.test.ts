import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOnboardingCompletion,
  hasCompletedOnboarding,
  markOnboardingComplete,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_VERSION,
  ONBOARDING_VERSION_KEY
} from "./onboarding";

function createLocalStorageMock() {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    }
  };
}

describe("onboarding persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats missing keys as not completed", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    expect(hasCompletedOnboarding()).toBe(false);
  });

  it("marks completion with version", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    markOnboardingComplete();
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe("1");
    expect(localStorage.getItem(ONBOARDING_VERSION_KEY)).toBe(String(ONBOARDING_VERSION));
    expect(hasCompletedOnboarding()).toBe(true);
  });

  it("clears completion for manual restart", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    markOnboardingComplete();
    clearOnboardingCompletion();
    expect(hasCompletedOnboarding()).toBe(false);
  });
});
