import { describe, expect, it } from "vitest";
import { canOfferLogReplayHandoff, fileNameFromLogPath, jsonlByteLength } from "./logReplayHandoff";

describe("canOfferLogReplayHandoff", () => {
  it("offers cloud handoff when the session buffer has events", () => {
    expect(
      canOfferLogReplayHandoff({
        runtimeMode: "cloud",
        loggingActive: false,
        loggingFilePath: null,
        sessionEventCount: 12,
        liveControlsLocked: false
      })
    ).toBe(true);
  });

  it("offers desktop handoff after disk logging stops", () => {
    expect(
      canOfferLogReplayHandoff({
        runtimeMode: "desktop",
        loggingActive: false,
        loggingFilePath: "/tmp/flight-2026.jsonl",
        sessionEventCount: 0,
        liveControlsLocked: false
      })
    ).toBe(true);
  });

  it("hides handoff while replay controls the dashboard", () => {
    expect(
      canOfferLogReplayHandoff({
        runtimeMode: "desktop",
        loggingActive: false,
        loggingFilePath: "/tmp/flight-2026.jsonl",
        sessionEventCount: 0,
        liveControlsLocked: true
      })
    ).toBe(false);
  });
});

describe("fileNameFromLogPath", () => {
  it("uses the final path segment", () => {
    expect(fileNameFromLogPath("/var/logs/flight-2026.jsonl")).toBe("flight-2026.jsonl");
    expect(fileNameFromLogPath("C:\\logs\\flight-2026.jsonl")).toBe("flight-2026.jsonl");
  });
});

describe("jsonlByteLength", () => {
  it("matches Blob byte length", () => {
    const text = '{"type":"telemetry"}\n';
    expect(jsonlByteLength(text)).toBe(new Blob([text]).size);
  });
});
