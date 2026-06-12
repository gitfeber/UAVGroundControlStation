import { useEffect, useState } from "react";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import type { AlertItem } from "../lib/alerts";
import { clampBatteryPercent, elapsedTime, formatInteger, formatNumber, percentageColor } from "../lib/format";
import { sensorHealthSummary } from "../lib/sensorHealth";
import { defaultSidebarOrder, loadSidebarOrder, saveSidebarOrder, type SidebarCardId } from "../lib/sidebarCardOrder";
import type { PreflightHealth } from "../lib/preflight";
import type { TargetEstimationController } from "../hooks/useTargetEstimation";
import { GroundTargetPanel } from "./GroundTargetPanel";
import { Badge, Metric, Panel } from "./Panel";
import { PreflightHealthCard } from "./PreflightHealthCard";
import type { SidebarDragHandlers } from "./SidebarSortableList";
import { SidebarSortableList } from "./SidebarSortableList";
import { TelemetryInstruments } from "./TelemetryInstruments";

type SidebarView = "text" | "instruments";

const SIDEBAR_VIEW_KEY = "uav-gcs.sidebar.view";

interface TelemetrySidebarProps {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
  alerts: AlertItem[];
  preflight: PreflightHealth;
  targetEstimation: TargetEstimationController;
  telemetryStale?: boolean;
}

export function TelemetrySidebar({
  telemetry,
  distanceFromHome,
  alerts,
  preflight,
  targetEstimation,
  telemetryStale = false
}: TelemetrySidebarProps) {
  const [view, setView] = useState<SidebarView>(() => readSidebarView());
  const [cardOrder, setCardOrder] = useState<SidebarCardId[]>(() => loadSidebarOrder());
  const batteryPercent = clampBatteryPercent(telemetry.battery.remainingPercent);
  const sensorSummary = sensorHealthSummary(telemetry);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    saveSidebarOrder(cardOrder);
  }, [cardOrder]);

  return (
    <aside
      data-tour="telemetry-sidebar"
      className={`z-10 flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-cyan-300/10 bg-slate-950/78 p-3 backdrop-blur ${
        telemetryStale ? "opacity-70 saturate-75" : ""
      }`}
    >
      {telemetryStale && (
        <div className="rounded border border-amber-400/40 bg-amber-950/40 px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
          Link stale — data may be outdated
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Telemetry</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-cyan-300/20 bg-slate-900/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-500 transition hover:border-cyan-300/40 hover:text-cyan-100"
            title="Reset card order to recommended flight priority"
            aria-label="Reset card order to recommended flight priority"
            onClick={() => setCardOrder(defaultSidebarOrder())}
          >
            Reset
          </button>
          <SidebarViewToggle view={view} onChange={setView} />
        </div>
      </div>

      <div data-tour="preflight-health">
        <PreflightHealthCard health={preflight} />
      </div>

      <div data-tour="alerts">
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
      </div>

      {view === "instruments" ? (
        <TelemetryInstruments
          telemetry={telemetry}
          distanceFromHome={distanceFromHome}
          order={cardOrder}
          onOrderChange={setCardOrder}
        />
      ) : (
        <SidebarSortableList
          mode="text"
          order={cardOrder}
          onOrderChange={setCardOrder}
          renderCard={(id, drag) => renderTextCard(id, { telemetry, distanceFromHome, batteryPercent, sensorSummary, targetEstimation }, drag)}
        />
      )}
    </aside>
  );
}

interface TextRenderContext {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
  batteryPercent: number | null;
  sensorSummary: string;
  targetEstimation: TargetEstimationController;
}

function renderTextCard(id: SidebarCardId, ctx: TextRenderContext, drag: SidebarDragHandlers) {
  const { telemetry, distanceFromHome, batteryPercent, sensorSummary, targetEstimation } = ctx;
  const sortable = { sortable: true as const, onDragStart: drag.onDragStart, onDragEnd: drag.onDragEnd };

  switch (id) {
    case "groundTarget":
      return (
        <GroundTargetPanel
          {...targetEstimation}
          sortable
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
        />
      );
    case "vehicle":
      return (
        <Panel title="Vehicle" {...sortable}>
          <div className="mb-3 flex items-center justify-between">
            <Badge tone={telemetry.vehicle.armed ? "bad" : "good"}>{telemetry.vehicle.armed ? "Armed" : "Safe"}</Badge>
            <span className="font-mono text-xs text-slate-400">
              SYS {telemetry.vehicle.systemId ?? "--"} / COMP {telemetry.vehicle.componentId ?? "--"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Mode" value={telemetry.vehicle.flightMode} tone="good" />
            <Metric label="Type" value={telemetry.vehicle.type} />
            <Metric label="Base Mode" value={formatInteger(telemetry.vehicle.baseMode)} />
            <Metric label="SYS" value={formatInteger(telemetry.vehicle.systemId)} />
          </div>
        </Panel>
      );
    case "attitude":
      return (
        <Panel title="Attitude" {...sortable}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Roll" value={formatNumber(telemetry.motion.rollDeg, 1, "deg")} />
            <Metric label="Pitch" value={formatNumber(telemetry.motion.pitchDeg, 1, "deg")} />
            <Metric label="Yaw" value={formatNumber(telemetry.motion.yawDeg, 1, "deg")} />
            <Metric label="Climb" value={formatNumber(telemetry.motion.climbRate, 1, "m/s")} />
          </div>
        </Panel>
      );
    case "gps":
      return (
        <Panel title="GPS / Navigation" {...sortable}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Fix" value={telemetry.gps.fixLabel} tone={(telemetry.gps.fixType ?? 0) >= 3 ? "good" : "warn"} />
            <Metric label="Satellites" value={formatInteger(telemetry.gps.satellites)} />
            <Metric label="EPH" value={formatNumber(telemetry.gps.eph, 2)} />
            <Metric label="Rel Alt" value={formatNumber(telemetry.position.relativeAlt, 1, "m")} />
            <Metric label="Groundspeed" value={formatNumber(telemetry.motion.groundSpeed, 1, "m/s")} />
            <Metric
              label="Heading"
              value={formatNumber(telemetry.position.headingDeg ?? telemetry.position.groundCourseDeg, 0, "deg")}
            />
            <Metric label="Home Dist." value={formatNumber(distanceFromHome, 0, "m")} />
            <Metric label="MSL Alt" value={formatNumber(telemetry.position.altMsl, 1, "m")} />
          </div>
          <div className="mt-2 rounded-lg border border-white/5 bg-black/20 p-2 font-mono text-[11px] text-slate-300">
            {formatNumber(telemetry.position.lat, 7)}, {formatNumber(telemetry.position.lon, 7)}
          </div>
        </Panel>
      );
    case "battery":
      return (
        <Panel title="Battery" {...sortable}>
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Battery</span>
              <span className="font-mono">{formatInteger(batteryPercent, "%")}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full ${percentageColor(batteryPercent)}`}
                style={{ width: `${Math.max(0, Math.min(100, batteryPercent ?? 0))}%` }}
              />
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
      );
    case "radio":
      return (
        <Panel title="Radio / Link" {...sortable}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="RSSI" value={formatInteger(telemetry.radio.rssi)} tone={radioTone(telemetry.radio.rssi)} />
            <Metric label="Remote RSSI" value={formatInteger(telemetry.radio.remRssi)} tone={radioTone(telemetry.radio.remRssi)} />
            <Metric label="TX Buffer" value={formatInteger(telemetry.radio.txBuffer, "%")} />
            <Metric label="RX Errors" value={formatInteger(telemetry.radio.rxErrors)} />
            <Metric
              label="Link Quality"
              value={formatInteger(telemetry.radio.linkQuality, "%")}
              tone={radioTone(telemetry.radio.linkQuality)}
            />
            <Metric label="Fixed" value={formatInteger(telemetry.radio.fixed)} />
          </div>
        </Panel>
      );
    case "system":
      return (
        <Panel title="System" {...sortable}>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Metric label="Load" value={formatNumber(telemetry.system.loadPercent, 1, "%")} />
            <Metric label="Sensors" value={sensorSummary} tone={sensorSummary === "Healthy" ? "good" : "warn"} />
          </div>
          <div className="space-y-1">
            {telemetry.system.statusText.length === 0 ? (
              <div className="text-xs text-slate-500">No STATUSTEXT messages</div>
            ) : (
              telemetry.system.statusText.slice(0, 6).map((message, index) => (
                <div
                  key={`${message}-${index}`}
                  className="rounded border border-white/5 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-300"
                >
                  {message}
                </div>
              ))
            )}
          </div>
        </Panel>
      );
    case "session":
      return (
        <Panel title="Session Stats" {...sortable}>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Metric label="Session" value={elapsedTime(telemetry.stats.sessionStartedAt)} />
            <Metric label="COMP" value={formatInteger(telemetry.vehicle.componentId)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Max Alt" value={formatNumber(telemetry.stats.maxAltitude, 1, "m")} />
            <Metric label="Max Speed" value={formatNumber(telemetry.stats.maxSpeed, 1, "m/s")} />
            <Metric label="Max Distance" value={formatNumber(telemetry.stats.maxDistance, 0, "m")} />
            <Metric label="Min Voltage" value={formatNumber(telemetry.stats.minVoltage, 2, "V")} />
            <Metric label="Min RSSI" value={formatInteger(telemetry.stats.minRssi)} />
            <Metric
              label="Warnings"
              value={formatInteger(telemetry.stats.warningCount)}
              tone={telemetry.stats.warningCount > 0 ? "warn" : "good"}
            />
          </div>
        </Panel>
      );
    default:
      return null;
  }
}

function SidebarViewToggle({ view, onChange }: { view: SidebarView; onChange: (view: SidebarView) => void }) {
  return (
    <div data-tour="sidebar-view-toggle" className="flex rounded-lg border border-cyan-300/20 bg-slate-900/80 p-0.5 font-mono text-[10px]">
      <button
        type="button"
        className={toggleClass(view === "text")}
        onClick={() => onChange("text")}
        aria-pressed={view === "text"}
      >
        Text
      </button>
      <button
        type="button"
        className={toggleClass(view === "instruments")}
        onClick={() => onChange("instruments")}
        aria-pressed={view === "instruments"}
      >
        Inst
      </button>
    </div>
  );
}

function toggleClass(active: boolean): string {
  return `rounded-md px-2 py-1 uppercase tracking-wider transition ${
    active ? "bg-cyan-500/20 text-cyan-100" : "text-slate-500 hover:text-slate-300"
  }`;
}

function readSidebarView(): SidebarView {
  const stored = localStorage.getItem(SIDEBAR_VIEW_KEY);
  return stored === "instruments" ? "instruments" : "text";
}

function radioTone(value: number | null): "default" | "good" | "warn" | "bad" {
  if (value === null) return "default";
  if (value >= 70) return "good";
  if (value >= 35) return "warn";
  return "bad";
}
