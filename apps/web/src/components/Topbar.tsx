import { useEffect, useState } from "react";
import type {
  BackendStatus,
  LoggingStatus,
  SerialPortInfo,
  TelemetrySourceMode
} from "@uav-ground-control-station/shared";
import { appVersionLabel } from "../lib/appVersion";
import type { LinkIssue } from "../lib/linkErrors";
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
  onDownloadSession?: () => void;
  sessionEventCount?: number;
  sessionExportEnabled?: boolean;
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
  onDownloadSession,
  sessionEventCount = 0,
  sessionExportEnabled = false,
  onRestartTour,
  linkIssues = []
}: TopbarProps) {
  const isCloud = runtimeMode === "cloud";
  const [selectedPath, setSelectedPath] = useState("");
  const [manualPath, setManualPath] = useState("");
  // Cloud defaults to TX16S CRSF (420000); 115200/460800 are for direct FC MAVLink USB.
  const [baudRate, setBaudRate] = useState(420000);
  const [busy, setBusy] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

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
    <header data-tour="topbar" className="operator-topbar">
      <div className="operator-topbar__main">
        <div className="operator-topbar__identity">
          <div className="operator-topbar__eyebrow">
            {isCloud ? "Hosted Web App" : runtimeMode === "desktop" ? "Native operator station" : "Local development runtime"}
            <span className="ml-2 font-mono tracking-normal">{appVersionLabel()}</span>
          </div>
          <h1 className="operator-topbar__title">
            {isFlightReview ? "Flight Review" : "UAV Ground Control Station"}
          </h1>
        </div>

        {isFlightReview ? (
          <div className="flex items-center gap-8">
            <SourceModeBadge mode="replay" />
            {replayFileName && (
              <span className="max-w-64 truncate font-mono text-[9px] text-amber-200" title={replayFileName}>
                {replayFileName}
              </span>
            )}
          </div>
        ) : (
          <SourceModeSwitch activeSourceMode={activeSourceMode} onSetSourceMode={onSetSourceMode} />
        )}

        <div data-tour="link-status" className="operator-topbar__status">
          <SourceModeBadge mode={activeSourceMode} />
          <span className={`state-indicator state-indicator--${badgeTone}`}>{badgeText}</span>
          <span className={`state-indicator state-indicator--${wsConnected ? "good" : "neutral"}`}>{bridgeLabel}</span>
          <Stat label="Frames" value={packetCount.toLocaleString()} />
          <Stat label="Age" value={packetAge} tone={telemetryLive ? "default" : "warn"} />
          {(status.parserErrors ?? 0) > 0 && <Stat label="Err" value={String(status.parserErrors)} tone="warn" />}
          <div className="operator-topbar__tools">
            <button
              type="button"
              className="operator-button operator-button--square"
              title="Restart onboarding tour"
              aria-label="Restart onboarding tour"
              onClick={onRestartTour}
            >
              ?
            </button>
            {isFlightReview ? (
              <button type="button" className="operator-button" onClick={onBackToDashboard}>
                Back to dashboard
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="operator-button"
                  aria-expanded={controlsOpen}
                  onClick={() => setControlsOpen((open) => !open)}
                >
                  Link setup
                </button>
                {status.serialConnected ? (
                  <button className="btn-danger" disabled={busy || liveControlsLocked} onClick={() => run(onDisconnect)}>
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={busy || liveControlsLocked || (!isCloud && !connectPath)}
                    onClick={() => run(() => onConnect(isCloud ? "" : connectPath, baudRate))}
                  >
                    Connect
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {!isFlightReview && controlsOpen && (
        <div data-tour="serial-connect" className="operator-topbar__drawer">
          <div className="flex min-w-0 items-center gap-2">
            {isCloud ? (
              <span className="truncate text-[10px] text-slate-400">
                Browser device picker opens on Connect. Telemetry stays in your browser.
              </span>
            ) : (
              <>
                <select
                  className="operator-input min-w-48 flex-1"
                  value={selectedPath}
                  disabled={liveControlsLocked}
                  onChange={(event) => setSelectedPath(event.target.value)}
                >
                  <option value="">{ports.length === 0 ? "No serial devices visible" : "Select telemetry link"}</option>
                  {ports.map((port) => (
                    <option key={port.path} value={port.path}>{serialPortLabel(port)}</option>
                  ))}
                  <option value={manualPortValue}>Manual path…</option>
                </select>
                {selectedPath === manualPortValue && (
                  <input
                    className="operator-input w-44"
                    value={manualPath}
                    disabled={liveControlsLocked}
                    onChange={(event) => setManualPath(event.target.value)}
                    placeholder="COM3, /dev/cu.*"
                  />
                )}
              </>
            )}
            <select
              className="operator-input w-24"
              value={baudRate}
              disabled={liveControlsLocked}
              onChange={(event) => setBaudRate(Number(event.target.value))}
            >
              {baudRates.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1">
            {!isCloud && (
              <button className="operator-button" disabled={busy || liveControlsLocked} onClick={() => run(onRefreshPorts)}>
                Scan
              </button>
            )}
            <button className="operator-button" disabled={busy || liveControlsLocked} onClick={() => run(onReset)}>
              Reset session
            </button>
            {!isCloud && (loggingStatus.active ? (
              <button className="operator-button text-amber-200" disabled={busy || liveControlsLocked} onClick={() => run(onStopLogging)}>
                Stop log
              </button>
            ) : (
              <button className="operator-button" disabled={busy || liveControlsLocked} onClick={() => run(onStartLogging)}>
                Start log
              </button>
            ))}
            {sessionExportEnabled && (
              <button
                className="operator-button"
                disabled={busy || sessionEventCount === 0}
                title={sessionEventCount === 0 ? "No session telemetry buffered." : "Download replay JSONL locally."}
                onClick={() => onDownloadSession?.()}
              >
                Export session
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            <Stat label="RX" value={`${(status.rawBytes ?? 0).toLocaleString()} B`} />
            <Stat label="TX" value={`${(status.txBytes ?? 0).toLocaleString()} B`} />
            {isCloud && (
              <span title="GPS and flight data never leave your browser." className="text-emerald-300">
                <ShieldIcon />
              </span>
            )}
          </div>
        </div>
      )}

      {liveConnectedInBackground && (
        <div className="operator-notice border-emerald-400/30 bg-emerald-950/30 text-emerald-200">
          Live telemetry link remains connected in the background. {activeSourceMode === "simulation" ? "Simulation" : "Replay"} is read-only.
        </div>
      )}

      {linkIssues.map((issue) => <LinkIssueBanner key={issue.id} issue={issue} />)}
    </header>
  );
}

function LinkIssueBanner({ issue }: { issue: LinkIssue }) {
  const toneClass =
    issue.severity === "error"
      ? "border-red-400/40 bg-red-950/30 text-red-200"
      : "border-amber-400/40 bg-amber-950/25 text-amber-200";

  return (
    <div className={`operator-notice flex items-center justify-center gap-3 normal-case tracking-normal ${toneClass}`}>
      <strong className="uppercase tracking-[0.12em]">{issue.title}</strong>
      <span>{issue.message}</span>
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
    <div data-tour="source-mode" className="source-mode-switch">
      {sourceModes.map(({ mode, label }) => {
        const active = mode === activeSourceMode;
        return (
          <button
            key={mode}
            type="button"
            data-mode={mode}
            aria-pressed={active}
            onClick={() => onSetSourceMode(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SourceModeBadge({ mode }: { mode: TelemetrySourceMode }) {
  const config = {
    live: { label: "LIVE", className: "state-indicator--good" },
    replay: { label: "REPLAY", className: "state-indicator--warn" },
    simulation: { label: "SIM", className: "text-slate-300" }
  }[mode];

  return <span className={`state-indicator ${config.className}`}>{config.label}</span>;
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
  const valueClass = tone === "warn" ? "text-amber-200" : "";
  return (
    <span className={`status-readout ${className}`}>
      <span className="status-readout__label">{label}</span>
      <span className={`status-readout__value ${valueClass}`}>{value}</span>
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
