import type { TargetEstimateInvalidReason, TargetEstimateQuality } from "@uav-ground-control-station/shared";

export const STALE_TELEMETRY_WARN_MS = 500;
export const MIN_DEPRESSION_DEG = 5;

const BAD_REASONS = new Set<TargetEstimateInvalidReason>([
  "gimbal_unavailable",
  "gps_not_3d",
  "horizon_too_shallow",
  "missing_position",
  "missing_altitude",
  "no_ray_intersection",
  "target_estimation_live_only",
  "dem_out_of_coverage",
  "dem_nodata"
]);

export function aggregateTargetQuality(
  reasons: TargetEstimateInvalidReason[],
  hasCoordinates: boolean
): { quality: TargetEstimateQuality; valid: boolean } {
  const hasBad = reasons.some((reason) => BAD_REASONS.has(reason));
  const hasWarn = reasons.length > 0 && !hasBad;

  if (hasBad || !hasCoordinates) {
    return { quality: "bad", valid: false };
  }
  if (hasWarn) {
    return { quality: "warn", valid: true };
  }
  return { quality: "good", valid: true };
}
