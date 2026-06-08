import type { TargetEstimateInvalidReason, TargetEstimateQuality } from "@uav-ground-control-station/shared";

export const DEFAULT_STALE_TELEMETRY_WARN_MS = 500;
export const DEFAULT_MIN_DEPRESSION_DEG = 5;
/** GPS horizontal accuracy above this (meters) triggers a warn gate. */
export const DEFAULT_GPS_LOW_ACCURACY_EPH_M = 2.0;
/** Fewer satellites than this triggers a warn gate (3D fix still required for valid). */
export const DEFAULT_GPS_FEW_SATELLITES_WARN = 8;

const BAD_REASONS = new Set<TargetEstimateInvalidReason>([
  "telemetry_incomplete",
  "gimbal_unavailable",
  "dem_not_loaded",
  "dem_out_of_coverage",
  "dem_nodata",
  "camera_above_horizon",
  "gps_no_3d_fix",
  "no_ray_intersection",
  "target_estimation_live_only"
]);

const WARN_REASONS = new Set<TargetEstimateInvalidReason>([
  "using_relative_altitude_fallback",
  "gimbal_body_fixed_fallback",
  "gimbal_mount_orientation",
  "telemetry_stale",
  "gps_low_accuracy",
  "gps_few_satellites"
]);

export function aggregateTargetQuality(
  reasons: TargetEstimateInvalidReason[],
  hasCoordinates: boolean
): { quality: TargetEstimateQuality; valid: boolean } {
  const hasBad = reasons.some((reason) => BAD_REASONS.has(reason));
  const hasWarn = reasons.some((reason) => WARN_REASONS.has(reason));

  if (hasBad || !hasCoordinates) {
    return { quality: "bad", valid: false };
  }
  if (hasWarn) {
    return { quality: "warn", valid: true };
  }
  return { quality: "good", valid: true };
}
