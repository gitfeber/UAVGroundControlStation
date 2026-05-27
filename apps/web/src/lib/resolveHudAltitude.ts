import type { TelemetryState } from "@uav-ground-control-station/shared";

export type HudAltitudeLabel = "RAT" | "MSL";

export interface HudAltitudeDisplay {
  value: number | null;
  label: HudAltitudeLabel | null;
}

/** relativeAlt when set, else altMsl; label matches the source field. */
export function resolveHudAltitude(telemetry: TelemetryState): HudAltitudeDisplay {
  const { relativeAlt, altMsl } = telemetry.position;

  if (relativeAlt !== null && Number.isFinite(relativeAlt)) {
    return { value: relativeAlt, label: "RAT" };
  }
  if (altMsl !== null && Number.isFinite(altMsl)) {
    return { value: altMsl, label: "MSL" };
  }
  return { value: null, label: null };
}
