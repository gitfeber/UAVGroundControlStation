import type {
  DeepPartial,
  NormalizedReplayEvent,
  ReplayEventType,
  ReplayLogMetadata,
  TelemetryState
} from "@uav-ground-control-station/shared";

/**
 * Replay log parser (ADR 0003).
 *
 * Parses untrusted `.jsonl` / `.json` telemetry logs into an ordered list of
 * {@link NormalizedReplayEvent}. The parser is pure and synchronous: callers
 * read the file with `File.text()` and hand the string in here.
 *
 * Robustness rules (see handoff.md "Replay parser requirements"):
 * - ignore empty lines and `#` comment lines
 * - accept `ts`, `timestamp`, or `relativeMs`
 * - preserve event order; never sort non-monotonic timestamps
 * - assign synthetic 20 Hz timestamps when none are present
 * - skip malformed lines (warning++) and unknown event types (skipped++)
 * - support legacy `{time,type,data}` and plain `TelemetryState` lines
 * - never throw on bad field data; only throw when zero usable events exist
 */

const SYNTHETIC_STEP_MS = 50; // 20 Hz default when timestamps are absent.

export class ReplayParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayParseError";
  }
}

export interface ParseReplayLogResult {
  events: NormalizedReplayEvent[];
  metadata: ReplayLogMetadata;
  warnings: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveAbsoluteTs(raw: Record<string, unknown>): number | null {
  if (isFiniteNumber(raw.ts)) return raw.ts;
  if (isFiniteNumber(raw.timestamp)) return raw.timestamp;
  return null;
}

/** Heuristic: does a bare object look like a {@link TelemetryState} payload? */
function looksLikeTelemetryState(value: Record<string, unknown>): boolean {
  return (
    "vehicle" in value ||
    "position" in value ||
    "battery" in value ||
    "motion" in value ||
    "radio" in value ||
    ("connected" in value && "packetCount" in value)
  );
}

interface RawEvent {
  type: ReplayEventType;
  absoluteTsMs: number | null;
  relativeMs: number | null;
  telemetry?: TelemetryState;
  patch?: DeepPartial<TelemetryState>;
  activity?: { level: "debug" | "info" | "warn" | "error"; message: string };
  stats?: Record<string, unknown>;
  marker?: { label: string; description?: string };
}

type ClassifyResult =
  | { kind: "event"; event: RawEvent }
  | { kind: "skip"; reason: string }
  | { kind: "warn"; reason: string };

/** Classify a single parsed JSON object into a {@link RawEvent}. */
function classifyObject(value: Record<string, unknown>): ClassifyResult {
  const absoluteTsMs = resolveAbsoluteTs(value);
  const relativeMs = isFiniteNumber(value.relativeMs) ? value.relativeMs : null;
  const rawType = typeof value.type === "string" ? value.type : undefined;

  // Legacy {time,type,data} support: map `data` onto telemetry `state`.
  const legacyTime = isFiniteNumber(value.time) ? value.time : null;
  const effectiveAbsoluteTs = absoluteTsMs ?? legacyTime;

  switch (rawType) {
    case "telemetry": {
      const state = isObject(value.state) ? value.state : isObject(value.data) ? value.data : null;
      if (!state) return { kind: "warn", reason: "telemetry event missing state" };
      return {
        kind: "event",
        event: {
          type: "telemetry",
          absoluteTsMs: effectiveAbsoluteTs,
          relativeMs,
          telemetry: state as unknown as TelemetryState
        }
      };
    }
    case "partialTelemetry": {
      if (!isObject(value.patch)) return { kind: "warn", reason: "partialTelemetry missing patch" };
      return {
        kind: "event",
        event: {
          type: "partialTelemetry",
          absoluteTsMs: effectiveAbsoluteTs,
          relativeMs,
          patch: value.patch as DeepPartial<TelemetryState>
        }
      };
    }
    case "activity": {
      if (typeof value.message !== "string") {
        return { kind: "warn", reason: "activity event missing message" };
      }
      const level =
        value.level === "debug" || value.level === "warn" || value.level === "error"
          ? value.level
          : "info";
      return {
        kind: "event",
        event: {
          type: "activity",
          absoluteTsMs: effectiveAbsoluteTs,
          relativeMs,
          activity: { level, message: value.message }
        }
      };
    }
    case "diagnostic": {
      const stats = isObject(value.stats) ? value.stats : {};
      return {
        kind: "event",
        event: { type: "diagnostic", absoluteTsMs: effectiveAbsoluteTs, relativeMs, stats }
      };
    }
    case "marker": {
      if (typeof value.label !== "string") {
        return { kind: "warn", reason: "marker event missing label" };
      }
      const marker: { label: string; description?: string } = { label: value.label };
      if (typeof value.description === "string") marker.description = value.description;
      return {
        kind: "event",
        event: { type: "marker", absoluteTsMs: effectiveAbsoluteTs, relativeMs, marker }
      };
    }
    case undefined: {
      // No explicit type. Legacy plain TelemetryState line, best-effort.
      if (looksLikeTelemetryState(value)) {
        return {
          kind: "event",
          event: {
            type: "telemetry",
            absoluteTsMs: effectiveAbsoluteTs,
            relativeMs,
            telemetry: value as unknown as TelemetryState
          }
        };
      }
      return { kind: "skip", reason: "object without recognizable telemetry shape" };
    }
    default:
      return { kind: "skip", reason: `unknown event type "${rawType}"` };
  }
}

/** Extract the raw JSON objects from JSONL text or a JSON manifest. */
function extractRawObjects(text: string, warnings: string[]): {
  objects: unknown[];
  declaredSchemaVersion?: number;
} {
  const trimmed = text.trim();

  // Manifest form: a single JSON object with an `events` array.
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isObject(parsed) && Array.isArray(parsed.events)) {
        const declaredSchemaVersion = isFiniteNumber(parsed.schemaVersion)
          ? parsed.schemaVersion
          : undefined;
        return declaredSchemaVersion === undefined
          ? { objects: parsed.events }
          : { objects: parsed.events, declaredSchemaVersion };
      }
    } catch {
      // Not a whole-document JSON object; fall through to JSONL parsing.
    }
  }

  // JSONL form: one JSON value per non-empty, non-comment line.
  const objects: unknown[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = line.trim();
    if (cleaned.length === 0 || cleaned.startsWith("#")) continue;
    try {
      objects.push(JSON.parse(cleaned));
    } catch {
      warnings.push(`Malformed JSON line skipped: ${cleaned.slice(0, 80)}`);
    }
  }
  return { objects };
}

export function parseReplayLog(
  text: string,
  fileName: string,
  fileSizeBytes: number
): ParseReplayLogResult {
  const warnings: string[] = [];
  const { objects, declaredSchemaVersion } = extractRawObjects(text, warnings);

  let skippedEventCount = warnings.length; // malformed lines already count as skipped.

  const rawEvents: RawEvent[] = [];
  for (const candidate of objects) {
    if (!isObject(candidate)) {
      warnings.push("Non-object entry skipped.");
      skippedEventCount += 1;
      continue;
    }
    const result = classifyObject(candidate);
    if (result.kind === "event") {
      rawEvents.push(result.event);
    } else {
      skippedEventCount += 1;
      if (result.kind === "warn") warnings.push(result.reason);
    }
  }

  if (rawEvents.length === 0) {
    throw new ReplayParseError(
      "No usable telemetry events found in this log. Expected JSONL telemetry events or a JSON manifest with an \"events\" array."
    );
  }

  // Resolve a monotonic replay timeline without reordering events.
  const events: NormalizedReplayEvent[] = [];
  let firstAbsoluteTs: number | null = null;
  let minAbsoluteTs: number | null = null;
  let maxAbsoluteTs: number | null = null;
  let syntheticCursor = 0;

  rawEvents.forEach((raw, index) => {
    if (raw.absoluteTsMs !== null) {
      if (firstAbsoluteTs === null) firstAbsoluteTs = raw.absoluteTsMs;
      minAbsoluteTs = minAbsoluteTs === null ? raw.absoluteTsMs : Math.min(minAbsoluteTs, raw.absoluteTsMs);
      maxAbsoluteTs = maxAbsoluteTs === null ? raw.absoluteTsMs : Math.max(maxAbsoluteTs, raw.absoluteTsMs);
    }

    let timeMs: number;
    if (raw.relativeMs !== null) {
      timeMs = raw.relativeMs;
      syntheticCursor = timeMs + SYNTHETIC_STEP_MS;
    } else if (raw.absoluteTsMs !== null && firstAbsoluteTs !== null) {
      timeMs = raw.absoluteTsMs - firstAbsoluteTs;
      syntheticCursor = timeMs + SYNTHETIC_STEP_MS;
    } else {
      timeMs = syntheticCursor;
      syntheticCursor += SYNTHETIC_STEP_MS;
    }

    const event: NormalizedReplayEvent = {
      index,
      timeMs,
      type: raw.type,
      absoluteTsMs: raw.absoluteTsMs
    };
    if (raw.telemetry !== undefined) event.telemetry = raw.telemetry;
    if (raw.patch !== undefined) event.patch = raw.patch;
    if (raw.activity !== undefined) event.activity = raw.activity;
    if (raw.stats !== undefined) event.stats = raw.stats;
    if (raw.marker !== undefined) event.marker = raw.marker;
    events.push(event);
  });

  const metadata = buildMetadata({
    fileName,
    fileSizeBytes,
    declaredSchemaVersion,
    events,
    skippedEventCount,
    parseWarningCount: warnings.length,
    firstTimestampMs: minAbsoluteTs,
    lastTimestampMs: maxAbsoluteTs
  });

  return { events, metadata, warnings };
}

function buildMetadata(input: {
  fileName: string;
  fileSizeBytes: number;
  declaredSchemaVersion: number | undefined;
  events: NormalizedReplayEvent[];
  skippedEventCount: number;
  parseWarningCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
}): ReplayLogMetadata {
  const { events } = input;
  let telemetryEventCount = 0;
  let partialTelemetryEventCount = 0;
  let activityEventCount = 0;
  let diagnosticEventCount = 0;
  let hasGps = false;
  let hasBattery = false;
  let hasRadio = false;
  let hasAttitude = false;

  let minTimeMs = Number.POSITIVE_INFINITY;
  let maxTimeMs = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    minTimeMs = Math.min(minTimeMs, event.timeMs);
    maxTimeMs = Math.max(maxTimeMs, event.timeMs);

    switch (event.type) {
      case "telemetry":
        telemetryEventCount += 1;
        break;
      case "partialTelemetry":
        partialTelemetryEventCount += 1;
        break;
      case "activity":
        activityEventCount += 1;
        break;
      case "diagnostic":
        diagnosticEventCount += 1;
        break;
      default:
        break;
    }

    const sample = event.telemetry ?? (event.patch as TelemetryState | undefined);
    if (sample) {
      const pos = sample.position;
      if (pos && isFiniteNumber(pos.lat) && isFiniteNumber(pos.lon)) hasGps = true;
      if (sample.battery && isFiniteNumber(sample.battery.voltage)) hasBattery = true;
      if (sample.radio && isFiniteNumber(sample.radio.rssi)) hasRadio = true;
      if (sample.motion && (isFiniteNumber(sample.motion.rollDeg) || isFiniteNumber(sample.motion.pitchDeg))) {
        hasAttitude = true;
      }
    }
  }

  const durationMs = events.length > 0 ? Math.max(0, maxTimeMs - minTimeMs) : 0;

  const metadata: ReplayLogMetadata = {
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    eventCount: events.length,
    telemetryEventCount,
    partialTelemetryEventCount,
    activityEventCount,
    diagnosticEventCount,
    skippedEventCount: input.skippedEventCount,
    parseWarningCount: input.parseWarningCount,
    firstTimestampMs: input.firstTimestampMs,
    lastTimestampMs: input.lastTimestampMs,
    durationMs,
    hasGps,
    hasBattery,
    hasRadio,
    hasAttitude
  };
  if (input.declaredSchemaVersion !== undefined) {
    metadata.schemaVersion = input.declaredSchemaVersion;
  }
  return metadata;
}
