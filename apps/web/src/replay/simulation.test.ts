import type { SimulationOptions } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { reconstructUpTo } from "./reconstruct";
import {
  DEFAULT_SIMULATION_OPTIONS,
  generateSimulationEvents,
  generateSimulationMetadata
} from "./simulation";

function options(overrides: Partial<SimulationOptions> = {}): SimulationOptions {
  return { ...DEFAULT_SIMULATION_OPTIONS, durationMs: 10_000, rateHz: 20, ...overrides };
}

describe("generateSimulationEvents — determinism", () => {
  it("produces byte-identical events for the same seed and options", () => {
    const a = generateSimulationEvents(options({ seed: 42 }));
    const b = generateSimulationEvents(options({ seed: 42 }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("produces different paths for different seeds", () => {
    const a = generateSimulationEvents(options({ seed: 1 }));
    const b = generateSimulationEvents(options({ seed: 2 }));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("uses no wall clock — every absoluteTsMs is null and the timeline starts at 0", () => {
    const events = generateSimulationEvents(options());
    expect(events.every((e) => e.absoluteTsMs === null)).toBe(true);
    expect(events[0]?.timeMs).toBe(0);
    expect(events[0]?.type).toBe("telemetry");
  });
});

describe("generateSimulationEvents — shape and rate", () => {
  it("emits one full telemetry seed plus ~rate*duration partial ticks", () => {
    const events = generateSimulationEvents(options({ durationMs: 1000, rateHz: 20 }));
    const telemetry = events.filter((e) => e.type === "telemetry");
    const partials = events.filter((e) => e.type === "partialTelemetry");
    expect(telemetry).toHaveLength(1);
    expect(partials).toHaveLength(20); // 20 ticks after the seed at 20 Hz over 1s
    expect(events.map((e) => e.timeMs)).toEqual([...events.map((e) => e.timeMs)].sort((x, y) => x - y));
  });

  it("reconstructs into a valid telemetry state with a non-empty track", () => {
    const events = generateSimulationEvents(options());
    const { state, track } = reconstructUpTo(events);
    expect(state.connected).toBe(true);
    expect(state.vehicle.armed).toBe(true);
    expect(typeof state.position.lat).toBe("number");
    expect(track.length).toBeGreaterThan(1);
  });
});

describe("generateSimulationEvents — scenarios", () => {
  it("gpsDegradation drops the fix below 3D and emits a GPS warning", () => {
    const events = generateSimulationEvents(options({ scenario: "gpsDegradation", durationMs: 5 * 60_000 }));
    const { state } = reconstructUpTo(events);
    expect(state.gps.fixType).toBeLessThan(3);
    expect(events.some((e) => e.type === "activity" && e.activity?.message.includes("GPS"))).toBe(true);
  });

  it("lowBatteryApproach drains the battery and emits a low-battery warning", () => {
    const events = generateSimulationEvents(options({ scenario: "lowBatteryApproach", durationMs: 5 * 60_000 }));
    const { state } = reconstructUpTo(events);
    expect(state.battery.voltage).toBeLessThan(14.4);
    expect(events.some((e) => e.type === "activity" && e.activity?.message.toLowerCase().includes("battery"))).toBe(true);
  });

  it("weakRadioLink degrades RSSI below the nominal baseline", () => {
    const weak = reconstructUpTo(generateSimulationEvents(options({ scenario: "weakRadioLink", durationMs: 60_000 }))).state;
    const nominal = reconstructUpTo(generateSimulationEvents(options({ scenario: "nominalFlight", durationMs: 60_000 }))).state;
    expect(weak.radio.rssi ?? 0).toBeLessThan(nominal.radio.rssi ?? 0);
  });
});

describe("generateSimulationMetadata", () => {
  it("summarizes counts and marks the synthetic source", () => {
    const opts = options();
    const events = generateSimulationEvents(opts);
    const metadata = generateSimulationMetadata(opts, events);
    expect(metadata.fileName).toBe("Simulation: Nominal flight");
    expect(metadata.eventCount).toBe(events.length);
    expect(metadata.telemetryEventCount).toBe(1);
    expect(metadata.hasGps).toBe(true);
    expect(metadata.firstTimestampMs).toBeNull();
  });
});
