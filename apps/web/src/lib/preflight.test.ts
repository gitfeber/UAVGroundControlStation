import type { TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { evaluatePreflightHealth, type PreflightCheckId, type PreflightHealth } from "./preflight";

const NOW = 1_000_000;

/** A fully-healthy telemetry snapshot; override fields per test. */
function goodTelemetry(overrides: DeepOverrides = {}): TelemetryState {
  const base: TelemetryState = {
    connected: true,
    lastPacketAt: NOW - 500,
    sampledAtMs: NOW - 500,
    packetCount: 42,
    vehicle: {
      systemId: 1,
      componentId: 1,
      type: "quad",
      armed: false,
      flightMode: "STABILIZE"
    },
    position: { lat: 47.5, lon: 8.5, altMsl: 500, relativeAlt: 30, headingDeg: 90, groundCourseDeg: 90 },
    gps: { fixType: 3, fixLabel: "3D", satellites: 12, eph: 80, epv: 100 },
    motion: { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
    battery: { voltage: 16.4, current: 1, remainingPercent: 90, consumedMah: 100, cellVoltageEstimate: 4.1 },
    radio: { rssi: 120, remRssi: 120, rxErrors: 0, fixed: 0, txBuffer: 0, linkQuality: 95 },
    system: { loadPercent: 20, sensorsPresent: 0x1f, sensorsEnabled: 0x1f, sensorsHealth: 0x1f, statusText: [] },
    stats: {
      minVoltage: 16,
      maxAltitude: 30,
      maxSpeed: 0,
      maxDistance: 0,
      maxCurrent: 1,
      minRssi: 110,
      warningCount: 0,
      sessionStartedAt: NOW - 10000
    },
    gimbal: null
  };
  return mergeDeep(base, overrides);
}

function check(health: PreflightHealth, id: PreflightCheckId) {
  const found = health.checks.find((c) => c.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe("evaluatePreflightHealth — gate", () => {
  it("returns UNKNOWN with all 7 rows when telemetry is null", () => {
    const health = evaluatePreflightHealth(null, NOW);
    expect(health.status).toBe("UNKNOWN");
    expect(health.summary).toBe("Waiting for telemetry");
    expect(health.checks).toHaveLength(7);
    expect(health.checks.every((c) => c.status === "UNKNOWN")).toBe(true);
  });

  it("gates on packetCount === 0 even with a timestamp", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ packetCount: 0 }), NOW);
    expect(health.status).toBe("UNKNOWN");
  });

  it("gates on lastPacketAt == null", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ lastPacketAt: null }), NOW);
    expect(health.status).toBe("UNKNOWN");
  });
});

describe("evaluatePreflightHealth — happy path", () => {
  it("all-good telemetry is READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry(), NOW, { sourceMode: "live", home: { lat: 47.5, lon: 8.5 } });
    expect(health.status).toBe("READY");
    expect(health.summary).toBe("Ready for flight");
  });
});

describe("evaluatePreflightHealth — GPS", () => {
  it("no fix is NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ gps: { fixType: 0, fixLabel: "No fix" } }), NOW);
    expect(check(health, "gps").status).toBe("NOT_READY");
    expect(health.status).toBe("NOT_READY");
  });

  it("3D fix with 5-7 sats is CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ gps: { satellites: 6 } }), NOW, { home: { lat: 47.5, lon: 8.5 } });
    expect(check(health, "gps").status).toBe("CAUTION");
  });

  it("3D fix with <5 sats is NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ gps: { satellites: 4 } }), NOW);
    expect(check(health, "gps").status).toBe("NOT_READY");
  });

  it("high EPH only downgrades READY to CAUTION, never NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ gps: { satellites: 12, eph: 500 } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    expect(check(health, "gps").status).toBe("CAUTION");
  });
});

describe("evaluatePreflightHealth — battery", () => {
  it("<15% is NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ battery: { remainingPercent: 10 } }), NOW);
    expect(check(health, "battery").status).toBe("NOT_READY");
    expect(health.status).toBe("NOT_READY");
  });

  it("15-24% is CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ battery: { remainingPercent: 20 } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    expect(check(health, "battery").status).toBe("CAUTION");
  });

  it("missing battery level is a blocking CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ battery: { remainingPercent: null } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    const c = check(health, "battery");
    expect(c.status).toBe("CAUTION");
    expect(c.optional).toBeFalsy();
    expect(c.message).toBe("Battery level unavailable");
  });
});

describe("evaluatePreflightHealth — radio", () => {
  it("link quality <40 is NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ radio: { linkQuality: 20 } }), NOW);
    expect(check(health, "radio").status).toBe("NOT_READY");
    expect(health.status).toBe("NOT_READY");
  });

  it("missing link quality is a blocking CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ radio: { linkQuality: null } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    const c = check(health, "radio");
    expect(c.status).toBe("CAUTION");
    expect(c.optional).toBeFalsy();
  });
});

describe("evaluatePreflightHealth — freshness & source mode", () => {
  it("live stale telemetry is NOT_READY", () => {
    const telemetry = goodTelemetry({ lastPacketAt: NOW - 9000 });
    const health = evaluatePreflightHealth(telemetry, NOW, { sourceMode: "live", home: { lat: 47.5, lon: 8.5 } });
    expect(check(health, "telemetry-freshness").status).toBe("NOT_READY");
    expect(health.status).toBe("NOT_READY");
  });

  it("replay stale (virtual) timestamps do NOT force global NOT_READY", () => {
    // Virtual replay time starts near 0, so now - lastPacketAt is huge.
    const telemetry = goodTelemetry({ lastPacketAt: 12 });
    const health = evaluatePreflightHealth(telemetry, NOW, { sourceMode: "replay", home: { lat: 47.5, lon: 8.5 } });
    const fresh = check(health, "telemetry-freshness");
    expect(fresh.status).toBe("UNKNOWN");
    expect(fresh.optional).toBe(true);
    expect(health.status).toBe("READY");
  });
});

describe("evaluatePreflightHealth — home", () => {
  it("no home reference is CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry(), NOW, { home: null });
    expect(check(health, "home").status).toBe("CAUTION");
  });

  it("null island (0,0) is NOT_READY", () => {
    const health = evaluatePreflightHealth(goodTelemetry(), NOW, { home: { lat: 0, lon: 0 } });
    expect(check(health, "home").status).toBe("NOT_READY");
  });
});

describe("evaluatePreflightHealth — optional checks", () => {
  it("missing armed state is optional UNKNOWN and does not block READY", () => {
    // Force armed to a non-boolean to simulate absence.
    const telemetry = goodTelemetry();
    (telemetry.vehicle as { armed: unknown }).armed = undefined;
    const health = evaluatePreflightHealth(telemetry, NOW, { home: { lat: 47.5, lon: 8.5 } });
    const c = check(health, "armed");
    expect(c.status).toBe("UNKNOWN");
    expect(c.optional).toBe(true);
    expect(health.status).toBe("READY");
  });

  it("armed vehicle is CAUTION", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ vehicle: { armed: true } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    expect(check(health, "armed").status).toBe("CAUTION");
  });

  it("missing sensor bitmask is optional UNKNOWN and does not block READY", () => {
    const health = evaluatePreflightHealth(
      goodTelemetry({ system: { sensorsEnabled: undefined, sensorsHealth: undefined } }),
      NOW,
      { home: { lat: 47.5, lon: 8.5 } }
    );
    const c = check(health, "system-health");
    expect(c.status).toBe("UNKNOWN");
    expect(c.optional).toBe(true);
    expect(health.status).toBe("READY");
  });

  it("sensor fault is NOT_READY", () => {
    // enabled bit set, health bit clear -> fault.
    const health = evaluatePreflightHealth(
      goodTelemetry({ system: { sensorsEnabled: 0x1f, sensorsHealth: 0x0f } }),
      NOW
    );
    expect(check(health, "system-health").status).toBe("NOT_READY");
  });
});

describe("evaluatePreflightHealth — aggregation & summary", () => {
  it("picks dominant by fixed priority (battery over gps) and formats summary", () => {
    const telemetry = goodTelemetry({
      battery: { remainingPercent: 5 }, // NOT_READY
      gps: { fixType: 0, fixLabel: "No fix" } // NOT_READY
    });
    const health = evaluatePreflightHealth(telemetry, NOW, { home: { lat: 47.5, lon: 8.5 } });
    expect(health.status).toBe("NOT_READY");
    expect(health.summary.startsWith("Not ready:")).toBe(true);
    // battery has higher summary priority than gps
    expect(health.summary).toContain("Battery critical");
  });

  it("a CAUTION with no NOT_READY yields CAUTION summary", () => {
    const health = evaluatePreflightHealth(goodTelemetry({ battery: { remainingPercent: 20 } }), NOW, {
      home: { lat: 47.5, lon: 8.5 }
    });
    expect(health.status).toBe("CAUTION");
    expect(health.summary.startsWith("Caution:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimal deep-merge test helper (typed loosely on purpose).
// ---------------------------------------------------------------------------

type DeepOverrides = Record<string, unknown>;

function mergeDeep<T>(base: T, overrides: DeepOverrides): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && existing && typeof existing === "object") {
      out[key] = mergeDeep(existing, value as DeepOverrides);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
