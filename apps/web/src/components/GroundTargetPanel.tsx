import type { DragEvent } from "react";
import type { TargetEstimateInvalidReason, TargetEstimationSettings } from "@uav-ground-control-station/shared";
import { formatNumber } from "../lib/format";
import type { TargetEstimationController } from "../hooks/useTargetEstimation";
import { Badge, Metric, Panel } from "./Panel";

interface GroundTargetPanelProps extends TargetEstimationController {
  sortable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

export function GroundTargetPanel({
  estimate,
  settings,
  setSettings,
  terrainMetadata,
  terrainPath,
  setTerrainPath,
  loadTerrainModel,
  browseTerrainModel,
  clearTerrainModel,
  runtimeMode,
  liveOnlyBlocked,
  sampleLogCount,
  sampleLogCapacity,
  exportSampleLogJson,
  exportSampleLogCsv,
  clearSampleLog,
  saveSampleLogWithDialog,
  sortable,
  onDragStart,
  onDragEnd
}: GroundTargetPanelProps) {
  const qualityTone = estimate ? qualityToTone(estimate.quality) : ("neutral" as const);

  return (
    <Panel
      title="Ground Target"
      {...(sortable ? { sortable: true, onDragStart, onDragEnd } : {})}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={qualityTone}>{estimate?.quality ?? "idle"}</Badge>
        {liveOnlyBlocked && <Badge tone="warn">live only</Badge>}
        {estimate?.valid === false && estimate.reasons.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{estimate.reasons.join(", ")}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Target Lat" value={formatNumber(estimate?.lat, 6)} tone={metricTone(estimate)} />
        <Metric label="Target Lon" value={formatNumber(estimate?.lon, 6)} tone={metricTone(estimate)} />
        <Metric label="Slant Range" value={formatNumber(estimate?.slantRangeM, 0, " m")} tone={metricTone(estimate)} />
        <Metric label="Ground Range" value={formatNumber(estimate?.groundRangeM, 0, " m")} tone={metricTone(estimate)} />
        <Metric label="Depression" value={formatNumber(estimate?.depressionAngleDeg, 1, " deg")} tone={metricTone(estimate)} />
        <Metric label="Terrain Elev" value={formatNumber(estimate?.terrainElevationM, 1, " m")} tone={metricTone(estimate)} />
      </div>

      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">Video latency (ms)</label>
        <input
          className="input-dark w-full"
          type="number"
          min={0}
          step={10}
          value={settings.videoLatencyMs}
          onChange={(event) =>
            setSettings({
              ...settings,
              videoLatencyMs: Math.max(0, Number(event.target.value) || 0)
            })
          }
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Altitude mode
            <select
              className="input-dark mt-1 w-full"
              value={settings.altitudeMode}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  altitudeMode: event.target.value as TargetEstimationSettings["altitudeMode"]
                })
              }
            >
              <option value="amsl">AMSL</option>
              <option value="relative">Relative</option>
            </select>
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Alt offset (m)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              step={0.1}
              value={settings.altitudeOffsetM}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  altitudeOffsetM: Number(event.target.value) || 0
                })
              }
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={settings.camera.allowBodyFixedWhenGimbalMissing}
            onChange={(event) =>
              setSettings({
                ...settings,
                camera: {
                  ...settings.camera,
                  allowBodyFixedWhenGimbalMissing: event.target.checked
                }
              })
            }
          />
          Allow body-fixed camera fallback
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Roll cal (deg)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              step={0.1}
              value={settings.camera.calibrationDeg.roll}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  camera: {
                    ...settings.camera,
                    calibrationDeg: {
                      ...settings.camera.calibrationDeg,
                      roll: Number(event.target.value) || 0
                    }
                  }
                })
              }
            />
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Pitch cal (deg)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              step={0.1}
              value={settings.camera.calibrationDeg.pitch}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  camera: {
                    ...settings.camera,
                    calibrationDeg: {
                      ...settings.camera.calibrationDeg,
                      pitch: Number(event.target.value) || 0
                    }
                  }
                })
              }
            />
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Yaw cal (deg)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              step={0.1}
              value={settings.camera.calibrationDeg.yaw}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  camera: {
                    ...settings.camera,
                    calibrationDeg: {
                      ...settings.camera.calibrationDeg,
                      yaw: Number(event.target.value) || 0
                    }
                  }
                })
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Max raycast (m)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              min={100}
              step={100}
              value={settings.raycast.maxRangeM}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  raycast: {
                    ...settings.raycast,
                    maxRangeM: Math.max(100, Number(event.target.value) || 100)
                  }
                })
              }
            />
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Raycast step (m)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              min={1}
              step={1}
              value={settings.raycast.stepM}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  raycast: {
                    ...settings.raycast,
                    stepM: Math.max(1, Number(event.target.value) || 1)
                  }
                })
              }
            />
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Min down angle (deg)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              min={0}
              step={0.5}
              value={settings.raycast.minDownAngleDeg}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  raycast: {
                    ...settings.raycast,
                    minDownAngleDeg: Math.max(0, Number(event.target.value) || 0)
                  }
                })
              }
            />
          </label>
          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Stale telemetry (ms)
            <input
              className="input-dark mt-1 w-full"
              type="number"
              min={100}
              step={50}
              value={settings.raycast.staleTelemetryWarnMs}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  raycast: {
                    ...settings.raycast,
                    staleTelemetryWarnMs: Math.max(100, Number(event.target.value) || 100)
                  }
                })
              }
            />
          </label>
        </div>

        {runtimeMode === "desktop" ? (
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">Terrain model (GeoTIFF)</label>
            <input
              className="input-dark w-full"
              value={terrainPath}
              onChange={(event) => setTerrainPath(event.target.value)}
              placeholder="/path/to/dem.tif"
            />
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => void browseTerrainModel()}>
                Browse…
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={() => void loadTerrainModel()}>
                Reload
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={() => void clearTerrainModel()}>
                Clear
              </button>
            </div>
            {terrainMetadata && (
              <div className="rounded-lg border border-white/5 bg-black/20 p-2 font-mono text-[10px] text-slate-400">
                {terrainMetadata.horizontalCrs} · {terrainMetadata.verticalDatum} · {formatNumber(terrainMetadata.resolutionM, 1, " m")}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-cyan-300/10 bg-cyan-400/5 p-2 text-[11px] text-cyan-100/80">
            Browser dev uses synthetic flat terrain only. Load a real DEM in the desktop app.
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
            <span>Target sample log</span>
            <span className="font-mono text-slate-400">
              {sampleLogCount}/{sampleLogCapacity}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={exportSampleLogJson}>
              Export JSON
            </button>
            <button type="button" className="btn-secondary" onClick={exportSampleLogCsv}>
              Export CSV
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={clearSampleLog}>
              Clear log
            </button>
            {runtimeMode === "desktop" ? (
              <>
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => void saveSampleLogWithDialog("json")}
                >
                  Save JSON…
                </button>
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => void saveSampleLogWithDialog("csv")}
                >
                  Save CSV…
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function qualityToTone(quality: "good" | "warn" | "bad"): "good" | "warn" | "bad" {
  return quality;
}

function metricTone(estimate: TargetEstimationController["estimate"]): "default" | "good" | "warn" | "bad" {
  if (!estimate) return "default";
  if (estimate.valid) return estimate.quality === "warn" ? "warn" : "good";
  if (estimate.quality === "warn") return "warn";
  return "bad";
}

export function formatTargetReason(reason: TargetEstimateInvalidReason): string {
  return reason.replaceAll("_", " ");
}
