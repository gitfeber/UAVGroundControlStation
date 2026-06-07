import type { DeepPartial, NormalizedReplayEvent, TelemetryState } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createEmptyReplayState,
  foldEvents,
  reconstructUpTo
} from "./reconstruct";

function telemetryEvent(index: number, timeMs: number, state: Partial<TelemetryState>): NormalizedReplayEvent {
  return { index, timeMs, type: "telemetry", absoluteTsMs: null, telemetry: state as TelemetryState };
}

function partialEvent(index: number, timeMs: number, patch: DeepPartial<TelemetryState>): NormalizedReplayEvent {
  return { index, timeMs, type: "partialTelemetry", absoluteTsMs: null, patch };
}

describe("applyEvent — full telemetry", () => {
  it("replaces state and fills missing sections from empty defaults", () => {
    const state = applyEvent(
      createEmptyReplayState(),
      telemetryEvent(0, 0, { packetCount: 3, position: { lat: 10, lon: 20 } as TelemetryState["position"] })
    );
    expect(state.packetCount).toBe(3);
    expect(state.position.lat).toBe(10);
    expect(state.battery.voltage).toBeNull(); // missing section filled from defaults
  });

  it("drops NaN/Infinity and out-of-range GPS during full replace", () => {
    const state = applyEvent(
      createEmptyReplayState(),
      telemetryEvent(0, 0, {
        position: { lat: 200, lon: NaN, altMsl: Infinity, relativeAlt: 5 } as TelemetryState["position"]
      })
    );
    expect(state.position.lat).toBeNull(); // 200 out of range -> dropped, stays default null
    expect(state.position.lon).toBeNull(); // NaN dropped
    expect(state.position.altMsl).toBeNull(); // Infinity dropped
    expect(state.position.relativeAlt).toBe(5);
  });
});

describe("applyEvent — partial merge", () => {
  it("merges patch without wiping existing fields", () => {
    let state = applyEvent(
      createEmptyReplayState(),
      telemetryEvent(0, 0, {
        battery: { voltage: 16.8, remainingPercent: 100 } as TelemetryState["battery"],
        position: { lat: 1, lon: 2 } as TelemetryState["position"]
      })
    );
    state = applyEvent(state, partialEvent(1, 100, { battery: { voltage: 16.2 } }));
    expect(state.battery.voltage).toBe(16.2); // updated
    expect(state.battery.remainingPercent).toBe(100); // preserved
    expect(state.position.lat).toBe(1); // untouched section preserved
  });

  it("ignores invalid values in a patch (keeps prior good value)", () => {
    let state = applyEvent(
      createEmptyReplayState(),
      telemetryEvent(0, 0, { position: { lat: 47, lon: 8 } as TelemetryState["position"] })
    );
    state = applyEvent(state, partialEvent(1, 100, { position: { lat: 999, lon: NaN as unknown as number } }));
    expect(state.position.lat).toBe(47); // 999 out of range -> ignored
    expect(state.position.lon).toBe(8); // NaN -> ignored
  });

  it("does not crash on unknown fields in a patch", () => {
    const state = applyEvent(
      createEmptyReplayState(),
      partialEvent(0, 0, { somethingNew: { nested: true } } as unknown as DeepPartial<TelemetryState>)
    );
    expect((state as unknown as Record<string, unknown>).somethingNew).toEqual({ nested: true });
  });
});

describe("foldEvents — controlled track", () => {
  const events: NormalizedReplayEvent[] = [
    telemetryEvent(0, 0, { position: { lat: 47.0, lon: 8.0 } as TelemetryState["position"] }),
    partialEvent(1, 100, { position: { lat: 47.0, lon: 8.0 } }), // duplicate position
    partialEvent(2, 200, { position: { lat: 47.001, lon: 8.001 } }),
    partialEvent(3, 300, { battery: { voltage: 15 } }), // position unchanged -> duplicate point
    partialEvent(4, 400, { position: { lat: 47.002, lon: 8.002 } }),
    partialEvent(5, 500, { position: { lat: 999, lon: 999 } }) // both invalid -> position unchanged
  ];

  it("builds a deduplicated track of valid points", () => {
    const { track } = reconstructUpTo(events);
    expect(track).toEqual([
      { lat: 47.0, lon: 8.0, timestampMs: 0 },
      { lat: 47.001, lon: 8.001, timestampMs: 200 },
      { lat: 47.002, lon: 8.002, timestampMs: 400 }
    ]);
  });

  it("is deterministic — same events produce the same track every time", () => {
    expect(reconstructUpTo(events).track).toEqual(reconstructUpTo(events).track);
  });

  it("reconstructs a fully deterministic state with no wall-clock leakage", () => {
    // Regression guard: createEmptyTelemetryState() seeds sessionStartedAt with
    // Date.now(); reconstruction must override it with a stable 0 so repeated
    // rebuilds are byte-identical regardless of timing.
    expect(createEmptyReplayState().stats.sessionStartedAt).toBe(0);
    expect(reconstructUpTo(events).state).toEqual(reconstructUpTo(events).state);
    expect(reconstructUpTo(events).state.stats.sessionStartedAt).toBe(0);
  });

  it("seeking forward then backward reconstructs identical state and track", () => {
    const forward = reconstructUpTo(events.slice(0, 5));
    const backThenForward = reconstructUpTo(events.slice(0, 5));
    expect(backThenForward.state).toEqual(forward.state);
    expect(backThenForward.track).toEqual(forward.track);
  });

  it("incremental fold matches a full rebuild (no track duplication)", () => {
    const upToTwo = reconstructUpTo(events.slice(0, 3));
    const incremental = foldEvents(upToTwo.state, upToTwo.track, events.slice(3));
    const full = reconstructUpTo(events);
    expect(incremental.track).toEqual(full.track);
    expect(incremental.state).toEqual(full.state);
  });
});
