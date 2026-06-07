import {
  createEmptyTargetEstimate,
  DEFAULT_TARGET_ESTIMATION_SETTINGS,
  type TargetEstimate,
  type TargetEstimationSettings,
  type TelemetrySourceMode,
  type TelemetryState,
  type TerrainProvider
} from "@uav-ground-control-station/shared";
import { estimateTargetFromTelemetry } from "./estimateTarget.js";
import { TelemetryRingBuffer, type TelemetryRingBufferOptions } from "./telemetryBuffer.js";

export interface TargetEstimationSessionOptions {
  terrain: TerrainProvider;
  settings?: TargetEstimationSettings;
  sourceMode?: TelemetrySourceMode;
  buffer?: TelemetryRingBufferOptions;
}

export interface TargetEstimationEstimateOptions {
  /** Explicit PC monotonic time for latency alignment; defaults to estimatedAtMs - videoLatencyMs. */
  atPcTimeMs?: number;
  /** Wall-clock time when the estimate is computed; defaults to Date.now(). */
  estimatedAtMs?: number;
}

export class TargetEstimationSession {
  private readonly buffer: TelemetryRingBuffer;
  private terrain: TerrainProvider;
  private settings: TargetEstimationSettings;
  private sourceMode: TelemetrySourceMode;

  constructor(options: TargetEstimationSessionOptions) {
    this.buffer = new TelemetryRingBuffer(options.buffer);
    this.terrain = options.terrain;
    this.settings = options.settings ?? DEFAULT_TARGET_ESTIMATION_SETTINGS;
    this.sourceMode = options.sourceMode ?? "live";
  }

  setTerrain(terrain: TerrainProvider): void {
    this.terrain = terrain;
  }

  setSettings(settings: TargetEstimationSettings): void {
    this.settings = settings;
  }

  setSourceMode(sourceMode: TelemetrySourceMode): void {
    this.sourceMode = sourceMode;
  }

  getSettings(): TargetEstimationSettings {
    return structuredClone(this.settings);
  }

  push(state: TelemetryState): void {
    this.buffer.push(state);
  }

  clearBuffer(): void {
    this.buffer.clear();
  }

  estimate(options: TargetEstimationEstimateOptions = {}): Promise<TargetEstimate> {
    const estimatedAtMs = options.estimatedAtMs ?? Date.now();
    if (this.sourceMode !== "live") {
      const blocked = createEmptyTargetEstimate(estimatedAtMs);
      blocked.reasons = ["target_estimation_live_only"];
      blocked.quality = "bad";
      blocked.valid = false;
      return Promise.resolve(blocked);
    }

    const atPcTimeMs = options.atPcTimeMs ?? estimatedAtMs - this.settings.videoLatencyMs;
    const lookup = this.buffer.lookup(atPcTimeMs);
    if (!lookup.state || lookup.sampledAtMs === null) {
      const empty = createEmptyTargetEstimate(estimatedAtMs);
      empty.telemetrySampledAtMs = null;
      empty.reasons = ["telemetry_stale"];
      empty.quality = "bad";
      empty.valid = false;
      return Promise.resolve(empty);
    }

    return estimateTargetFromTelemetry({
      telemetry: lookup.state,
      lookup,
      terrain: this.terrain,
      settings: this.settings,
      estimatedAtMs,
      telemetrySampledAtMs: lookup.interpolated ? atPcTimeMs : lookup.sampledAtMs
    });
  }
}
