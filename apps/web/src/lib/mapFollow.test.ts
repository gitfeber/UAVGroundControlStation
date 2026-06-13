import { afterEach, describe, expect, it, vi } from "vitest";
import { boundsForTrack, loadMapFollowPreferences, saveMapFollowPreferences } from "./mapFollow";

function mockLocalStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    }
  });
  return storage;
}

describe("mapFollow preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports neverConfigured when follow key is absent", () => {
    mockLocalStorage();
    expect(loadMapFollowPreferences()).toEqual({
      follow: false,
      headingUp: false,
      neverConfigured: true
    });
  });

  it("round-trips saved preferences", () => {
    mockLocalStorage();
    saveMapFollowPreferences(true, true);
    expect(loadMapFollowPreferences()).toEqual({
      follow: true,
      headingUp: true,
      neverConfigured: false
    });
  });
});

describe("boundsForTrack", () => {
  it("returns null for an empty track", () => {
    expect(boundsForTrack([])).toBeNull();
  });

  it("returns padded bounds for a single point", () => {
    const bounds = boundsForTrack([[8.5, 47.3]]);
    expect(bounds).not.toBeNull();
    expect(bounds![0][0]).toBeLessThan(8.5);
    expect(bounds![1][0]).toBeGreaterThan(8.5);
  });

  it("returns SW/NE corners for multiple points", () => {
    const bounds = boundsForTrack([
      [8.0, 47.0],
      [9.0, 48.0]
    ]);
    expect(bounds).toEqual([
      [8.0, 47.0],
      [9.0, 48.0]
    ]);
  });
});
