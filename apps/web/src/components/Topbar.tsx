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

  const mavlinkLive = status.serialConnected && status.lastPacketMs !== null && status.lastPacketMs < 3000;
  const badgeTone = mavlinkLive ? "good" : status.serialConnected ? "warn" : "bad";
  const badgeText = mavlinkLive ? "MAVLink live" : status.serialConnected ? "Serial linked" : "No link";
  const connectPath = selectedPath === manualPortValue ? manualPath.trim() : selectedPath;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="z-20 flex h-16 items-center gap-3 border-b border-cyan-300/10 bg-slate-950/92 px-4 shadow-glow backdrop-blur">
      <div className="min-w-[230px]">
        <div className="text-[11px] uppercase tracking-[0.32em] text-cyan-300/80">UAV</div>
        <h1 className="text-lg font-semibold tracking-wide text-slate-50">UAV Ground Control Station</h1>
      </div>

      <select
        className="h-9 min-w-[300px] rounded-lg border border-cyan-300/20 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
        value={selectedPath}
        onChange={(event) => setSelectedPath(event.target.value)}
      >
        <option value="">{ports.length === 0 ? "No device-backed serial ports visible" : "Select serial port"}</option>
        {ports.map((port) => (
          <option key={port.path} value={port.path}>
            {serialPortLabel(port)}
          </option>
        ))}
        <option value={manualPortValue}>Manual path...</option>
      </select>

      {selectedPath === manualPortValue && (
        <input
          className="h-9 w-[250px] rounded-lg border border-cyan-300/20 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
          value={manualPath}
          onChange={(event) => setManualPath(event.target.value)}
          placeholder="COM3, /dev/cu.*, /dev/ttyACM0"
        />
      )}

      <select
        className="h-9 rounded-lg border border-cyan-300/20 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
        value={baudRate}
        onChange={(event) => setBaudRate(Number(event.target.value))}
      >
        {baudRates.map((rate) => (
          <option key={rate} value={rate}>
            {rate}
          </option>
        ))}
      </select>

      <button className="btn-secondary" disabled={busy} onClick={() => run(onRefreshPorts)}>
        Refresh
      </button>

      {status.serialConnected ? (
        <button className="btn-danger" disabled={busy} onClick={() => run(onDisconnect)}>
          Disconnect
        </button>
      ) : (
        <button className="btn-primary" disabled={busy || !connectPath} onClick={() => run(() => onConnect(connectPath, baudRate))}>
          Connect
        </button>
      )}

      {ports.length === 0 && (
        <span className="max-w-[320px] text-xs leading-tight text-yellow-200/90">
          {runtimeMode === "desktop"
            ? "No host serial devices visible. Check the USB cable, radio USB mode, and Windows driver."
            : "TX16S on Windows is not visible to a WSL backend until the USB serial device is attached to WSL."}
        </span>
      )}

      <button className="btn-secondary" disabled={busy} onClick={() => run(onReset)}>
        Reset
      </button>

      {loggingStatus.active ? (
        <button className="btn-secondary border-yellow-300/30 text-yellow-100" disabled={busy} onClick={() => run(onStopLogging)}>
          Stop Log
        </button>
      ) : (
        <button className="btn-secondary" disabled={busy} onClick={() => run(onStartLogging)}>
          Start Log
        </button>
      )}

      <div className="ml-auto flex items-center gap-3 text-xs text-slate-300">
        <Badge tone={badgeTone}>{badgeText}</Badge>
        <Badge tone={wsConnected ? "good" : "bad"}>{runtimeMode === "desktop" ? "Native bridge" : wsConnected ? "WS online" : "WS offline"}</Badge>
        <span className="font-mono">Raw {(status.rawBytes ?? 0).toLocaleString()}B</span>
        <span className="font-mono">Tx {(status.txBytes ?? 0).toLocaleString()}B</span>
        <span className="font-mono">Packets {packetCount.toLocaleString()}</span>
        {(status.parserErrors ?? 0) > 0 && <span className="font-mono text-yellow-200">Parse errors {status.parserErrors}</span>}
        <span className="font-mono">Last {packetAge}</span>
      </div>
      {status.lastSerialError && (
        <div className="absolute right-4 top-[4.25rem] z-30 max-w-xl rounded-lg border border-red-400/30 bg-red-950/90 px-3 py-2 text-xs text-red-100 shadow-glow">
          Serial: {status.lastSerialError}
        </div>
      )}
    </header>
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
