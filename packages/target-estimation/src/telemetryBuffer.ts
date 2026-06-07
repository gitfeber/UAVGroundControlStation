import type { TelemetryState } from "@uav-ground-control-station/shared";
import { interpolateTelemetryState } from "./interpolate.js";

export const DEFAULT_TELEMETRY_BUFFER_RETENTION_MS = 10_000;

export interface TelemetryBufferEntry {
  sampledAtMs: number;
  state: TelemetryState;
}

export interface TelemetryLookupResult {
  state: TelemetryState | null;
  sampledAtMs: number | null;
  interpolated: boolean;
  /** Absolute ms between query time and resolved sample time. */
  ageMs: number | null;
  /** Query time minus newest retained sample; useful for stale telemetry gates. */
  trailingGapMs: number | null;
}

export interface TelemetryRingBufferOptions {
  retentionMs?: number;
}

export class TelemetryRingBuffer {
  private readonly retentionMs: number;
  private entries: TelemetryBufferEntry[] = [];

  constructor(options: TelemetryRingBufferOptions = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_TELEMETRY_BUFFER_RETENTION_MS;
  }

  get size(): number {
    return this.entries.length;
  }

  getOldestSampledAtMs(): number | null {
    return this.entries[0]?.sampledAtMs ?? null;
  }

  getNewestSampledAtMs(): number | null {
    return this.entries.at(-1)?.sampledAtMs ?? null;
  }

  clear(): void {
    this.entries = [];
  }

  /** Retain snapshots that carry a monotonic sample timestamp. */
  push(state: TelemetryState): boolean {
    const sampledAtMs = state.sampledAtMs;
    if (sampledAtMs === null || !Number.isFinite(sampledAtMs)) {
      return false;
    }

    const entry: TelemetryBufferEntry = {
      sampledAtMs,
      state: structuredClone(state)
    };

    const last = this.entries.at(-1);
    if (last && sampledAtMs === last.sampledAtMs) {
      this.entries[this.entries.length - 1] = entry;
    } else if (!last || sampledAtMs > last.sampledAtMs) {
      this.entries.push(entry);
    } else {
      this.insertSorted(entry);
    }

    this.trim();
    return true;
  }

  lookup(targetSampledAtMs: number): TelemetryLookupResult {
    if (this.entries.length === 0) {
      return emptyLookup();
    }

    const newest = this.entries.at(-1)!;
    const trailingGapMs = targetSampledAtMs - newest.sampledAtMs;

    if (targetSampledAtMs >= newest.sampledAtMs) {
      return {
        state: structuredClone(newest.state),
        sampledAtMs: newest.sampledAtMs,
        interpolated: false,
        ageMs: Math.abs(trailingGapMs),
        trailingGapMs
      };
    }

    const oldest = this.entries[0]!;
    if (targetSampledAtMs <= oldest.sampledAtMs) {
      const ageMs = oldest.sampledAtMs - targetSampledAtMs;
      return {
        state: structuredClone(oldest.state),
        sampledAtMs: oldest.sampledAtMs,
        interpolated: false,
        ageMs,
        trailingGapMs
      };
    }

    let before = oldest;
    let after = newest;

    for (let index = 0; index < this.entries.length - 1; index += 1) {
      const left = this.entries[index]!;
      const right = this.entries[index + 1]!;
      if (left.sampledAtMs <= targetSampledAtMs && targetSampledAtMs <= right.sampledAtMs) {
        before = left;
        after = right;
        break;
      }
    }

    if (before.sampledAtMs === targetSampledAtMs) {
      return {
        state: structuredClone(before.state),
        sampledAtMs: before.sampledAtMs,
        interpolated: false,
        ageMs: 0,
        trailingGapMs
      };
    }

    if (after.sampledAtMs === targetSampledAtMs) {
      return {
        state: structuredClone(after.state),
        sampledAtMs: after.sampledAtMs,
        interpolated: false,
        ageMs: 0,
        trailingGapMs
      };
    }

    const spanMs = after.sampledAtMs - before.sampledAtMs;
    const t = spanMs > 0 ? (targetSampledAtMs - before.sampledAtMs) / spanMs : 0;

    return {
      state: interpolateTelemetryState(before.state, after.state, t),
      sampledAtMs: targetSampledAtMs,
      interpolated: true,
      ageMs: 0,
      trailingGapMs
    };
  }

  private insertSorted(entry: TelemetryBufferEntry): void {
    let insertAt = this.entries.findIndex((candidate) => candidate.sampledAtMs > entry.sampledAtMs);
    if (insertAt === -1) {
      insertAt = this.entries.length;
    }
    this.entries.splice(insertAt, 0, entry);
  }

  private trim(): void {
    const newest = this.entries.at(-1)?.sampledAtMs;
    if (newest === undefined) return;

    const cutoff = newest - this.retentionMs;
    this.entries = this.entries.filter((entry) => entry.sampledAtMs >= cutoff);
  }
}

function emptyLookup(): TelemetryLookupResult {
  return {
    state: null,
    sampledAtMs: null,
    interpolated: false,
    ageMs: null,
    trailingGapMs: null
  };
}
