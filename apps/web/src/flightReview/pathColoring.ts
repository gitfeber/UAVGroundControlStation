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

/** Map a normalized 0–1 value to a hex color for the given mode. */
export function pathColorHex(normalized: number, mode: PathColoringMode): string {
  const t = Math.max(0, Math.min(1, normalized));
  switch (mode) {
    case "logGap":
      return lerpColor("#334155", "#f97316", t);
    case "altitude":
      return lerpColor("#1e3a8a", "#22d3ee", t);
    case "speed":
      return lerpColor("#164e63", "#a855f7", t);
    case "batteryVoltage":
      return lerpColor("#ef4444", "#22c55e", t);
    case "gpsQuality":
      return lerpColor("#ef4444", "#22c55e", t);
    default:
      return "#22d3ee";
  }
}

/** Normalize a raw path metric into 0–1 for coloring. */
export function normalizePathMetric(
  vertex: FlightReviewPathVertex,
  mode: PathColoringMode,
  range: { min: number; max: number }
): number {
  const raw = pathColorValue(vertex, mode);
  if (mode === "logGap" || mode === "gpsQuality") return raw;
  if (range.max === range.min) return 0.5;
  return Math.max(0, Math.min(1, (raw - range.min) / (range.max - range.min)));
}

function lerpColor(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

export const PATH_COLOR_MODES: PathColoringMode[] = [
  "logGap",
  "altitude",
  "speed",
  "batteryVoltage",
  "gpsQuality"
];
