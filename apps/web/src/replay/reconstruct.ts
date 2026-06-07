import type { NormalizedReplayEvent, TelemetryState } from "@uav-ground-control-station/shared";
import { createEmptyTelemetryState } from "../lib/initialTelemetry";
import { validCoordinate } from "../lib/geo";

/**
 * Deterministic state reconstruction for replay/simulation (ADR 0003, handoff
 * "State reconstruction requirements"). Pure: no React, timers, or DOM.
 *
 * - `telemetry` events replace the replay state (sanitized).
 * - `partialTelemetry` events deep-merge a patch into the current state.
 * - invalid numbers (NaN/Infinity) and out-of-range GPS are dropped, never
 *   wiping an existing field.
 * - `activity`/`diagnostic`/`marker` events do not affect telemetry or track;
 *   the controller routes those to logs/diagnostics separately.
 */

export interface TrackPoint {
  lat: number;
  lon: number;
  timestampMs?: number;
}

export interface ReconstructResult {
  state: TelemetryState;
  track: TrackPoint[];
}

export function createEmptyReplayState(): TelemetryState {
  return createEmptyTelemetryState();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sanitize a numeric patch value. Returns `undefined` (meaning "skip, keep the
 * existing value") for NaN/Infinity, and for GPS coordinates outside valid
 * ranges. `lat`/`lon` only appear under `position`, so keying on the name is safe.
 */
function sanitizeNumber(value: number, key: string): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (key === "lat" && (value < -90 || value > 90)) return undefined;
  if (key === "lon" && (value < -180 || value > 180)) return undefined;
  return value;
}

/**
 * Deep-merge `patch` onto `base`, skipping invalid values so they never
 * overwrite good data. Unknown fields are copied through (must not crash the
 * UI). Returns a new object; inputs are not mutated.
 */
function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue; // missing field must not wipe existing value
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "number") {
      const sanitized = sanitizeNumber(value, key);
      if (sanitized !== undefined) out[key] = sanitized;
      continue;
    }
    if (typeof value === "boolean" || typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    if (isPlainObject(value)) {
      const baseChild = isPlainObject(out[key]) ? (out[key] as Record<string, unknown>) : {};
      out[key] = deepMerge(baseChild, value);
      continue;
    }
    // Anything else (function, symbol) is ignored to stay crash-proof.
  }
  return out as T;
}

/** Apply a single event to the telemetry state, returning a new state. */
export function applyEvent(state: TelemetryState, event: NormalizedReplayEvent): TelemetryState {
  if (event.type === "telemetry" && event.telemetry) {
    // Full replacement: merge onto a fresh empty state to normalize + sanitize.
    return deepMerge(
      createEmptyTelemetryState() as unknown as Record<string, unknown>,
      event.telemetry as unknown as Record<string, unknown>
    ) as unknown as TelemetryState;
  }
  if (event.type === "partialTelemetry" && event.patch) {
    return deepMerge(
      state as unknown as Record<string, unknown>,
      event.patch as Record<string, unknown>
    ) as unknown as TelemetryState;
  }
  return state;
}

/**
 * True when two consecutive track points share the same position. Stationary
 * telemetry (position unchanged across events) must not append duplicate points;
 * the first occurrence's timestamp is the one kept.
 */
function samePoint(a: TrackPoint, b: TrackPoint): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

/**
 * Fold events onto a base state and track. Used both for incremental advance
 * (base = current state/track) and for seek/restart (base = empty/[]), which is
 * why seeking the same target always yields the same result and never
 * duplicates track points.
 */
export function foldEvents(
  baseState: TelemetryState,
  baseTrack: TrackPoint[],
  events: NormalizedReplayEvent[]
): ReconstructResult {
  let state = baseState;
  const track = baseTrack.slice();

  for (const event of events) {
    if (event.type !== "telemetry" && event.type !== "partialTelemetry") continue;
    state = applyEvent(state, event);

    const coordinate = validCoordinate(state.position?.lat, state.position?.lon);
    if (!coordinate) continue;

    const point: TrackPoint =
      event.timeMs === undefined
        ? { lat: coordinate.lat, lon: coordinate.lon }
        : { lat: coordinate.lat, lon: coordinate.lon, timestampMs: event.timeMs };

    const last = track[track.length - 1];
    if (last && samePoint(last, point)) continue; // skip consecutive duplicates
    track.push(point);
  }

  return { state, track };
}

/** Reconstruct full state and track from the start of the log (seek/restart). */
export function reconstructUpTo(events: NormalizedReplayEvent[]): ReconstructResult {
  return foldEvents(createEmptyReplayState(), [], events);
}
