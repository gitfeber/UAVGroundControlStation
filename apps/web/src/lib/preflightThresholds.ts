/**
 * Thresholds for the read-only Preflight health advisory (ADR 0004).
 *
 * Kept deliberately independent from `alerts.ts` (lower regression risk).
 * Unifying the two later is a reversible implementation detail and does not
 * need an ADR.
 */
export interface PreflightThresholds {
  /** Max age (ms) of active telemetry before freshness is NOT_READY. Live mode only. */
  telemetryMaxAgeMs: number;
  /** GPS satellites at/above this (with a 3D fix) are READY. */
  minGpsSatellitesReady: number;
  /** GPS satellites at/above this (with a 3D fix) are CAUTION; below is NOT_READY. */
  minGpsSatellitesCaution: number;
  /** Battery remaining-% at/above this is READY. */
  minBatteryPercentReady: number;
  /** Battery remaining-% at/above this is CAUTION; below is NOT_READY. */
  minBatteryPercentCaution: number;
  /** Link quality (%) at/above this is READY. */
  minLinkQualityReady: number;
  /** Link quality (%) at/above this is CAUTION; below is NOT_READY. */
  minLinkQualityCaution: number;
  /** EPH above this (when reported) downgrades a READY GPS to CAUTION (never NOT_READY). */
  maxEphReady: number;
}

export const DEFAULT_PREFLIGHT_THRESHOLDS: PreflightThresholds = {
  telemetryMaxAgeMs: 3000,
  minGpsSatellitesReady: 8,
  minGpsSatellitesCaution: 5,
  minBatteryPercentReady: 25,
  minBatteryPercentCaution: 15,
  minLinkQualityReady: 70,
  minLinkQualityCaution: 40,
  maxEphReady: 200
};
