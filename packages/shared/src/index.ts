import type { GimbalState } from "./targetEstimation.js";

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
  locationId?: string;
  friendlyName?: string;
  transport: "usb" | "windows-com" | "serial" | "unknown";
  displayName: string;
}

export interface BackendStatus {
  serialConnected: boolean;
  mavlinkPackets: number;
  lastPacketMs: number | null;
  rawBytes?: number;
  txBytes?: number;
  parserErrors?: number;
  lastSerialError?: string | null;
  mavlinkMessages?: MavlinkMessageStat[];
}

export interface MavlinkMessageStat {
  id: number;
  label: string;
  count: number;
  lastSeenAt: number;
}

export interface LoggingStatus {
  active: boolean;
  filePath: string | null;
}

export interface ConnectRequest {
  path: string;
  baudRate?: number;
}

export type {
  AltitudeMode,
  CameraConfig,
  EnuTuple,
  GimbalAttitudeSource,
  GimbalFrameConvention,
  GimbalState,
  PitchSignConvention,
  TargetEstimate,
  TargetEstimateInvalidReason,
  TargetEstimateQuality,
  TargetEstimationSettings,
  TerrainElevationSample,
  TerrainMetadata,
  TerrainProvider,
  TerrainRaySample,
  YawReferenceConvention
} from "./targetEstimation.js";
export {
  createEmptyTargetEstimate,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_TARGET_ESTIMATION_SETTINGS
} from "./targetEstimation.js";

export interface TelemetryState {
  connected: boolean;
  lastPacketAt: number | null;
  /** Monotonic sample time for target-estimation buffer lookup. */
  sampledAtMs: number | null;
  packetCount: number;

  vehicle: {
    systemId: number | null;
    componentId: number | null;
    type: string;
    armed: boolean;
    flightMode: string;
    baseMode?: number;
    customMode?: number;
  };

  position: {
    lat: number | null;
    lon: number | null;
    altMsl: number | null;
    relativeAlt: number | null;
    headingDeg: number | null;
    groundCourseDeg: number | null;
  };

  gps: {
    fixType: number | null;
    fixLabel: string;
    satellites: number | null;
    eph: number | null;
    epv: number | null;
  };

  motion: {
    groundSpeed: number | null;
    airSpeed: number | null;
    climbRate: number | null;
    rollDeg: number | null;
    pitchDeg: number | null;
    yawDeg: number | null;
  };

  battery: {
    voltage: number | null;
    current: number | null;
    remainingPercent: number | null;
    consumedMah: number | null;
    cellVoltageEstimate: number | null;
  };

  radio: {
    rssi: number | null;
    remRssi: number | null;
    rxErrors: number | null;
    fixed: number | null;
    txBuffer: number | null;
    linkQuality: number | null;
  };

  system: {
    loadPercent: number | null;
    sensorsPresent?: number;
    sensorsEnabled?: number;
    sensorsHealth?: number;
    statusText: string[];
  };

  stats: {
    minVoltage: number | null;
    maxAltitude: number | null;
    maxSpeed: number | null;
    maxDistance: number | null;
    maxCurrent: number | null;
    minRssi: number | null;
    warningCount: number;
    sessionStartedAt: number;
  };

  /** Normalized gimbal attitude for target estimation; null when unavailable. */
  gimbal: GimbalState | null;
}

export interface TelemetryEnvelope {
  type: "telemetry";
  data: TelemetryState;
}

export interface StatusEnvelope {
  type: "status";
  data: BackendStatus;
}

// ---------------------------------------------------------------------------
// Replay & Simulation (ADR 0003 — frontend-only replay/simulation)
// ---------------------------------------------------------------------------

/**
 * Schema version emitted by live log writers and understood by the replay
 * parser. Bump only on a breaking change to the on-disk JSONL event shape.
 */
export const REPLAY_LOG_SCHEMA_VERSION = 1;

export type TelemetrySourceMode = "live" | "replay" | "simulation";

export type ReplayStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type ReplayTimingMode = "original" | "fixedRate" | "manual" | "max";

export type ReplaySpeedMode = 0.25 | 0.5 | 1 | 2 | 5 | 10 | "max";

export type ReplayFixedRateHz = 5 | 10 | 20 | 50;

export type ReplayEventType =
  | "telemetry"
  | "partialTelemetry"
  | "activity"
  | "diagnostic"
  | "marker"
  | "unknown";

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ReplayLogEventBase {
  schemaVersion?: number;
  ts?: number;
  timestamp?: number;
  relativeMs?: number;
  source?: string;
  type?: ReplayEventType | string;
}

export interface ReplayTelemetryEvent extends ReplayLogEventBase {
  type: "telemetry";
  state: TelemetryState;
}

export interface ReplayPartialTelemetryEvent extends ReplayLogEventBase {
  type: "partialTelemetry";
  patch: DeepPartial<TelemetryState>;
}

export interface ReplayActivityEvent extends ReplayLogEventBase {
  type: "activity";
  level?: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface ReplayDiagnosticEvent extends ReplayLogEventBase {
  type: "diagnostic";
  stats: Record<string, unknown>;
}

export interface ReplayMarkerEvent extends ReplayLogEventBase {
  type: "marker";
  label: string;
  description?: string;
}

export type ReplayLogEvent =
  | ReplayTelemetryEvent
  | ReplayPartialTelemetryEvent
  | ReplayActivityEvent
  | ReplayDiagnosticEvent
  | ReplayMarkerEvent;

/**
 * A parsed, normalized replay event with a resolved absolute timeline.
 * `timeMs` is the monotonic replay-relative time (ms from the first event).
 */
export interface NormalizedReplayEvent {
  index: number;
  timeMs: number;
  type: ReplayEventType;
  /** Original wall-clock timestamp if the log provided one. */
  absoluteTsMs: number | null;
  telemetry?: TelemetryState;
  patch?: DeepPartial<TelemetryState>;
  activity?: { level: "debug" | "info" | "warn" | "error"; message: string };
  stats?: Record<string, unknown>;
  marker?: { label: string; description?: string };
}

export interface ReplayLogMetadata {
  fileName: string;
  fileSizeBytes: number;
  schemaVersion?: number;
  eventCount: number;
  telemetryEventCount: number;
  partialTelemetryEventCount: number;
  activityEventCount: number;
  diagnosticEventCount: number;
  skippedEventCount: number;
  parseWarningCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  durationMs: number;
  hasGps: boolean;
  hasBattery: boolean;
  hasRadio: boolean;
  hasAttitude: boolean;
}

export interface ReplayDiagnostics {
  status: ReplayStatus;
  sourceMode: TelemetrySourceMode;
  currentEventIndex: number;
  currentReplayTimeMs: number;
  durationMs: number;
  emittedTelemetryEvents: number;
  emittedActivityEvents: number;
  emittedDiagnosticEvents: number;
  skippedEvents: number;
  parseWarnings: number;
  lastError: string | null;
  averageEmitRateHz: number;
}

export interface ReplayControllerState {
  sourceMode: TelemetrySourceMode;
  status: ReplayStatus;
  timingMode: ReplayTimingMode;
  speedMultiplier: ReplaySpeedMode;
  fixedRateHz: ReplayFixedRateHz;
  currentEventIndex: number;
  currentReplayTimeMs: number;
  durationMs: number;
  loadedFileName: string | null;
  metadata: ReplayLogMetadata | null;
  lastError: string | null;
  diagnostics: ReplayDiagnostics;
}

export type SimulationScenario =
  | "nominalFlight"
  | "weakRadioLink"
  | "gpsDegradation"
  | "lowBatteryApproach";

export interface SimulationOptions {
  scenario: SimulationScenario;
  seed: number;
  durationMs: number;
  rateHz: number;
  startLat?: number;
  startLon?: number;
}
