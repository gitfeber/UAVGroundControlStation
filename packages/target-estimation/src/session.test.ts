import type { GimbalState, TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { FlatTerrainProvider } from "./flatTerrain.js";
import { SlopedPlaneTerrainProvider } from "./slopedTerrain.js";
import { TargetEstimationSession } from "./session.js";

function sample(overrides: Partial<TelemetryState> & { sampledAtMs: number }): TelemetryState {
  const { sampledAtMs, position, motion, gimbal, gps, ...rest } = overrides;

  return {
    connected: true,
    lastPacketAt: sampledAtMs,
    sampledAtMs,
    packetCount: 1,
    vehicle: {
      systemId: 1,
      componentId: 1,
      type: "quad",
      armed: false,
      flightMode: "GUIDED"
    },
    position: {
      lat: 50,
      lon: 10,
      altMsl: 500,
      relativeAlt: 100,
      headingDeg: 0,
      groundCourseDeg: 0,
      ...position
    },
    gps: {
      fixType: 3,
      fixLabel: "3D Fix",
      satellites: 12,
      eph: 0.8,
      epv: 1.1,
      ...gps
    },
    motion: {
      groundSpeed: 0,
      airSpeed: 0,
      climbRate: 0,
      rollDeg: 0,
      pitchDeg: 0,
      yawDeg: 0,
      ...motion
    },
    battery: {
      voltage: 16,
      current: 5,
      remainingPercent: 80,
      consumedMah: 100,
      cellVoltageEstimate: 4
    },
    radio: {
      rssi: 100,
      remRssi: 100,
      rxErrors: 0,
      fixed: 0,
      txBuffer: 0,
      linkQuality: 100
    },
    system: {
      loadPercent: 10,
      statusText: []
    },
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
    gimbal: gimbal ?? null,
    ...rest
  };
}

function earthGimbal(pitchDeg: number, yawDeg = 0, rollDeg = 0, sampledAtMs = 1000): GimbalState {
  return {
    rollDeg,
    pitchDeg,
    yawDeg,
    source: "mavlink285",
    sampledAtMs
  };
}

describe("TargetEstimationSession", () => {
  const terrain = new FlatTerrainProvider({ elevationAmslM: 400 });

  it("estimates nadir ground target on flat terrain", async () => {
    const session = new TargetEstimationSession({ terrain });
    session.push(
      sample({
        sampledAtMs: 1000,
        position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 100, headingDeg: 0, groundCourseDeg: 0 },
        gimbal: earthGimbal(-90, 0, 0, 1000)
      })
    );

    const estimate = await session.estimate({ estimatedAtMs: 1200, atPcTimeMs: 1000 });

    expect(estimate.valid).toBe(true);
    expect(estimate.quality).toBe("good");
    expect(estimate.lat).toBeCloseTo(50, 5);
    expect(estimate.lon).toBeCloseTo(10, 5);
    expect(estimate.slantRangeM).toBeCloseTo(100, 1);
    expect(estimate.groundRangeM).toBeCloseTo(0, 1);
    expect(estimate.terrainElevationM).toBe(400);
  });

  it("estimates an offset ground target when pitched 45 degrees north", async () => {
    const session = new TargetEstimationSession({ terrain });
    session.push(
      sample({
        sampledAtMs: 2000,
        gimbal: earthGimbal(-45, 0, 0, 2000)
      })
    );

    const estimate = await session.estimate({ estimatedAtMs: 2200, atPcTimeMs: 2000 });

    expect(estimate.valid).toBe(true);
    expect(estimate.groundRangeM).toBeCloseTo(100, 1);
    expect(estimate.lat).toBeGreaterThan(50);
    expect(estimate.lon).toBeCloseTo(10, 3);
  });

  it("blocks replay and simulation source modes", async () => {
    const replaySession = new TargetEstimationSession({ terrain, sourceMode: "replay" });
    const estimate = await replaySession.estimate({ estimatedAtMs: 1000 });
    expect(estimate.valid).toBe(false);
    expect(estimate.reasons).toContain("target_estimation_live_only");
  });

  it("returns gimbal_unavailable when gimbal telemetry is missing", async () => {
    const session = new TargetEstimationSession({ terrain });
    session.push(sample({ sampledAtMs: 1000, gimbal: null }));
    const estimate = await session.estimate({ estimatedAtMs: 1200, atPcTimeMs: 1000 });
    expect(estimate.valid).toBe(false);
    expect(estimate.reasons).toContain("gimbal_unavailable");
  });

  it("warns when body-fixed attitude fallback is enabled", async () => {
    const session = new TargetEstimationSession({
      terrain,
      settings: {
        videoLatencyMs: 0,
        altitudeMode: "amsl",
        altitudeOffsetM: 0,
        camera: {
          mountOffsetM: { x: 0, y: 0, z: 0 },
          calibrationDeg: { roll: 0, pitch: 0, yaw: 0 },
          gimbalFrame: "earth",
          pitchSign: "normal",
          yawReference: "north",
          allowBodyFixedWhenGimbalMissing: true
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
      }
    });

    session.push(
      sample({
        sampledAtMs: 1000,
        gimbal: null,
        motion: { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: -90, yawDeg: 0 }
      })
    );

    const estimate = await session.estimate({ estimatedAtMs: 1000, atPcTimeMs: 1000 });
    expect(estimate.valid).toBe(true);
    expect(estimate.quality).toBe("warn");
    expect(estimate.gimbalSource).toBe("bodyFixed");
  });

  it("rejects shallow depression angles below the quality gate", async () => {
    const session = new TargetEstimationSession({ terrain });
    session.push(
      sample({
        sampledAtMs: 3000,
        gimbal: earthGimbal(-2, 0, 0, 3000)
      })
    );

    const estimate = await session.estimate({ estimatedAtMs: 3000, atPcTimeMs: 3000 });
    expect(estimate.valid).toBe(false);
    expect(estimate.reasons).toContain("camera_above_horizon");
  });

  it("estimates against a sloped synthetic terrain plane", async () => {
    const sloped = new SlopedPlaneTerrainProvider({ elevationAmslM: 400, slopeNorth: 0.1 });
    const session = new TargetEstimationSession({ terrain: sloped });
    session.push(
      sample({
        sampledAtMs: 4000,
        gimbal: earthGimbal(-45, 0, 0, 4000)
      })
    );

    const estimate = await session.estimate({ estimatedAtMs: 4000, atPcTimeMs: 4000 });
    expect(estimate.valid).toBe(true);
    expect(estimate.groundRangeM).toBeGreaterThan(80);
    expect(estimate.groundRangeM).toBeLessThan(110);
  });

  it("records live estimates in the sample log ring", async () => {
    const session = new TargetEstimationSession({ terrain, sampleLog: { capacity: 2 } });
    session.push(sample({ sampledAtMs: 1000, gimbal: earthGimbal(-90, 0, 0, 1000) }));
    await session.estimate({ estimatedAtMs: 1000, atPcTimeMs: 1000 });
    session.push(sample({ sampledAtMs: 2000, gimbal: earthGimbal(-90, 0, 0, 2000) }));
    await session.estimate({ estimatedAtMs: 2000, atPcTimeMs: 2000 });
    session.push(sample({ sampledAtMs: 3000, gimbal: earthGimbal(-90, 0, 0, 3000) }));
    await session.estimate({ estimatedAtMs: 3000, atPcTimeMs: 3000 });

    expect(session.getSampleLogSize()).toBe(2);
    expect(session.getSampleLogEntries()[0]?.recordedAtMs).toBe(2000);
  });
});
