import { DEFAULT_RAYCAST_CONFIG, DEFAULT_TARGET_ESTIMATION_SETTINGS } from "@uav-ground-control-station/shared";
import { describe, expect, it, vi } from "vitest";
import { loadTargetEstimationSettings, saveTargetEstimationSettings } from "./targetSettings";

describe("targetSettings", () => {
  it("persists raycast and calibration settings under uav-gcs.target.settings", () => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    };
    vi.stubGlobal("localStorage", localStorageMock);
    const custom = {
      ...DEFAULT_TARGET_ESTIMATION_SETTINGS,
      camera: {
        ...DEFAULT_TARGET_ESTIMATION_SETTINGS.camera,
        calibrationDeg: { roll: 1, pitch: -2, yaw: 3 },
        allowBodyFixedWhenGimbalMissing: true
      },
      raycast: {
        ...DEFAULT_RAYCAST_CONFIG,
        maxRangeM: 12_000,
        stepM: 10,
        minDownAngleDeg: 7
      }
    };

    saveTargetEstimationSettings(custom);
    const loaded = loadTargetEstimationSettings();

    expect(loaded.camera.calibrationDeg).toEqual({ roll: 1, pitch: -2, yaw: 3 });
    expect(loaded.camera.allowBodyFixedWhenGimbalMissing).toBe(true);
    expect(loaded.raycast.maxRangeM).toBe(12_000);
    expect(loaded.raycast.stepM).toBe(10);
    expect(loaded.raycast.minDownAngleDeg).toBe(7);
    expect(loaded.raycast.staleTelemetryWarnMs).toBe(DEFAULT_RAYCAST_CONFIG.staleTelemetryWarnMs);
    vi.unstubAllGlobals();
  });
});
