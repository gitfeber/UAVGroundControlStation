import type { GimbalState, TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { lerpAngleDeg, interpolateTelemetryState } from "./interpolate.js";
import { DEFAULT_TELEMETRY_BUFFER_RETENTION_MS, TelemetryRingBuffer } from "./telemetryBuffer.js";

function sample(overrides: Partial<TelemetryState> & { sampledAtMs: number }): TelemetryState {
  const { sampledAtMs, position, motion, gimbal, ...rest } = overrides;

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
      relativeAlt: 120,
      headingDeg: 90,
      groundCourseDeg: 90,
      ...position
    },
    gps: {
      fixType: 3,
      fixLabel: "3D Fix",
      satellites: 12,
      eph: 0.8,
      epv: 1.1
    },
    motion: {
      groundSpeed: 10,
      airSpeed: 11,
      climbRate: 0,
      rollDeg: 0,
      pitchDeg: -10,
      yawDeg: 90,
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
      maxAltitude: 120,
      maxSpeed: 10,
      maxDistance: 100,
      maxCurrent: 5,
      minRssi: 90,
      warningCount: 0,
      sessionStartedAt: sampledAtMs - 1000
    },
    gimbal: gimbal ?? null,
    ...rest
  };
}

describe("lerpAngleDeg", () => {
  it("interpolates across the 360-degree wrap", () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 5);
  });
});

describe("interpolateTelemetryState", () => {
  it("interpolates pose fields and stamps sampledAtMs", () => {
    const before = sample({ sampledAtMs: 1000, position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 120, headingDeg: 0, groundCourseDeg: 0 } });
    const after = sample({ sampledAtMs: 2000, position: { lat: 51, lon: 10, altMsl: 600, relativeAlt: 220, headingDeg: 20, groundCourseDeg: 20 } });

    const mid = interpolateTelemetryState(before, after, 0.5);

    expect(mid.sampledAtMs).toBe(1500);
    expect(mid.position.lat).toBeCloseTo(50.5);
    expect(mid.position.lon).toBeCloseTo(10.5);
    expect(mid.position.altMsl).toBeCloseTo(550);
    expect(mid.position.headingDeg).toBeCloseTo(10);
    expect(mid.vehicle.flightMode).toBe("GUIDED");
  });

  it("steps gimbal source when conventions change mid-span", () => {
    const gimbal285: GimbalState = {
      rollDeg: 0,
      pitchDeg: -30,
      yawDeg: 10,
      source: "mavlink285",
      sampledAtMs: 1000
    };
    const gimbal265: GimbalState = {
      rollDeg: 0,
      pitchDeg: -40,
      yawDeg: 20,
      source: "mavlink265",
      sampledAtMs: 2000
    };

    const before = sample({ sampledAtMs: 1000, gimbal: gimbal285 });
    const after = sample({ sampledAtMs: 2000, gimbal: gimbal265 });

    expect(interpolateTelemetryState(before, after, 0.25).gimbal?.source).toBe("mavlink285");
    expect(interpolateTelemetryState(before, after, 0.75).gimbal?.source).toBe("mavlink265");
  });
});

describe("TelemetryRingBuffer", () => {
  it("rejects snapshots without sampledAtMs", () => {
    const buffer = new TelemetryRingBuffer();
    expect(buffer.push(sample({ sampledAtMs: 1000 }))).toBe(true);
    expect(buffer.push({ ...sample({ sampledAtMs: 2000 }), sampledAtMs: null })).toBe(false);
    expect(buffer.size).toBe(1);
  });

  it("trims entries older than retention", () => {
    const buffer = new TelemetryRingBuffer({ retentionMs: 5000 });
    buffer.push(sample({ sampledAtMs: 1000, position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 120, headingDeg: 0, groundCourseDeg: 0 } }));
    buffer.push(sample({ sampledAtMs: 4000, position: { lat: 50.1, lon: 10.1, altMsl: 510, relativeAlt: 121, headingDeg: 1, groundCourseDeg: 1 } }));
    buffer.push(sample({ sampledAtMs: 7000, position: { lat: 50.2, lon: 10.2, altMsl: 520, relativeAlt: 122, headingDeg: 2, groundCourseDeg: 2 } }));

    expect(buffer.getOldestSampledAtMs()).toBe(4000);
    expect(buffer.size).toBe(2);
  });

  it("uses default retention of 10 seconds", () => {
    expect(DEFAULT_TELEMETRY_BUFFER_RETENTION_MS).toBe(10_000);
  });

  it("returns exact bracketing samples without interpolation", () => {
    const buffer = new TelemetryRingBuffer();
    buffer.push(sample({ sampledAtMs: 1000, position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 120, headingDeg: 0, groundCourseDeg: 0 } }));
    buffer.push(sample({ sampledAtMs: 2000, position: { lat: 51, lon: 10, altMsl: 600, relativeAlt: 220, headingDeg: 20, groundCourseDeg: 20 } }));

    const hit = buffer.lookup(1000);
    expect(hit.interpolated).toBe(false);
    expect(hit.state?.position.lat).toBe(50);
    expect(hit.ageMs).toBe(0);
  });

  it("interpolates between retained samples", () => {
    const buffer = new TelemetryRingBuffer();
    buffer.push(sample({ sampledAtMs: 1000, position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 120, headingDeg: 0, groundCourseDeg: 0 } }));
    buffer.push(sample({ sampledAtMs: 2000, position: { lat: 52, lon: 12, altMsl: 700, relativeAlt: 320, headingDeg: 40, groundCourseDeg: 40 } }));

    const hit = buffer.lookup(1500);
    expect(hit.interpolated).toBe(true);
    expect(hit.sampledAtMs).toBe(1500);
    expect(hit.state?.position.lat).toBeCloseTo(51);
    expect(hit.state?.position.lon).toBeCloseTo(11);
    expect(hit.trailingGapMs).toBe(-500);
  });

  it("holds newest sample when query time is in the future", () => {
    const buffer = new TelemetryRingBuffer();
    buffer.push(sample({ sampledAtMs: 1000 }));
    buffer.push(sample({ sampledAtMs: 2000, position: { lat: 51, lon: 10, altMsl: 600, relativeAlt: 220, headingDeg: 20, groundCourseDeg: 20 } }));

    const hit = buffer.lookup(2500);
    expect(hit.interpolated).toBe(false);
    expect(hit.state?.position.lat).toBe(51);
    expect(hit.trailingGapMs).toBe(500);
    expect(hit.ageMs).toBe(500);
  });

  it("holds oldest sample when query time is before retention", () => {
    const buffer = new TelemetryRingBuffer();
    buffer.push(sample({ sampledAtMs: 1000, position: { lat: 50, lon: 10, altMsl: 500, relativeAlt: 120, headingDeg: 0, groundCourseDeg: 0 } }));
    buffer.push(sample({ sampledAtMs: 2000 }));

    const hit = buffer.lookup(500);
    expect(hit.interpolated).toBe(false);
    expect(hit.state?.position.lat).toBe(50);
    expect(hit.ageMs).toBe(500);
  });

  it("clears retained snapshots", () => {
    const buffer = new TelemetryRingBuffer();
    buffer.push(sample({ sampledAtMs: 1000 }));
    buffer.clear();
    expect(buffer.lookup(1000).state).toBeNull();
  });
});
