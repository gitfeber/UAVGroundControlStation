import type { TargetEstimate, TelemetryState } from "@uav-ground-control-station/shared";

export const DEFAULT_TARGET_SAMPLE_LOG_CAPACITY = 600;

export interface TargetSampleTelemetrySlice {
  lat: number | null;
  lon: number | null;
  altMsl: number | null;
  relativeAlt: number | null;
  rollDeg: number | null;
  pitchDeg: number | null;
  yawDeg: number | null;
  fixType: number | null;
  gimbalSource: string | null;
  sampledAtMs: number | null;
}

export interface TargetSampleLogEntry {
  recordedAtMs: number;
  estimate: TargetEstimate;
  telemetry: TargetSampleTelemetrySlice;
}

export interface TargetSampleLogOptions {
  capacity?: number;
}

export class TargetSampleLog {
  private readonly capacity: number;
  private entries: TargetSampleLogEntry[] = [];

  constructor(options: TargetSampleLogOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_TARGET_SAMPLE_LOG_CAPACITY;
  }

  get size(): number {
    return this.entries.length;
  }

  get capacityLimit(): number {
    return this.capacity;
  }

  getSamples(): readonly TargetSampleLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  append(entry: TargetSampleLogEntry): void {
    this.entries.push(structuredClone(entry));
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }
}

export function slimTelemetrySlice(state: TelemetryState): TargetSampleTelemetrySlice {
  return {
    lat: state.position.lat,
    lon: state.position.lon,
    altMsl: state.position.altMsl,
    relativeAlt: state.position.relativeAlt,
    rollDeg: state.motion.rollDeg,
    pitchDeg: state.motion.pitchDeg,
    yawDeg: state.motion.yawDeg,
    fixType: state.gps.fixType,
    gimbalSource: state.gimbal?.source ?? null,
    sampledAtMs: state.sampledAtMs
  };
}

export function createTargetSampleLogEntry(
  estimate: TargetEstimate,
  telemetry: TelemetryState,
  recordedAtMs: number = estimate.estimatedAtMs
): TargetSampleLogEntry {
  return {
    recordedAtMs,
    estimate: structuredClone(estimate),
    telemetry: slimTelemetrySlice(telemetry)
  };
}

export function exportTargetSampleLogJson(samples: readonly TargetSampleLogEntry[]): string {
  return JSON.stringify(
    {
      schema: "uav-gcs-target-sample-log",
      version: 1,
      exportedAtMs: Date.now(),
      count: samples.length,
      samples
    },
    null,
    2
  );
}

export function exportTargetSampleLogCsv(samples: readonly TargetSampleLogEntry[]): string {
  const headers = [
    "recordedAtMs",
    "valid",
    "quality",
    "lat",
    "lon",
    "slantRangeM",
    "groundRangeM",
    "depressionAngleDeg",
    "terrainElevationM",
    "reasons",
    "uavLat",
    "uavLon",
    "uavAltM",
    "telemetrySampledAtMs",
    "gimbalSource",
    "teleLat",
    "teleLon",
    "teleAltMsl",
    "teleRelativeAlt",
    "teleRollDeg",
    "telePitchDeg",
    "teleYawDeg",
    "teleFixType",
    "teleSampledAtMs"
  ];

  const rows = samples.map((sample) => {
    const { estimate, telemetry } = sample;
    return [
      sample.recordedAtMs,
      estimate.valid,
      estimate.quality,
      estimate.lat,
      estimate.lon,
      estimate.slantRangeM,
      estimate.groundRangeM,
      estimate.depressionAngleDeg,
      estimate.terrainElevationM,
      estimate.reasons.join("|"),
      estimate.uavLat,
      estimate.uavLon,
      estimate.uavAltM,
      estimate.telemetrySampledAtMs,
      estimate.gimbalSource,
      telemetry.lat,
      telemetry.lon,
      telemetry.altMsl,
      telemetry.relativeAlt,
      telemetry.rollDeg,
      telemetry.pitchDeg,
      telemetry.yawDeg,
      telemetry.fixType,
      telemetry.sampledAtMs
    ]
      .map(csvCell)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
