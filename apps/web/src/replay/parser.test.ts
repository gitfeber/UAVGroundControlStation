import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReplayLog, ReplayParseError } from "./parser";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
}

describe("parseReplayLog — JSONL schema v1", () => {
  const result = parseReplayLog(fixture("basic-flight.jsonl"), "basic-flight.jsonl", 1234);

  it("parses every usable event and ignores comment lines", () => {
    // 2 activity, 1 telemetry, 3 partialTelemetry, 1 diagnostic = 7 events.
    expect(result.events).toHaveLength(7);
    expect(result.metadata.eventCount).toBe(7);
    expect(result.metadata.telemetryEventCount).toBe(1);
    expect(result.metadata.partialTelemetryEventCount).toBe(3);
    expect(result.metadata.activityEventCount).toBe(2);
    expect(result.metadata.diagnosticEventCount).toBe(1);
  });

  it("preserves event order and resolves a monotonic relative timeline", () => {
    expect(result.events.map((e) => e.timeMs)).toEqual([0, 0, 1000, 2000, 3000, 4000, 5000]);
    expect(result.events.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("computes metadata flags and duration", () => {
    expect(result.metadata.durationMs).toBe(5000);
    expect(result.metadata.firstTimestampMs).toBe(1710000000000);
    expect(result.metadata.lastTimestampMs).toBe(1710000005000);
    expect(result.metadata.hasGps).toBe(true);
    expect(result.metadata.hasBattery).toBe(true);
    expect(result.metadata.hasRadio).toBe(true);
    expect(result.metadata.hasAttitude).toBe(true);
    expect(result.metadata.schemaVersion).toBeUndefined(); // JSONL lines, no manifest-level version.
  });

  it("attaches typed payloads to normalized events", () => {
    const telemetry = result.events.find((e) => e.type === "telemetry");
    expect(telemetry?.telemetry?.position?.lat).toBe(47.0);
    const activity = result.events.find((e) => e.type === "activity");
    expect(activity?.activity?.message).toBe("Telemetry started");
    const diagnostic = result.events.find((e) => e.type === "diagnostic");
    expect(diagnostic?.stats?.rawBytes).toBe(40960);
  });
});

describe("parseReplayLog — JSON manifest", () => {
  const result = parseReplayLog(fixture("manifest.json"), "manifest.json", 999);

  it("reads events from the manifest array and the declared schema version", () => {
    expect(result.events).toHaveLength(3);
    expect(result.metadata.schemaVersion).toBe(1);
    expect(result.events.map((e) => e.type)).toEqual(["telemetry", "marker", "partialTelemetry"]);
    expect(result.events.map((e) => e.timeMs)).toEqual([0, 500, 1000]);
  });

  it("captures marker payloads", () => {
    const marker = result.events.find((e) => e.type === "marker");
    expect(marker?.marker?.label).toBe("Takeoff");
  });
});

describe("parseReplayLog — legacy {time,type,data}", () => {
  const result = parseReplayLog(fixture("legacy-flight.jsonl"), "legacy-flight.jsonl", 500);

  it("maps legacy data onto telemetry state and uses time as the timeline", () => {
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.type === "telemetry")).toBe(true);
    expect(result.events.map((e) => e.timeMs)).toEqual([0, 1000]);
    expect(result.events[0]?.telemetry?.vehicle?.type).toBe("Plane");
    expect(result.metadata.firstTimestampMs).toBe(1710000000000);
  });
});

describe("parseReplayLog — plain TelemetryState lines", () => {
  it("treats bare telemetry-shaped objects as full telemetry events", () => {
    const line = JSON.stringify({
      connected: true,
      packetCount: 5,
      position: { lat: 10, lon: 20 },
      battery: { voltage: 12 }
    });
    const result = parseReplayLog(`${line}\n${line}`, "plain.jsonl", 100);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.type).toBe("telemetry");
    // No timestamps anywhere → synthetic 20 Hz timeline.
    expect(result.events.map((e) => e.timeMs)).toEqual([0, 50]);
  });
});

describe("parseReplayLog — robustness", () => {
  it("skips malformed lines and counts them as warnings", () => {
    const text = [
      "not json at all",
      '{"type":"telemetry","state":{"position":{"lat":1,"lon":2}}}',
      "{ broken json",
      ""
    ].join("\n");
    const result = parseReplayLog(text, "messy.jsonl", 100);
    expect(result.events).toHaveLength(1);
    expect(result.metadata.parseWarningCount).toBeGreaterThanOrEqual(2);
    expect(result.metadata.skippedEventCount).toBeGreaterThanOrEqual(2);
  });

  it("skips unknown event types without throwing", () => {
    const text = [
      '{"type":"weatherReport","temp":20}',
      '{"type":"telemetry","state":{"position":{"lat":1,"lon":2}}}'
    ].join("\n");
    const result = parseReplayLog(text, "unknown.jsonl", 100);
    expect(result.events).toHaveLength(1);
    expect(result.metadata.skippedEventCount).toBe(1);
  });

  it("throws ReplayParseError when there are no usable events", () => {
    expect(() => parseReplayLog("\n# comment only\n", "empty.jsonl", 0)).toThrow(ReplayParseError);
    expect(() => parseReplayLog('{"type":"unknownOnly"}', "x.jsonl", 0)).toThrow(ReplayParseError);
  });

  it("does not reorder non-monotonic timestamps", () => {
    const text = [
      '{"ts":1000,"type":"telemetry","state":{"position":{"lat":1,"lon":2}}}',
      '{"ts":500,"type":"telemetry","state":{"position":{"lat":3,"lon":4}}}'
    ].join("\n");
    const result = parseReplayLog(text, "backwards.jsonl", 100);
    // First event anchors the timeline at 0; the second resolves to -500 (not reordered).
    expect(result.events.map((e) => e.timeMs)).toEqual([0, -500]);
  });

  it("assigns synthetic 20 Hz timeline when no timestamps are present", () => {
    const text = Array.from({ length: 4 }, () =>
      '{"type":"telemetry","state":{"position":{"lat":1,"lon":2}}}'
    ).join("\n");
    const result = parseReplayLog(text, "notime.jsonl", 100);
    expect(result.events.map((e) => e.timeMs)).toEqual([0, 50, 100, 150]);
  });
});
