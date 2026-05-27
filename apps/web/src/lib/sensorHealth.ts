import type { TelemetryState } from "@uav-ground-control-station/shared";

export function sensorHealthSummary(telemetry: TelemetryState): string {
  const enabled = telemetry.system.sensorsEnabled;
  const health = telemetry.system.sensorsHealth;
  if (enabled === undefined || health === undefined) return "Unknown";
  return (enabled & ~health) === 0 ? "Healthy" : "Fault";
}
