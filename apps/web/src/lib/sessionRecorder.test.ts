import { describe, expect, it } from "vitest";
import { createEmptyTelemetryState } from "./initialTelemetry";
import { parseReplayLog } from "../replay/parser";
import { SessionRecorder, SESSION_BUFFER_SOFT_WARN_BYTES } from "./sessionRecorder";

describe("SessionRecorder", () => {
  it("emits replay-compatible JSONL with activity and telemetry events", () => {
    const recorder = new SessionRecorder(20);
    recorder.recordActivity("info", "Serial port opened.");
    recorder.recordTelemetry(createEmptyTelemetryState(), 1_000);
    recorder.recordTelemetry(createEmptyTelemetryState(), 1_010);

    const parsed = parseReplayLog(recorder.toJsonlText(), "session.jsonl", recorder.snapshot.approximateBytes);
    expect(parsed.events.some((event) => event.type === "activity")).toBe(true);
    expect(parsed.events.some((event) => event.type === "telemetry")).toBe(true);
    expect(parsed.events.filter((event) => event.type === "telemetry")).toHaveLength(1);
  });

  it("clears buffered events on reset", () => {
    const recorder = new SessionRecorder();
    recorder.recordActivity("info", "Connected.");
    expect(recorder.hasBufferedEvents()).toBe(true);
    recorder.clear();
    expect(recorder.hasBufferedEvents()).toBe(false);
    expect(recorder.snapshot.eventCount).toBe(0);
  });

  it("flags soft warn when buffer exceeds ADR threshold", () => {
    const recorder = new SessionRecorder();
    const bigMessage = "x".repeat(SESSION_BUFFER_SOFT_WARN_BYTES);
    recorder.recordActivity("info", bigMessage);
    expect(recorder.snapshot.softWarnExceeded).toBe(true);
  });
});
