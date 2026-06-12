import { describe, expect, it } from "vitest";
import { isTelemetryStale, TELEMETRY_STALE_MS } from "./telemetryStaleness";

describe("isTelemetryStale", () => {
  it("treats missing lastPacketAt as stale", () => {
    expect(isTelemetryStale(null, 10_000)).toBe(true);
    expect(isTelemetryStale(undefined, 10_000)).toBe(true);
  });

  it("marks telemetry stale after the threshold", () => {
    const now = 10_000;
    expect(isTelemetryStale(now - TELEMETRY_STALE_MS, now)).toBe(false);
    expect(isTelemetryStale(now - TELEMETRY_STALE_MS - 1, now)).toBe(true);
  });
});
