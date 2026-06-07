import type { TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { estimateTargetFromTelemetry } from "./estimateTarget.js";
import { FlatTerrainProvider } from "./flatTerrain.js";
import { MissingDemTerrainProvider } from "./missingDemTerrain.js";

function baseTelemetry(overrides: Partial<TelemetryState> = {}): TelemetryState {
  const sampledAtMs = 1000;
  return {
    connected: true,
    lastPacketAt: sampledAtMs,
    sampledAtMs,
    packetCount: 1,
    vehicle: { systemId: 1, componentId: 1, type: "quad", armed: false, flightMode: "GUIDED" },
    position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 100, headingDeg: 0, groundCourseDeg: 0 },
    gps: { fixType: 3, fixLabel: "3D", satellites: 12, eph: 0.8, epv: 1 },
    motion: { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
    battery: { voltage: 16, current: 5, remainingPercent: 80, consumedMah: 100, cellVoltageEstimate: 4 },
    radio: { rssi: 100, remRssi: 100, rxErrors: 0, fixed: 0, txBuffer: 0, linkQuality: 100 },
    system: { loadPercent: 10, statusText: [] },
    stats: {
      minVoltage: 15,
      maxAltitude: 100,
      maxSpeed: 0,
      maxDistance: 0,
      maxCurrent: 5,
      minRssi: 90,
      warningCount: 0,
      sessionStartedAt: sampledAtMs - 1000
    },
    gimbal: {
      rollDeg: 0,
      pitchDeg: -90,
      yawDeg: 0,
      source: "mavlink285",
      sampledAtMs
    },
    ...overrides
  };
}

const settings = {
  videoLatencyMs: 0,
  altitudeMode: "amsl" as const,
  altitudeOffsetM: 0,
  camera: {
    mountOffsetM: { x: 0, y: 0, z: 0 },
    calibrationDeg: { roll: 0, pitch: 0, yaw: 0 },
    gimbalFrame: "earth" as const,
    pitchSign: "normal" as const,
    yawReference: "north" as const,
    allowBodyFixedWhenGimbalMissing: false
  },
  raycast: {
    maxRangeM: 20_000,
    stepM: 5,
    minDownAngleDeg: 5,
    refineIterations: 14,
    staleTelemetryWarnMs: 500,
    gpsLowAccuracyEphM: 2.0,
    gpsFewSatellitesWarn: 8
  }
};

describe("estimateTargetFromTelemetry quality gates", () => {
  it("reports dem_not_loaded for missing desktop DEM provider", async () => {
    const estimate = await estimateTargetFromTelemetry({
      telemetry: baseTelemetry(),
      lookup: { state: baseTelemetry(), sampledAtMs: 1000, interpolated: false, ageMs: 0, trailingGapMs: 0 },
      terrain: new MissingDemTerrainProvider(),
      settings,
      estimatedAtMs: 1000,
      telemetrySampledAtMs: 1000
    });

    expect(estimate.valid).toBe(false);
    expect(estimate.quality).toBe("bad");
    expect(estimate.reasons).toContain("dem_not_loaded");
    expect(estimate.lat).toBeNull();
  });

  it("warns on low GPS accuracy", async () => {
    const estimate = await estimateTargetFromTelemetry({
      telemetry: baseTelemetry({ gps: { fixType: 3, fixLabel: "3D", satellites: 12, eph: 3.0, epv: 1 } }),
      lookup: { state: baseTelemetry(), sampledAtMs: 1000, interpolated: false, ageMs: 0, trailingGapMs: 0 },
      terrain: new FlatTerrainProvider({ elevationAmslM: 400 }),
      settings,
      estimatedAtMs: 1000,
      telemetrySampledAtMs: 1000
    });

    expect(estimate.valid).toBe(true);
    expect(estimate.quality).toBe("warn");
    expect(estimate.reasons).toContain("gps_low_accuracy");
  });

  it("warns on few satellites", async () => {
    const estimate = await estimateTargetFromTelemetry({
      telemetry: baseTelemetry({ gps: { fixType: 3, fixLabel: "3D", satellites: 5, eph: 0.8, epv: 1 } }),
      lookup: { state: baseTelemetry(), sampledAtMs: 1000, interpolated: false, ageMs: 0, trailingGapMs: 0 },
      terrain: new FlatTerrainProvider({ elevationAmslM: 400 }),
      settings,
      estimatedAtMs: 1000,
      telemetrySampledAtMs: 1000
    });

    expect(estimate.valid).toBe(true);
    expect(estimate.quality).toBe("warn");
    expect(estimate.reasons).toContain("gps_few_satellites");
  });

  it("warns on mavlink265 gimbal mount orientation", async () => {
    const estimate = await estimateTargetFromTelemetry({
      telemetry: baseTelemetry({
        gimbal: {
          rollDeg: 0,
          pitchDeg: -90,
          yawDeg: 0,
          source: "mavlink265",
          sampledAtMs: 1000
        }
      }),
      lookup: { state: baseTelemetry(), sampledAtMs: 1000, interpolated: false, ageMs: 0, trailingGapMs: 0 },
      terrain: new FlatTerrainProvider({ elevationAmslM: 400 }),
      settings,
      estimatedAtMs: 1000,
      telemetrySampledAtMs: 1000
    });

    expect(estimate.valid).toBe(true);
    expect(estimate.quality).toBe("warn");
    expect(estimate.reasons).toContain("gimbal_mount_orientation");
  });
});
