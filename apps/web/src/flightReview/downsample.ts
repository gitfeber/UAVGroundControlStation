/**
 * Downsample time-series while preserving local extrema where possible.
 * Used to cap graph and path render payloads (ADR 0007).
 */

export interface TimeSeriesPoint {
  timeMs: number;
  value: number;
}

/** Bucket min/max downsampling: each bucket contributes its min and max points. */
export function downsamplePreserveExtrema(
  points: TimeSeriesPoint[],
  maxPoints: number
): TimeSeriesPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points.slice();

  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = points.length / bucketCount;
  const out: TimeSeriesPoint[] = [];

  for (let b = 0; b < bucketCount; b += 1) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    const slice = points.slice(start, end);
    let min = slice[0]!;
    let max = slice[0]!;
    for (const p of slice) {
      if (p.value < min.value) min = p;
      if (p.value > max.value) max = p;
    }

    if (min.timeMs <= max.timeMs) {
      if (min !== max) out.push(min);
      out.push(max);
    } else {
      if (min !== max) out.push(max);
      out.push(min);
    }
  }

  // Always include endpoints for seek alignment.
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (out.length === 0 || out[0]!.timeMs !== first.timeMs) out.unshift(first);
  if (out[out.length - 1]!.timeMs !== last.timeMs) out.push(last);

  if (out.length <= maxPoints) return out;

  // Rare overflow when many buckets collapse to identical times — uniform stride fallback.
  const stride = (out.length - 1) / (maxPoints - 1);
  const trimmed: TimeSeriesPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    trimmed.push(out[Math.round(i * stride)]!);
  }
  return trimmed;
}

/** Uniform stride downsample for multi-field records (path vertices). */
export function downsampleUniform<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items.slice();
  if (maxItems <= 1) return [items[items.length - 1]!];

  const stride = (items.length - 1) / (maxItems - 1);
  const out: T[] = [];
  for (let i = 0; i < maxItems; i += 1) {
    out.push(items[Math.round(i * stride)]!);
  }
  return out;
}
