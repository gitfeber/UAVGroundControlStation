import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayActivityEvent,
  type ReplayTelemetryEvent,
  type TelemetryState
} from "@uav-ground-control-station/shared";

/** ADR 0003 soft warn threshold for in-memory session buffers. */
export const SESSION_BUFFER_SOFT_WARN_BYTES = 25 * 1024 * 1024;

export const SESSION_RECORDER_MAX_HZ = 20;

type SessionActivityLevel = NonNullable<ReplayActivityEvent["level"]>;

export interface SessionRecorderSnapshot {
  eventCount: number;
  approximateBytes: number;
  softWarnExceeded: boolean;
}

function compactTelemetry(data: TelemetryState): Partial<TelemetryState> {
  return {
    connected: data.connected,
    lastPacketAt: data.lastPacketAt,
    packetCount: data.packetCount,
    vehicle: data.vehicle,
    position: data.position,
    gps: data.gps,
    motion: data.motion,
    battery: data.battery,
    radio: data.radio,
    system: {
      loadPercent: data.system.loadPercent,
      statusText: data.system.statusText.slice(0, 5)
    },
    stats: data.stats
  };
}

function timestampForFile(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function activityLine(
  sessionStartMs: number,
  ts: number,
  level: SessionActivityLevel,
  message: string
): string {
  const entry: ReplayActivityEvent = {
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    ts,
    relativeMs: ts - sessionStartMs,
    source: "live",
    type: "activity",
    level,
    message
  };
  return `${JSON.stringify(entry)}\n`;
}

function telemetryLine(sessionStartMs: number, ts: number, state: TelemetryState): string {
  const entry: ReplayTelemetryEvent = {
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    ts,
    relativeMs: ts - sessionStartMs,
    source: "live",
    type: "telemetry",
    state: compactTelemetry(state) as TelemetryState
  };
  return `${JSON.stringify(entry)}\n`;
}

export class SessionRecorder {
  private lines: string[] = [];
  private approximateBytes = 0;
  private sessionStartMs: number | null = null;
  private lastTelemetryRecordMs = 0;
  private readonly minTelemetryIntervalMs: number;
  private softWarnExceeded = false;

  constructor(maxHz = SESSION_RECORDER_MAX_HZ) {
    this.minTelemetryIntervalMs = 1000 / maxHz;
  }

  get snapshot(): SessionRecorderSnapshot {
    return {
      eventCount: this.lines.length,
      approximateBytes: this.approximateBytes,
      softWarnExceeded: this.softWarnExceeded
    };
  }

  hasBufferedEvents(): boolean {
    return this.lines.length > 0;
  }

  clear(): void {
    this.lines = [];
    this.approximateBytes = 0;
    this.sessionStartMs = null;
    this.lastTelemetryRecordMs = 0;
    this.softWarnExceeded = false;
  }

  recordActivity(level: SessionActivityLevel, message: string, ts = Date.now()): void {
    this.ensureSessionStart(ts);
    this.append(activityLine(this.sessionStartMs as number, ts, level, message));
  }

  recordTelemetry(state: TelemetryState, ts = Date.now()): void {
    this.ensureSessionStart(ts);
    if (ts - this.lastTelemetryRecordMs < this.minTelemetryIntervalMs) {
      return;
    }
    this.lastTelemetryRecordMs = ts;
    this.append(telemetryLine(this.sessionStartMs as number, ts, state));
  }

  toJsonlText(): string {
    return this.lines.join("");
  }

  suggestedFileName(date = new Date()): string {
    return `flight-${timestampForFile(date)}.jsonl`;
  }

  private ensureSessionStart(ts: number): void {
    if (this.sessionStartMs === null) {
      this.sessionStartMs = ts;
    }
  }

  private append(line: string): void {
    this.lines.push(line);
    this.approximateBytes += line.length;
    if (!this.softWarnExceeded && this.approximateBytes >= SESSION_BUFFER_SOFT_WARN_BYTES) {
      this.softWarnExceeded = true;
    }
  }
}

export function downloadJsonlSession(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
