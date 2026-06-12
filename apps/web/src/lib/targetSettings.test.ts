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

  it("clamps corrupted persisted settings instead of passing NaN into geo math", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    });
    storage.set(
      "uav-gcs.target.settings",
      JSON.stringify({
        videoLatencyMs: Number.NaN,
        altitudeMode: "invalid",
        altitudeOffsetM: Number.POSITIVE_INFINITY,
        camera: {
          calibrationDeg: { roll: Number.NaN, pitch: -999, yaw: "bad" },
          gimbalFrame: "sideways",
          pitchSign: "broken",
          yawReference: "east",
          allowBodyFixedWhenGimbalMissing: "yes"
        },
        raycast: {
          maxRangeM: -1,
          stepM: Number.NaN,
          minDownAngleDeg: 500,
          refineIterations: 0,
          staleTelemetryWarnMs: 1,
          gpsLowAccuracyEphM: Number.NaN,
          gpsFewSatellitesWarn: -5
        }
      })
    );

    const loaded = loadTargetEstimationSettings();
    expect(loaded.videoLatencyMs).toBe(DEFAULT_TARGET_ESTIMATION_SETTINGS.videoLatencyMs);
    expect(loaded.altitudeMode).toBe("amsl");
    expect(loaded.altitudeOffsetM).toBe(0);
    expect(loaded.camera.calibrationDeg.roll).toBe(0);
    expect(loaded.camera.calibrationDeg.pitch).toBe(-180);
    expect(loaded.camera.calibrationDeg.yaw).toBe(0);
    expect(loaded.camera.gimbalFrame).toBe("earth");
    expect(loaded.camera.allowBodyFixedWhenGimbalMissing).toBe(false);
    expect(loaded.raycast.maxRangeM).toBe(100);
    expect(loaded.raycast.stepM).toBe(DEFAULT_RAYCAST_CONFIG.stepM);
    expect(loaded.raycast.minDownAngleDeg).toBe(89);
    expect(loaded.raycast.refineIterations).toBe(1);
    expect(loaded.raycast.staleTelemetryWarnMs).toBe(100);
    expect(loaded.raycast.gpsLowAccuracyEphM).toBe(DEFAULT_RAYCAST_CONFIG.gpsLowAccuracyEphM);
    expect(loaded.raycast.gpsFewSatellitesWarn).toBe(0);
    vi.unstubAllGlobals();
  });
});
