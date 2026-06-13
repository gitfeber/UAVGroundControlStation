import { useEffect, useState } from "react";
import type {
  BackendStatus,
  LoggingStatus,
  SerialPortInfo,
  TelemetrySourceMode
} from "@uav-ground-control-station/shared";
import { appVersionLabel } from "../lib/appVersion";
import type { LinkIssue } from "../lib/linkErrors";
import { Badge } from "./Panel";
import type { ActiveView } from "../flightReview";

const baudRates = [57600, 115200, 420000, 460800];
const manualPortValue = "__manual__";

interface TopbarProps {
  ports: SerialPortInfo[];
  status: BackendStatus;
  loggingStatus: LoggingStatus;
  runtimeMode: "web" | "desktop" | "cloud";
  wsConnected: boolean;
  packetCount: number;
  packetAge: string;
  activeSourceMode: TelemetrySourceMode;
  activeView?: ActiveView;
  replayFileName?: string | null;
  liveControlsLocked: boolean;
  liveConnectedInBackground: boolean;
  onSetSourceMode: (mode: TelemetrySourceMode) => void;
  onBackToDashboard?: () => void;
  onRefreshPorts: () => Promise<void>;
  onConnect: (path: string, baudRate: number) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onReset: () => Promise<void>;
  onStartLogging: () => Promise<void>;
  onStopLogging: () => Promise<void>;
  onRestartTour: () => void;
  linkIssues?: LinkIssue[];
}

export function Topbar({
  ports,
  status,
  loggingStatus,
  runtimeMode,
  wsConnected,
  packetCount,
  packetAge,
  activeSourceMode,
  activeView = "dashboard",
  replayFileName = null,
  liveControlsLocked,
  liveConnectedInBackground,
  onSetSourceMode,
  onBackToDashboard,
  onRefreshPorts,
  onConnect,
  onDisconnect,
  onReset,
  onStartLogging,
  onStopLogging,
  onRestartTour,
  linkIssues = []
}: TopbarProps) {
  const isCloud = runtimeMode === "cloud";
  const [selectedPath, setSelectedPath] = useState("");
  const [manualPath, setManualPath] = useState("");
  // Cloud defaults to TX16S CRSF (420000); 115200/460800 are for direct FC MAVLink USB.
  const [baudRate, setBaudRate] = useState(420000);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedPath && ports.length > 0 && ports[0]) {
      setSelectedPath(ports[0].path);
    }
  }, [ports, selectedPath]);

  const telemetryLive = status.serialConnected && status.lastPacketMs !== null && status.lastPacketMs < 3000;
  const badgeTone = telemetryLive ? "good" : status.serialConnected ? "warn" : "bad";
  const badgeText = telemetryLive ? "Telemetry live" : status.serialConnected ? "Serial linked" : "No link";
  const connectPath = selectedPath === manualPortValue ? manualPath.trim() : selectedPath;
  const bridgeLabel =
    runtimeMode === "desktop"
      ? "Native bridge"
      : isCloud
        ? wsConnected
          ? "Web Serial"
          : "Web Serial idle"
        : wsConnected
          ? "WS online"
          : "WS offline";

  const isFlightReview = activeView === "flightReview";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <header
      data-tour="topbar"
      className="relative z-20 shrink-0 border-b border-cyan-300/10 bg-slate-950/92 px-3 py-2 shadow-glow backdrop-blur sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 shrink">
          <div className="flex min-w-0 items-baseline gap-2">
            <div className="truncate text-[10px] uppercase tracking-[0.28em] text-cyan-300/80 sm:text-[11px] sm:tracking-[0.32em]">
              {isCloud ? "Hosted Web App" : "Local GCS"}
            </div>
            <span className="shrink-0 font-mono text-[10px] font-medium text-cyan-300/55 sm:text-[11px]">
              {appVersionLabel()}
            </span>
          </div>
          <h1 className="truncate text-base font-semibold tracking-wide text-slate-50 sm:text-lg">
            {isFlightReview ? (
              "Flight Review"
            ) : (
              <>
                <span className="xl:hidden">UAV GCS</span>
                <span className="hidden xl:inline">UAV Ground Control Station</span>
              </>
            )}
          </h1>
          {isFlightReview && replayFileName && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-amber-200/90" title={replayFileName}>
              {replayFileName}
            </p>
          )}
          {isCloud && (
            <p
              className="mt-0.5 cursor-help truncate text-[10px] font-medium text-emerald-300/90 sm:text-[11px]"
              title="Only the USB device you select via the browser picker is accessed. GPS and flight data never leave your browser."
            >
              <span className="mr-1 inline-flex align-middle text-emerald-200/90" aria-hidden="true">
                <ShieldIcon />
              </span>
              Telemetry stays in your browser.
            </p>
          )}
        </div>

        {isFlightReview ? (
          <div className="ml-auto flex items-center gap-2">
            <SourceModeBadge mode="replay" />
            <button type="button" className="btn-secondary whitespace-nowrap" onClick={onBackToDashboard}>
              Back to dashboard
            </button>
          </div>
        ) : (
          <>
        <SourceModeSwitch activeSourceMode={activeSourceMode} onSetSourceMode={onSetSourceMode} />

        <div data-tour="serial-connect" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {isCloud ? (
            <span className="min-w-0 flex-1 basis-[min(100%,18rem)] truncate text-xs text-slate-400 sm:text-sm">
              Click Connect — your browser will prompt to pick the serial device.
            </span>
          ) : (
            <>
              <select
                className="h-9 min-w-0 max-w-full flex-1 basis-[min(100%,14rem)] rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[12rem] sm:max-w-md sm:px-3"
                value={selectedPath}
                disabled={liveControlsLocked}
                onChange={(event) => setSelectedPath(event.target.value)}
              >
                <option value="">{ports.length === 0 ? "No serial ports visible" : "Select serial port"}</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {serialPortLabel(port)}
                  </option>
                ))}
                <option value={manualPortValue}>Manual path...</option>
              </select>

              {selectedPath === manualPortValue && (
                <input
                  className="h-9 min-w-0 max-w-full flex-1 basis-[min(100%,10rem)] rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40 sm:max-w-[14rem] sm:px-3"
                  value={manualPath}
                  disabled={liveControlsLocked}
                  onChange={(event) => setManualPath(event.target.value)}
                  placeholder="COM3, /dev/cu.*"
                />
              )}
            </>
          )}

          <select
            className="h-9 shrink-0 rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
            value={baudRate}
            disabled={liveControlsLocked}
            onChange={(event) => setBaudRate(Number(event.target.value))}
          >
            {baudRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!isCloud && (
              <button className="btn-secondary whitespace-nowrap" disabled={busy || liveControlsLocked} onClick={() => run(onRefreshPorts)}>
                Refresh
              </button>
            )}

            {status.serialConnected ? (
              <button className="btn-danger whitespace-nowrap" disabled={busy || liveControlsLocked} onClick={() => run(onDisconnect)}>
                Disconnect
              </button>
            ) : (
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busy || liveControlsLocked || (!isCloud && !connectPath)}
                onClick={() => run(() => onConnect(isCloud ? "" : connectPath, baudRate))}
              >
                Connect
              </button>
            )}

            <button className="btn-secondary whitespace-nowrap" disabled={busy || liveControlsLocked} onClick={() => run(onReset)}>
              Reset
            </button>

            {!isCloud &&
              (loggingStatus.active ? (
                <button
                  className="btn-secondary whitespace-nowrap border-yellow-300/30 text-yellow-100"
                  disabled={busy || liveControlsLocked}
                  onClick={() => run(onStopLogging)}
                >
                  Stop Log
                </button>
              ) : (
                <button className="btn-secondary whitespace-nowrap" disabled={busy || liveControlsLocked} onClick={() => run(onStartLogging)}>
                  Start Log
                </button>
              ))}
          </div>
        </div>

        <div data-tour="link-status" className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-slate-900 text-sm font-bold text-cyan-200/90 transition hover:border-cyan-300/50 hover:text-cyan-100"
            title="Restart onboarding tour"
            aria-label="Restart onboarding tour"
            onClick={onRestartTour}
          >
            ?
          </button>
          <SourceModeBadge mode={activeSourceMode} />
          <Badge tone={badgeTone}>{badgeText}</Badge>
          <Badge tone={wsConnected ? "good" : "bad"}>{bridgeLabel}</Badge>
          <Stat label="Raw" value={`${(status.rawBytes ?? 0).toLocaleString()}B`} />
          <Stat label="Tx" value={`${(status.txBytes ?? 0).toLocaleString()}B`} />
          <Stat label="Packets" value={packetCount.toLocaleString()} className="hidden lg:inline" />
          <Stat label="Pkts" value={packetCount.toLocaleString()} className="lg:hidden" />
          {(status.parserErrors ?? 0) > 0 && (
            <Stat label="Err" value={String(status.parserErrors)} tone="warn" className="hidden md:inline" />
          )}
          <Stat label="Last" value={packetAge} />
        </div>
          </>
        )}

      </div>

      {liveConnectedInBackground && (
        <div className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-950/60 px-3 py-1.5 text-[11px] text-emerald-100">
          Live connected in background — serial link stays open and untouched while {activeSourceMode === "simulation" ? "simulating" : "replaying"}.
        </div>
      )}

      {linkIssues.length > 0 && (
        <div className="mt-2 space-y-2">
          {linkIssues.map((issue) => (
            <LinkIssueBanner key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </header>
  );
}

function LinkIssueBanner({ issue }: { issue: LinkIssue }) {
  const toneClass =
    issue.severity === "error"
      ? "border-red-400/30 bg-red-950/90 text-red-100"
      : "border-amber-400/35 bg-amber-950/80 text-amber-100";

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs shadow-glow ${toneClass}`}>
      <div className="font-semibold uppercase tracking-[0.12em]">{issue.title}</div>
      <div className="mt-1 leading-snug">{issue.message}</div>
    </div>
  );
}

const sourceModes: { mode: TelemetrySourceMode; label: string }[] = [
  { mode: "live", label: "Live" },
  { mode: "replay", label: "Replay" },
  { mode: "simulation", label: "Simulation" }
];

function SourceModeSwitch({
  activeSourceMode,
  onSetSourceMode
}: {
  activeSourceMode: TelemetrySourceMode;
  onSetSourceMode: (mode: TelemetrySourceMode) => void;
}) {
  return (
    <div data-tour="source-mode" className="inline-flex shrink-0 overflow-hidden rounded-lg border border-cyan-300/20 bg-slate-900">
      {sourceModes.map(({ mode, label }) => {
        const active = mode === activeSourceMode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            className={`h-9 whitespace-nowrap px-3 text-xs font-semibold tracking-wide transition-colors ${
              active ? sourceModeActiveClass(mode) : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => onSetSourceMode(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function sourceModeActiveClass(mode: TelemetrySourceMode): string {
  if (mode === "replay") return "bg-amber-400/20 text-amber-200";
  if (mode === "simulation") return "bg-purple-400/20 text-purple-200";
  return "bg-emerald-400/20 text-emerald-200";
}

function SourceModeBadge({ mode }: { mode: TelemetrySourceMode }) {
  const config = {
    live: { label: "LIVE", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" },
    replay: { label: "REPLAY", className: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
    simulation: { label: "SIMULATION", className: "border-purple-400/40 bg-purple-400/10 text-purple-200" }
  }[mode];

  return (
    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${config.className}`}>
      {config.label}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  className = ""
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
  className?: string;
}) {
  const valueClass = tone === "warn" ? "text-yellow-200" : "text-slate-200";
  return (
    <span className={`whitespace-nowrap font-mono text-[11px] text-slate-500 sm:text-xs ${className}`}>
      <span className="text-slate-500">{label} </span>
      <span className={valueClass}>{value}</span>
    </span>
  );
}

function serialPortLabel(port: SerialPortInfo): string {
  const details = [
    transportLabel(port),
    port.vendorId && port.productId ? `VID:${port.vendorId} PID:${port.productId}` : null,
    port.serialNumber ? `SN:${port.serialNumber}` : null
  ].filter(Boolean);

  return details.length > 0 ? `${port.displayName} - ${details.join(" - ")}` : port.displayName;
}

function transportLabel(port: SerialPortInfo): string {
  if (port.transport === "usb") return "USB";
  if (port.transport === "windows-com") return "Windows COM";
  if (port.transport === "serial") return "Serial";
  return "Unknown";
}

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 4 7v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V7l-8-4z" />
    </svg>
  );
}
