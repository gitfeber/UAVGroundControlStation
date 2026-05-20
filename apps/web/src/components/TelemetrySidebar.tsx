import type { TelemetryState } from "@uav-ground-control-station/shared";
import type { AlertItem } from "../lib/alerts";
import { elapsedTime, formatInteger, formatNumber, percentageColor } from "../lib/format";
import { Badge, Metric, Panel } from "./Panel";

interface TelemetrySidebarProps {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
  alerts: AlertItem[];
}

export function TelemetrySidebar({ telemetry, distanceFromHome, alerts }: TelemetrySidebarProps) {
  const batteryPercent = telemetry.battery.remainingPercent;
  const sensorSummary = sensorHealthSummary(telemetry);

  return (
    <aside className="z-10 flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-cyan-300/10 bg-slate-950/78 p-3 backdrop-blur">
      <Panel title="Alerts">
        {alerts.length === 0 ? (
          <div className="text-sm text-emerald-200">No active alerts</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {alerts.map((alert) => (
              <Badge key={alert.label} tone={alert.level === "critical" ? "bad" : "warn"}>
                {alert.label}
              </Badge>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Vehicle">
        <div className="mb-3 flex items-center justify-between">
          <Badge tone={telemetry.vehicle.armed ? "bad" : "good"}>{telemetry.vehicle.armed ? "Armed" : "Safe"}</Badge>
          <span className="font-mono text-xs text-slate-400">SYS {telemetry.vehicle.systemId ?? "--"} / COMP {telemetry.vehicle.componentId ?? "--"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Mode" value={telemetry.vehicle.flightMode} tone="good" />
          <Metric label="Type" value={telemetry.vehicle.type} />
          <Metric label="Base Mode" value={formatInteger(telemetry.vehicle.baseMode)} />
          <Metric label="Session" value={elapsedTime(telemetry.stats.sessionStartedAt)} />
        </div>
      </Panel>

      <Panel title="Battery">
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>Battery</span>
            <span className="font-mono">{formatInteger(batteryPercent, "%")}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full ${percentageColor(batteryPercent)}`} style={{ width: `${Math.max(0, Math.min(100, batteryPercent ?? 0))}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Voltage" value={formatNumber(telemetry.battery.voltage, 2, "V")} />
          <Metric label="4S Cell Est." value={formatNumber(telemetry.battery.cellVoltageEstimate, 2, "V")} />
          <Metric label="Current" value={formatNumber(telemetry.battery.current, 1, "A")} />
          <Metric label="Consumed" value={formatInteger(telemetry.battery.consumedMah, "mAh")} />
          <Metric label="Min Voltage" value={formatNumber(telemetry.stats.minVoltage, 2, "V")} />
          <Metric label="Max Current" value={formatNumber(telemetry.stats.maxCurrent, 1, "A")} />
        </div>
      </Panel>

      <Panel title="GPS / Navigation">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Fix" value={telemetry.gps.fixLabel} tone={(telemetry.gps.fixType ?? 0) >= 3 ? "good" : "warn"} />
          <Metric label="Satellites" value={formatInteger(telemetry.gps.satellites)} />
          <Metric label="EPH" value={formatNumber(telemetry.gps.eph, 2)} />
          <Metric label="Rel Alt" value={formatNumber(telemetry.position.relativeAlt, 1, "m")} />
          <Metric label="Groundspeed" value={formatNumber(telemetry.motion.groundSpeed, 1, "m/s")} />
          <Metric label="Heading" value={formatNumber(telemetry.position.headingDeg ?? telemetry.position.groundCourseDeg, 0, "deg")} />
          <Metric label="Home Dist." value={formatNumber(distanceFromHome, 0, "m")} />
          <Metric label="MSL Alt" value={formatNumber(telemetry.position.altMsl, 1, "m")} />
        </div>
        <div className="mt-2 rounded-lg border border-white/5 bg-black/20 p-2 font-mono text-[11px] text-slate-300">
          {formatNumber(telemetry.position.lat, 7)}, {formatNumber(telemetry.position.lon, 7)}
        </div>
      </Panel>

      <Panel title="Attitude">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Roll" value={formatNumber(telemetry.motion.rollDeg, 1, "deg")} />
          <Metric label="Pitch" value={formatNumber(telemetry.motion.pitchDeg, 1, "deg")} />
          <Metric label="Yaw" value={formatNumber(telemetry.motion.yawDeg, 1, "deg")} />
          <Metric label="Climb" value={formatNumber(telemetry.motion.climbRate, 1, "m/s")} />
        </div>
      </Panel>

      <Panel title="Radio / Link">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="RSSI" value={formatInteger(telemetry.radio.rssi)} tone={radioTone(telemetry.radio.rssi)} />
          <Metric label="Remote RSSI" value={formatInteger(telemetry.radio.remRssi)} tone={radioTone(telemetry.radio.remRssi)} />
          <Metric label="TX Buffer" value={formatInteger(telemetry.radio.txBuffer, "%")} />
          <Metric label="RX Errors" value={formatInteger(telemetry.radio.rxErrors)} />
          <Metric label="Link Quality" value={formatInteger(telemetry.radio.linkQuality, "%")} tone={radioTone(telemetry.radio.linkQuality)} />
          <Metric label="Fixed" value={formatInteger(telemetry.radio.fixed)} />
        </div>
      </Panel>

      <Panel title="System">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Metric label="Load" value={formatNumber(telemetry.system.loadPercent, 1, "%")} />
          <Metric label="Sensors" value={sensorSummary} tone={sensorSummary === "Healthy" ? "good" : "warn"} />
        </div>
        <div className="space-y-1">
          {telemetry.system.statusText.length === 0 ? (
            <div className="text-xs text-slate-500">No STATUSTEXT messages</div>
          ) : (
            telemetry.system.statusText.slice(0, 6).map((message, index) => (
              <div key={`${message}-${index}`} className="rounded border border-white/5 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-300">
                {message}
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel title="Session Stats">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Max Alt" value={formatNumber(telemetry.stats.maxAltitude, 1, "m")} />
          <Metric label="Max Speed" value={formatNumber(telemetry.stats.maxSpeed, 1, "m/s")} />
          <Metric label="Max Distance" value={formatNumber(telemetry.stats.maxDistance, 0, "m")} />
          <Metric label="Min Voltage" value={formatNumber(telemetry.stats.minVoltage, 2, "V")} />
          <Metric label="Min RSSI" value={formatInteger(telemetry.stats.minRssi)} />
          <Metric label="Warnings" value={formatInteger(telemetry.stats.warningCount)} tone={telemetry.stats.warningCount > 0 ? "warn" : "good"} />
        </div>
      </Panel>
    </aside>
  );
}

function radioTone(value: number | null): "default" | "good" | "warn" | "bad" {
  if (value === null) return "default";
  if (value >= 70) return "good";
  if (value >= 35) return "warn";
  return "bad";
}

function sensorHealthSummary(telemetry: TelemetryState): string {
  const enabled = telemetry.system.sensorsEnabled;
  const health = telemetry.system.sensorsHealth;
  if (enabled === undefined || health === undefined) return "Unknown";
  return (enabled & ~health) === 0 ? "Healthy" : "Fault";
}
