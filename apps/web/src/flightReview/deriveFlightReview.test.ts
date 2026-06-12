import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DeepPartial, NormalizedReplayEvent, TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { parseReplayLog } from "../replay/parser";
import { createEmptyReplayState } from "../replay/reconstruct";
import {
  computeGpsQualityScore,
  DEFAULT_FLIGHT_REVIEW_THRESHOLDS,
  deriveFlightReview
} from "./deriveFlightReview";
import { MAX_GRAPH_POINTS, MAX_PATH_VERTICES } from "./flightReviewTypes";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../replay/__fixtures__/${name}`, import.meta.url)), "utf8");
}

function baseState(overrides: DeepPartial<TelemetryState> = {}): TelemetryState {
  const empty = createEmptyReplayState();
  return {
    ...empty,
    connected: true,
    lastPacketAt: 0,
    packetCount: 1,
    vehicle: { ...empty.vehicle, armed: false, flightMode: "Stabilize", ...overrides.vehicle },
    position: {
      ...empty.position,
      lat: 47.0,
      lon: 8.0,
      relativeAlt: 0,
      altMsl: 500,
      ...overrides.position
    },
    gps: {
      ...empty.gps,
      fixType: 3,
      fixLabel: "3D Fix",
      satellites: 12,
      eph: 80,
      ...overrides.gps
    },
    motion: { ...empty.motion, groundSpeed: 0, ...overrides.motion },
    battery: {
      ...empty.battery,
      voltage: 16.8,
      remainingPercent: 100,
      ...overrides.battery
    },
    radio: { ...empty.radio, linkQuality: 100, rssi: -60, ...overrides.radio },
    ...overrides
  } as TelemetryState;
}

function telemetry(index: number, timeMs: number, state: TelemetryState): NormalizedReplayEvent {
  return { index, timeMs, type: "telemetry", absoluteTsMs: null, telemetry: state };
}

function partial(index: number, timeMs: number, patch: DeepPartial<TelemetryState>): NormalizedReplayEvent {
  return { index, timeMs, type: "partialTelemetry", absoluteTsMs: null, patch };
}

describe("deriveFlightReview — basic-flight.jsonl fixture", () => {
  const parsed = parseReplayLog(fixture("basic-flight.jsonl"), "basic-flight.jsonl", 1234);
  const review = deriveFlightReview(parsed.events, {}, parsed.metadata);

  it("produces a stable summary recomputed from the telemetry stream", () => {
    expect(review.summary.telemetrySampleCount).toBe(4);
    expect(review.summary.durationMs).toBe(4000);
    expect(review.summary.sessionHome).toEqual({ lat: 47.0, lon: 8.0, timeMs: 0 });
    expect(review.summary.maxAltitudeM).toBe(40);
    expect(review.summary.maxSpeedMps).toBe(12);
    expect(review.summary.minVoltageV).toBe(15.9);
    expect(review.summary.telemetryGapCount).toBe(0);
    expect(review.summary.flightModeChanges).toBe(1);
  });

  it("emits expected flight-edge findings and timeline markers", () => {
    expect(review.findings).toHaveLength(3);
    expect(review.findings.map((f) => f.title)).toEqual([
      "Armed",
      "Flight mode changed",
      "Session max altitude"
    ]);
    expect(review.metadata.timelineMarkerCount).toBe(3);
    expect(review.findings.every((f) => f.showOnTimeline)).toBe(true);
  });

  it("caps render outputs while retaining full-fidelity stats", () => {
    expect(review.fullStats.samples).toHaveLength(4);
    expect(review.renderPath.length).toBeLessThanOrEqual(MAX_PATH_VERTICES);
    expect(review.renderSeries.altitude.length).toBeLessThanOrEqual(MAX_GRAPH_POINTS);
    expect(review.renderSeries.gps.length).toBeLessThanOrEqual(MAX_GRAPH_POINTS);
    expect(review.pathColorModes).toContain("logGap");
  });
});

describe("deriveFlightReview — stale telemetry gap", () => {
  it("warns when consecutive log timestamps exceed telemetryMaxAgeMs", () => {
    const events = [
      telemetry(0, 0, baseState()),
      partial(1, 4000, { battery: { voltage: 16.0 } })
    ];
    const review = deriveFlightReview(events, { telemetryMaxAgeMs: 3000 });
    const gap = review.findings.find((f) => f.category === "telemetry");
    expect(gap?.severity).toBe("warn");
    expect(gap?.detail).toBe("No telemetry log entry for 4000 ms");
    expect(gap?.durationMs).toBe(4000);
    expect(review.summary.telemetryGapCount).toBe(1);
  });
});

describe("deriveFlightReview — battery floor", () => {
  it("warns on low voltage span", () => {
    const events = [
      telemetry(0, 0, baseState({ battery: { voltage: 16.0, remainingPercent: 80 } })),
      partial(1, 1000, { battery: { voltage: 10.0 } }),
      partial(2, 2000, { battery: { voltage: 10.2 } }),
      partial(3, 3000, { battery: { voltage: 16.0 } })
    ];
    const review = deriveFlightReview(events);
    const low = review.findings.filter((f) => f.category === "battery" && f.title === "Low battery voltage");
    expect(low).toHaveLength(1);
    expect(low[0]?.durationMs).toBe(2000);
  });

  it("uses percent fallback when voltage is missing", () => {
    const events = [
      telemetry(0, 0, baseState({ battery: { voltage: null, remainingPercent: 20 } })),
      partial(1, 1000, { battery: { voltage: null, remainingPercent: 10 } })
    ];
    const review = deriveFlightReview(events, { minBatteryPercent: 15 });
    expect(review.findings.some((f) => f.title === "Low battery voltage")).toBe(true);
  });
});

describe("deriveFlightReview — battery sag", () => {
  it("warns when voltage drops by batterySagDeltaVoltage within the sag window", () => {
    const events = [
      telemetry(0, 0, baseState({ battery: { voltage: 16.0 } })),
      partial(1, 5000, { battery: { voltage: 14.8 } })
    ];
    const review = deriveFlightReview(events, { batterySagDeltaVoltage: 1.0, batterySagWindowMs: 30_000 });
    const sag = review.findings.find((f) => f.title === "Battery voltage sag");
    expect(sag?.severity).toBe("warn");
    expect(sag?.detail).toContain("1.2 V");
  });
});

describe("deriveFlightReview — GPS degrade and recover", () => {
  it("emits warn on degrade and info on recover", () => {
    const events = [
      telemetry(0, 0, baseState({ gps: { fixType: 3, satellites: 12, eph: 80 } })),
      partial(1, 1000, { gps: { fixType: 2, satellites: 4, eph: 300 } }),
      partial(2, 2000, { gps: { fixType: 3, satellites: 10, eph: 90 } })
    ];
    const review = deriveFlightReview(events);
    const degraded = review.findings.find((f) => f.title === "GPS degraded");
    const recovered = review.findings.find((f) => f.title === "GPS recovered");
    expect(degraded?.severity).toBe("warn");
    expect(recovered?.severity).toBe("info");
    expect(review.findings.some((f) => f.title === "GPS fix type changed")).toBe(true);
  });
});

describe("deriveFlightReview — radio degrade and recover", () => {
  it("uses link quality only", () => {
    const events = [
      telemetry(0, 0, baseState({ radio: { linkQuality: 80, rssi: -50 } })),
      partial(1, 1000, { radio: { linkQuality: 30, rssi: -50 } }),
      partial(2, 2000, { radio: { linkQuality: 75, rssi: -90 } })
    ];
    const review = deriveFlightReview(events, { minLinkQuality: 40 });
    const radio = review.findings.filter((f) => f.category === "radio");
    expect(radio.map((f) => f.title)).toEqual([
      "Link quality degraded",
      "Link quality recovered"
    ]);
  });
});

describe("deriveFlightReview — armed and flight mode edges", () => {
  it("reports armed/disarmed transitions", () => {
    const events = [
      telemetry(0, 0, baseState({ vehicle: { armed: false } })),
      partial(1, 1000, { vehicle: { armed: true } }),
      partial(2, 2000, { vehicle: { armed: false } })
    ];
    const review = deriveFlightReview(events);
    expect(review.findings.filter((f) => f.title === "Armed" || f.title === "Disarmed").map((f) => f.title)).toEqual([
      "Armed",
      "Disarmed"
    ]);
  });

  it("reports flight mode changes on edge only", () => {
    const events = [
      telemetry(0, 0, baseState({ vehicle: { flightMode: "Stabilize" } })),
      partial(1, 1000, { vehicle: { flightMode: "Auto" } }),
      partial(2, 2000, { vehicle: { flightMode: "Auto" } })
    ];
    const review = deriveFlightReview(events);
    expect(review.findings.filter((f) => f.title === "Flight mode changed")).toHaveLength(1);
  });
});

describe("deriveFlightReview — max altitude", () => {
  it("emits one info finding at the first new session maximum above zero", () => {
    const events = [
      telemetry(0, 0, baseState({ position: { relativeAlt: 0 } })),
      partial(1, 1000, { position: { relativeAlt: 20 } }),
      partial(2, 2000, { position: { relativeAlt: 50 } })
    ];
    const review = deriveFlightReview(events);
    const maxAlt = review.findings.filter((f) => f.title === "Session max altitude");
    expect(maxAlt).toHaveLength(1);
    expect(maxAlt[0]?.timeMs).toBe(1000);
    expect(maxAlt[0]?.detail).toBe("20.0 m");
  });
});

describe("computeGpsQualityScore", () => {
  it("aligns with preflight-style GPS tiers", () => {
    const ready = baseState({ gps: { fixType: 3, satellites: 12, eph: 80 } });
    const caution = baseState({ gps: { fixType: 3, satellites: 6, eph: 80 } });
    const bad = baseState({ gps: { fixType: 3, satellites: 3, eph: 80 } });
    expect(computeGpsQualityScore(ready, DEFAULT_FLIGHT_REVIEW_THRESHOLDS)).toBe(90);
    expect(computeGpsQualityScore(caution, DEFAULT_FLIGHT_REVIEW_THRESHOLDS)).toBe(70);
    expect(computeGpsQualityScore(bad, DEFAULT_FLIGHT_REVIEW_THRESHOLDS)).toBe(25);
  });
});
