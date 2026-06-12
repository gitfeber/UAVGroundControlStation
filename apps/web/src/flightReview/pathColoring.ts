import type { FlightReviewPathVertex, PathColoringMode } from "./flightReviewTypes";

/** Normalized scalar 0–1 for map path coloring (higher = warmer / worse for gap mode). */
export function pathColorValue(vertex: FlightReviewPathVertex, mode: PathColoringMode): number {
  switch (mode) {
    case "logGap":
      return normalizeLogGap(vertex.logGapMs);
    case "altitude":
      return vertex.altitudeM ?? 0;
    case "speed":
      return vertex.speedMps ?? 0;
    case "batteryVoltage":
      return vertex.batteryVoltageV ?? 0;
    case "gpsQuality":
      return vertex.gpsQualityScore / 100;
    default:
      return 0;
  }
}

/** Normalize log gap to 0–1; gaps above 10 s saturate at 1. */
function normalizeLogGap(gapMs: number): number {
  if (gapMs <= 0) return 0;
  return Math.min(1, gapMs / 10_000);
}

/** Min/max range for modes that need normalization before rendering. */
export function pathColorRange(
  vertices: FlightReviewPathVertex[],
  mode: PathColoringMode
): { min: number; max: number } {
  if (vertices.length === 0) return { min: 0, max: 1 };

  if (mode === "logGap" || mode === "gpsQuality") {
    return { min: 0, max: 1 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of vertices) {
    const raw = pathColorValue(v, mode);
    if (!Number.isFinite(raw)) continue;
    min = Math.min(min, raw);
    max = Math.max(max, raw);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

export const PATH_COLOR_MODES: PathColoringMode[] = [
  "logGap",
  "altitude",
  "speed",
  "batteryVoltage",
  "gpsQuality"
];
