import type { TelemetryState } from "@uav-ground-control-station/shared";

/** headingDeg → groundCourseDeg → yawDeg; null when none available. */
export function resolveHeadingDeg(telemetry: TelemetryState): number | null {
  const { headingDeg, groundCourseDeg } = telemetry.position;
  const { yawDeg } = telemetry.motion;

  if (headingDeg !== null && Number.isFinite(headingDeg)) return headingDeg;
  if (groundCourseDeg !== null && Number.isFinite(groundCourseDeg)) return groundCourseDeg;
  if (yawDeg !== null && Number.isFinite(yawDeg)) return yawDeg;
  return null;
}
