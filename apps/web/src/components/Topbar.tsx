import { useEffect, useState } from "react";
import type { BackendStatus, LoggingStatus, SerialPortInfo } from "@uav-ground-control-station/shared";
import { Badge } from "./Panel";

const baudRates = [57600, 115200, 420000, 460800];
const manualPortValue = "__manual__";

interface TopbarProps {
  ports: SerialPortInfo[];
  status: BackendStatus;
  loggingStatus: LoggingStatus;
  runtimeMode: "web" | "desktop";
  wsConnected: boolean;
  packetCount: number;
  packetAge: string;
  onRefreshPorts: () => Promise<void>;
  onConnect: (path: string, baudRate: number) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onReset: () => Promise<void>;
  onStartLogging: () => Promise<void>;
  onStopLogging: () => Promise<void>;
}

export function Topbar({
  ports,
  status,
  loggingStatus,
  runtimeMode,
  wsConnected,
  packetCount,
  packetAge,
  onRefreshPorts,
  onConnect,
  onDisconnect,
  onReset,
  onStartLogging,
  onStopLogging
}: TopbarProps) {
  const [selectedPath, setSelectedPath] = useState("");
  const [manualPath, setManualPath] = useState("");
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
    runtimeMode === "desktop" ? "Native bridge" : wsConnected ? "WS online" : "WS offline";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="relative z-20 shrink-0 border-b border-cyan-300/10 bg-slate-950/92 px-3 py-2 shadow-glow backdrop-blur sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 shrink">
          <div className="truncate text-[10px] uppercase tracking-[0.28em] text-cyan-300/80 sm:text-[11px] sm:tracking-[0.32em]">
            Local GCS
          </div>
          <h1 className="truncate text-base font-semibold tracking-wide text-slate-50 sm:text-lg">
            <span className="xl:hidden">UAV GCS</span>
            <span className="hidden xl:inline">UAV Ground Control Station</span>
          </h1>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-0 max-w-full flex-1 basis-[min(100%,14rem)] rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 sm:min-w-[12rem] sm:max-w-md sm:px-3"
            value={selectedPath}
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
              className="h-9 min-w-0 max-w-full flex-1 basis-[min(100%,10rem)] rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 sm:max-w-[14rem] sm:px-3"
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="COM3, /dev/cu.*"
            />
          )}

          <select
            className="h-9 shrink-0 rounded-lg border border-cyan-300/20 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60 sm:px-3"
            value={baudRate}
            onChange={(event) => setBaudRate(Number(event.target.value))}
          >
            {baudRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button className="btn-secondary whitespace-nowrap" disabled={busy} onClick={() => run(onRefreshPorts)}>
              Refresh
            </button>

            {status.serialConnected ? (
              <button className="btn-danger whitespace-nowrap" disabled={busy} onClick={() => run(onDisconnect)}>
                Disconnect
              </button>
            ) : (
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busy || !connectPath}
                onClick={() => run(() => onConnect(connectPath, baudRate))}
              >
                Connect
              </button>
            )}

            <button className="btn-secondary whitespace-nowrap" disabled={busy} onClick={() => run(onReset)}>
              Reset
            </button>

            {loggingStatus.active ? (
              <button
                className="btn-secondary whitespace-nowrap border-yellow-300/30 text-yellow-100"
                disabled={busy}
                onClick={() => run(onStopLogging)}
              >
                Stop Log
              </button>
            ) : (
              <button className="btn-secondary whitespace-nowrap" disabled={busy} onClick={() => run(onStartLogging)}>
                Start Log
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
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

      </div>

      {status.lastSerialError && (
        <div className="mt-2 max-w-full rounded-lg border border-red-400/30 bg-red-950/90 px-3 py-2 text-xs text-red-100 shadow-glow sm:absolute sm:right-4 sm:top-full sm:mt-1 sm:max-w-xl">
          Serial: {status.lastSerialError}
        </div>
      )}
    </header>
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
