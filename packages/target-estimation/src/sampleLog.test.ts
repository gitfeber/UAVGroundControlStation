import type { TargetEstimate } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import {
  createTargetSampleLogEntry,
  exportTargetSampleLogCsv,
  exportTargetSampleLogJson,
  TargetSampleLog
} from "./sampleLog.js";

function estimate(overrides: Partial<TargetEstimate> = {}): TargetEstimate {
  return {
    valid: true,
    quality: "good",
    reasons: [],
    lat: 50.1,
    lon: 10.2,
    terrainElevationM: 400,
    slantRangeM: 120,
    groundRangeM: 80,
    anchorLat: 50,
    anchorLon: 10,
    uavLat: 50,
    uavLon: 10,
    uavAltM: 520,
    estimatedAtMs: 1000,
    telemetrySampledAtMs: 950,
    gimbalSource: "mavlink285",
    depressionAngleDeg: 35,
    ...overrides
  };
}

describe("TargetSampleLog", () => {
  it("trims to the configured capacity", () => {
    const log = new TargetSampleLog({ capacity: 3 });
    for (let index = 0; index < 5; index += 1) {
      log.append(
        createTargetSampleLogEntry(
          estimate({ estimatedAtMs: index }),
          {
            connected: true,
            lastPacketAt: index,
            sampledAtMs: index,
            packetCount: 1,
            vehicle: { systemId: 1, componentId: 1, type: "quad", armed: false, flightMode: "GUIDED" },
            position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 100, headingDeg: 0, groundCourseDeg: 0 },
            gps: { fixType: 3, fixLabel: "3D", satellites: 10, eph: 1, epv: 1 },
            motion: { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: -10, yawDeg: 0 },
            battery: {
              voltage: 16,
              current: 1,
              remainingPercent: 80,
              consumedMah: 0,
              cellVoltageEstimate: 4
            },
            radio: { rssi: 100, remRssi: 100, rxErrors: 0, fixed: 0, txBuffer: 0, linkQuality: 100 },
            system: { loadPercent: 10, statusText: [] },
            stats: {
              minVoltage: 15,
              maxAltitude: 100,
              maxSpeed: 0,
              maxDistance: 0,
              maxCurrent: 1,
              minRssi: 90,
              warningCount: 0,
              sessionStartedAt: 0
            },
            gimbal: null
          },
          index
        )
      );
    }

    expect(log.size).toBe(3);
    expect(log.getSamples()[0]?.recordedAtMs).toBe(2);
    expect(log.getSamples().at(-1)?.recordedAtMs).toBe(4);
  });

  it("exports JSON and CSV snapshots", () => {
    const entry = createTargetSampleLogEntry(
      estimate({ reasons: ["telemetry_stale"] }),
      {
        connected: true,
        lastPacketAt: 1000,
        sampledAtMs: 1000,
        packetCount: 1,
        vehicle: { systemId: 1, componentId: 1, type: "quad", armed: false, flightMode: "GUIDED" },
        position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 100, headingDeg: 0, groundCourseDeg: 0 },
        gps: { fixType: 3, fixLabel: "3D", satellites: 10, eph: 1, epv: 1 },
        motion: { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: -10, yawDeg: 0 },
        battery: {
          voltage: 16,
          current: 1,
          remainingPercent: 80,
          consumedMah: 0,
          cellVoltageEstimate: 4
        },
        radio: { rssi: 100, remRssi: 100, rxErrors: 0, fixed: 0, txBuffer: 0, linkQuality: 100 },
        system: { loadPercent: 10, statusText: [] },
        stats: {
          minVoltage: 15,
          maxAltitude: 100,
          maxSpeed: 0,
          maxDistance: 0,
          maxCurrent: 1,
          minRssi: 90,
          warningCount: 0,
          sessionStartedAt: 0
        },
        gimbal: null
      }
    );

    const json = exportTargetSampleLogJson([entry]);
    expect(json).toContain('"schema": "uav-gcs-target-sample-log"');
    expect(json).toContain('"telemetry_stale"');

    const csv = exportTargetSampleLogCsv([entry]);
    expect(csv.split("\n")[0]).toContain("recordedAtMs");
    expect(csv).toContain("telemetry_stale");
  });
});
