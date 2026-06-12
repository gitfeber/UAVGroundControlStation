/** Coerce a numeric telemetry field to a finite value or null (never NaN/Infinity). */
export function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/** Like `finiteOrNull` but preserves null/undefined distinction as null only. */
export function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
