import {
  createEmptyTargetEstimate,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_TARGET_ESTIMATION_SETTINGS
} from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { createEmptyTelemetryState } from "./initialTelemetry";

describe("target estimation shared contracts", () => {
  it("exposes conservative operator defaults", () => {
    expect(DEFAULT_TARGET_ESTIMATION_SETTINGS.altitudeMode).toBe("amsl");
    expect(DEFAULT_TARGET_ESTIMATION_SETTINGS.altitudeOffsetM).toBe(0);
    expect(DEFAULT_CAMERA_CONFIG.allowBodyFixedWhenGimbalMissing).toBe(false);
    expect(DEFAULT_TARGET_ESTIMATION_SETTINGS.camera).toBe(DEFAULT_CAMERA_CONFIG);
  });

  it("creates an invalid empty estimate shell", () => {
    const estimate = createEmptyTargetEstimate(1234);
    expect(estimate.valid).toBe(false);
    expect(estimate.quality).toBe("bad");
    expect(estimate.estimatedAtMs).toBe(1234);
    expect(estimate.lat).toBeNull();
  });

  it("extends telemetry with estimation fields", () => {
    const telemetry = createEmptyTelemetryState();
    expect(telemetry.sampledAtMs).toBeNull();
    expect(telemetry.gimbal).toBeNull();
  });
});
