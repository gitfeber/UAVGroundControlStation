import type { BackendStatus, TelemetryState } from "@uav-ground-control-station/shared";

export interface AlertItem {
  level: "warning" | "critical";
  label: string;
}

export function getAlerts(telemetry: TelemetryState, status: BackendStatus): AlertItem[] {
  const alerts: AlertItem[] = [];
  const packetAge = telemetry.lastPacketAt === null ? Number.POSITIVE_INFINITY : Date.now() - telemetry.lastPacketAt;

  if (packetAge > 3000) {
    alerts.push({ level: "critical", label: "No telemetry > 3s" });
  }

  if ((telemetry.battery.remainingPercent ?? 100) < 25) {
    alerts.push({ level: "critical", label: "Battery below 25%" });
  }

  if ((telemetry.gps.fixType ?? 0) < 3) {
    alerts.push({ level: "warning", label: "GPS fix below 3D" });
  }

  if ((telemetry.gps.satellites ?? 99) < 8) {
    alerts.push({ level: "warning", label: "Satellites below 8" });
  }

  // linkQuality is a 0-100% metric (CRSF link quality, or RSSI normalised into
  // it upstream). It is NOT interchangeable with a raw RSSI count, so evaluate
  // it on a percentage scale rather than reusing a single ambiguous threshold.
  const linkQuality = telemetry.radio.linkQuality;
  if (linkQuality !== null && linkQuality !== undefined) {
    if (linkQuality < 30) {
      alerts.push({ level: "critical", label: "Radio link critical" });
    } else if (linkQuality < 50) {
      alerts.push({ level: "warning", label: "Radio link weak" });
    }
  }

  if (
    telemetry.system.sensorsEnabled !== undefined &&
    telemetry.system.sensorsHealth !== undefined &&
    (telemetry.system.sensorsEnabled & ~telemetry.system.sensorsHealth) !== 0
  ) {
    alerts.push({ level: "critical", label: "Sensor health critical" });
  }

  if (status.serialConnected && telemetry.lastPacketAt === null) {
    alerts.push({ level: "warning", label: "Serial connected, waiting for telemetry" });
  }

  return alerts;
}
