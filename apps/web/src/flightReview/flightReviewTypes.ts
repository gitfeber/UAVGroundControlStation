import type { NormalizedReplayEvent, ReplayLogMetadata, TelemetryState } from "@uav-ground-control-station/shared";

/** Hardcoded analysis limits for flight review (ADR 0007). */
export interface FlightReviewThresholds {
  /** Consecutive log timestamp delta above this is a stale telemetry gap. */
  telemetryMaxAgeMs: number;
  /** Minimum GPS satellites for 2D+ fix to be considered acceptable. */
  minGpsSatellites: number;
  /** Battery remaining-% floor when voltage is unavailable. */
  minBatteryPercent: number;
  /** Link quality (%) floor; RSSI alone never triggers findings. */
  minLinkQuality: number;
  /** EPH above this (when reported) marks GPS as degraded. */
  maxEphReady: number;
  /** Absolute battery voltage floor (V). */
  minBatteryVoltage: number;
  /** Voltage drop within {@link batterySagWindowMs} that triggers a sag finding. */
  batterySagDeltaVoltage: number;
  /** Rolling window (ms) for battery sag detection. */
  batterySagWindowMs: number;
  /** Optional altitude cap — stats only when unset. */
  maxAltitude?: number;
  /** Optional distance-from-home cap (m) — stats only when unset. */
  maxDistanceFromHome?: number;
}

export type FlightReviewFindingSeverity = "info" | "warn";

export type FlightReviewFindingCategory =
  | "telemetry"
  | "gps"
  | "battery"
  | "radio"
  | "flight"
  | "summary";

export interface FlightReviewFinding {
  id: string;
  timeMs: number;
  severity: FlightReviewFindingSeverity;
  category: FlightReviewFindingCategory;
  title: string;
  detail?: string;
  durationMs?: number;
  showOnTimeline: boolean;
}

export type PathColoringMode = "logGap" | "altitude" | "speed" | "batteryVoltage" | "gpsQuality";

export interface SessionHome {
  lat: number;
  lon: number;
  timeMs: number;
}

export interface FlightReviewSummary {
  durationMs: number;
  telemetrySampleCount: number;
  sessionHome: SessionHome | null;
  maxAltitudeM: number | null;
  maxSpeedMps: number | null;
  maxDistanceFromHomeM: number | null;
  minVoltageV: number | null;
  minBatteryPercent: number | null;
  armedDurationMs: number;
  flightModeChanges: number;
  telemetryGapCount: number;
  /** Set only when {@link FlightReviewThresholds.maxAltitude} is configured. */
  exceededMaxAltitude?: boolean;
  /** Set only when {@link FlightReviewThresholds.maxDistanceFromHome} is configured. */
  exceededMaxDistanceFromHome?: boolean;
}

/** One reconstructed telemetry snapshot at a log timestamp. */
export interface FlightReviewSample {
  timeMs: number;
  eventIndex: number;
  state: TelemetryState;
  distanceFromHomeM: number | null;
  gpsQualityScore: number;
  logGapMs: number;
}

export interface FlightReviewFullStats {
  samples: FlightReviewSample[];
}

export interface GraphPoint {
  timeMs: number;
  value: number;
}

export interface GpsGraphPoint {
  timeMs: number;
  satellites: number | null;
  eph: number | null;
  gpsQualityScore: number;
}

export interface FlightReviewRenderSeries {
  altitude: GraphPoint[];
  speed: GraphPoint[];
  batteryVoltage: GraphPoint[];
  linkQuality: GraphPoint[];
  rssi: GraphPoint[];
  gps: GpsGraphPoint[];
}

export interface FlightReviewPathVertex {
  lat: number;
  lon: number;
  timeMs: number;
  logGapMs: number;
  altitudeM: number | null;
  speedMps: number | null;
  batteryVoltageV: number | null;
  gpsQualityScore: number;
}

export interface FlightReviewMetadata {
  thresholds: FlightReviewThresholds;
  fullSampleCount: number;
  renderSeriesCap: number;
  renderPathCap: number;
  timelineMarkerCount: number;
  replayMetadata?: ReplayLogMetadata;
}

export interface FlightReviewResult {
  summary: FlightReviewSummary;
  findings: FlightReviewFinding[];
  fullStats: FlightReviewFullStats;
  renderSeries: FlightReviewRenderSeries;
  renderPath: FlightReviewPathVertex[];
  pathColorModes: PathColoringMode[];
  metadata: FlightReviewMetadata;
}

export const MAX_GRAPH_POINTS = 2000;
export const MAX_PATH_VERTICES = 5000;

export type FlightReviewInput = NormalizedReplayEvent[];
