import type { NormalizedReplayEvent } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import {
  type SchedulerConfig,
  advanceTo,
  eventVirtualTimeMs,
  reset,
  seekTo,
  stepOnce,
  totalDurationMs
} from "./scheduler";

/** Build a synthetic telemetry event at a given relative time. */
function ev(index: number, timeMs: number): NormalizedReplayEvent {
  return { index, timeMs, type: "telemetry", absoluteTsMs: null };
}

// 6 events at 0,100,250,250,400,1000 (note the duplicate timestamp at 250).
const events: NormalizedReplayEvent[] = [
  ev(0, 0),
  ev(1, 100),
  ev(2, 250),
  ev(3, 250),
  ev(4, 400),
  ev(5, 1000)
];

const original: SchedulerConfig = { timingMode: "original", fixedRateHz: 20 };

describe("totalDurationMs / eventVirtualTimeMs", () => {
  it("uses the last event time in original mode", () => {
    expect(totalDurationMs(events, original)).toBe(1000);
  });

  it("maps event index to a fixed cadence in fixedRate mode", () => {
    const config: SchedulerConfig = { timingMode: "fixedRate", fixedRateHz: 10 };
    expect(eventVirtualTimeMs(events[2] as NormalizedReplayEvent, 2, config)).toBe(200);
    expect(totalDurationMs(events, config)).toBe(500); // 5 * 100ms
  });
});

describe("advanceTo — original timing", () => {
  it("emits all events whose time is <= virtual time", () => {
    const result = advanceTo(events, original, { cursor: 0, currentTimeMs: 0 }, 250);
    expect(result.eventsToApply.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(result.cursor).toBe(4);
    expect(result.currentEventIndex).toBe(3);
    expect(result.currentReplayTimeMs).toBe(250);
    expect(result.ended).toBe(false);
  });

  it("does not re-emit already-applied events on the next call", () => {
    const first = advanceTo(events, original, { cursor: 0, currentTimeMs: 0 }, 100);
    expect(first.eventsToApply.map((e) => e.index)).toEqual([0, 1]);
    const second = advanceTo(
      events,
      original,
      { cursor: first.cursor, currentTimeMs: first.currentReplayTimeMs },
      400
    );
    expect(second.eventsToApply.map((e) => e.index)).toEqual([2, 3, 4]);
  });

  it("clamps replay time to duration and flags ended at the end", () => {
    const result = advanceTo(events, original, { cursor: 0, currentTimeMs: 0 }, 999999);
    expect(result.cursor).toBe(events.length);
    expect(result.currentReplayTimeMs).toBe(1000);
    expect(result.ended).toBe(true);
  });
});

describe("advanceTo — fixedRate timing", () => {
  const config: SchedulerConfig = { timingMode: "fixedRate", fixedRateHz: 10 }; // 100ms spacing

  it("ignores original gaps and emits by index cadence", () => {
    const result = advanceTo(events, config, { cursor: 0, currentTimeMs: 0 }, 200);
    // indices 0,1,2 map to 0,100,200 <= 200
    expect(result.eventsToApply.map((e) => e.index)).toEqual([0, 1, 2]);
  });
});

describe("advanceTo — manual timing", () => {
  it("is a no-op; only stepOnce advances", () => {
    const result = advanceTo(
      events,
      { timingMode: "manual", fixedRateHz: 20 },
      { cursor: 1, currentTimeMs: 100 },
      999999
    );
    expect(result.eventsToApply).toHaveLength(0);
    expect(result.cursor).toBe(1);
  });
});

describe("advanceTo — max timing", () => {
  it("consumes capped chunks per call and always finishes on the last event", () => {
    const config: SchedulerConfig = { timingMode: "max", fixedRateHz: 20, maxEventsPerChunk: 2 };
    const first = advanceTo(events, config, { cursor: 0, currentTimeMs: 0 }, 0);
    expect(first.eventsToApply.map((e) => e.index)).toEqual([0, 1]);
    expect(first.ended).toBe(false);

    const second = advanceTo(events, config, { cursor: first.cursor, currentTimeMs: first.currentReplayTimeMs }, 0);
    expect(second.eventsToApply.map((e) => e.index)).toEqual([2, 3]);

    const third = advanceTo(events, config, { cursor: second.cursor, currentTimeMs: second.currentReplayTimeMs }, 0);
    expect(third.eventsToApply.map((e) => e.index)).toEqual([4, 5]);
    expect(third.ended).toBe(true);
    expect(third.currentReplayTimeMs).toBe(1000);
  });
});

describe("stepOnce", () => {
  it("advances exactly one event at a time", () => {
    const first = stepOnce(events, original, { cursor: 0, currentTimeMs: 0 });
    expect(first.eventsToApply.map((e) => e.index)).toEqual([0]);
    expect(first.cursor).toBe(1);
    expect(first.currentReplayTimeMs).toBe(0);

    const second = stepOnce(events, original, { cursor: first.cursor, currentTimeMs: first.currentReplayTimeMs });
    expect(second.eventsToApply.map((e) => e.index)).toEqual([1]);
    expect(second.currentReplayTimeMs).toBe(100);
  });

  it("is idempotent at the end (step at end emits nothing)", () => {
    const result = stepOnce(events, original, { cursor: events.length, currentTimeMs: 1000 });
    expect(result.eventsToApply).toHaveLength(0);
    expect(result.ended).toBe(true);
  });
});

describe("seekTo", () => {
  it("rebuilds from the start so state can be reconstructed deterministically", () => {
    const result = seekTo(events, original, 250);
    expect(result.eventsToApply.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(result.currentReplayTimeMs).toBe(250);
  });

  it("produces identical output for the same target (determinism)", () => {
    const a = seekTo(events, original, 400);
    const b = seekTo(events, original, 400);
    expect(a.eventsToApply.map((e) => e.index)).toEqual(b.eventsToApply.map((e) => e.index));
  });

  it("clamps seeks before start and after end", () => {
    const before = seekTo(events, original, -500);
    expect(before.eventsToApply.map((e) => e.index)).toEqual([0]); // event at t=0
    expect(before.currentReplayTimeMs).toBe(0);

    const after = seekTo(events, original, 999999);
    expect(after.eventsToApply).toHaveLength(events.length);
    expect(after.currentReplayTimeMs).toBe(1000);
    expect(after.ended).toBe(true);
  });
});

describe("reset", () => {
  it("returns a clean start position", () => {
    expect(reset()).toEqual({
      eventsToApply: [],
      currentEventIndex: -1,
      currentReplayTimeMs: 0,
      cursor: 0,
      ended: false
    });
  });
});
