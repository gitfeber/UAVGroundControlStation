import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BackendStatus,
  ConnectRequest,
  LoggingStatus,
  SerialPortInfo,
  StatusEnvelope,
  TelemetryEnvelope,
  TelemetryState
} from "@uav-ground-control-station/shared";
import { createEmptyTelemetryState } from "../lib/initialTelemetry";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

const initialStatus: BackendStatus = {
  serialConnected: false,
  mavlinkPackets: 0,
  lastPacketMs: null,
  rawBytes: 0,
  parserErrors: 0,
  lastSerialError: null
};

const initialLoggingStatus: LoggingStatus = {
  active: false,
  filePath: null
};

type ServerMessage = TelemetryEnvelope | StatusEnvelope;
type RuntimeMode = "web" | "desktop";

export interface ActivityLogEntry {
  id: number;
  time: number;
  level: "info" | "warning" | "error" | "success";
  message: string;
}

function websocketUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function runtimeMode(): RuntimeMode {
  return window.__TAURI_INTERNALS__ ? "desktop" : "web";
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof body.error === "string" ? body.error : response.statusText);
  }

  return response.json() as Promise<T>;
}

export function useTelemetry() {
  const mode = runtimeMode();
  const [telemetry, setTelemetry] = useState<TelemetryState>(() => createEmptyTelemetryState());
  const [status, setStatus] = useState<BackendStatus>(initialStatus);
  const [loggingStatus, setLoggingStatus] = useState<LoggingStatus>(initialLoggingStatus);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const statusRef = useRef(status);
  const lastStatusRef = useRef(status);
  const activeConnectionRef = useRef<{ path: string; baudRate: number; startedAt: number } | null>(null);
  const warningStateRef = useRef({ noRawBytes: false, noMavlinkPackets: false });
  const nextLogIdRef = useRef(1);

  const addLog = useCallback((level: ActivityLogEntry["level"], message: string) => {
    const entry: ActivityLogEntry = {
      id: nextLogIdRef.current++,
      time: Date.now(),
      level,
      message
    };

    setLogs((current) => [entry, ...current].slice(0, 200));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const nextPorts =
        mode === "desktop"
          ? await invokeTauri<SerialPortInfo[]>("list_ports")
          : await requestJson<SerialPortInfo[]>("/api/ports");

      setPorts(nextPorts);
      addLog(nextPorts.length > 0 ? "info" : "warning", `Port scan found ${nextPorts.length} device-backed serial port${nextPorts.length === 1 ? "" : "s"}.`);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Unable to load ports.";
      setError(message);
      addLog("error", `Port scan failed: ${message}`);
    }
  }, [addLog, mode]);

  const refreshStatus = useCallback(async () => {
    if (mode === "desktop") {
      setStatus(await invokeTauri<BackendStatus>("get_status"));
      setLoggingStatus(await invokeTauri<LoggingStatus>("logging_status"));
    } else {
      setStatus(await requestJson<BackendStatus>("/api/status"));
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/status"));
    }
  }, [mode]);

  const connect = useCallback(async (request: ConnectRequest) => {
    setError(null);
    activeConnectionRef.current = {
      path: request.path,
      baudRate: request.baudRate ?? 460800,
      startedAt: Date.now()
    };
    warningStateRef.current = { noRawBytes: false, noMavlinkPackets: false };
    addLog("info", `Opening ${request.path} at ${request.baudRate ?? 460800} baud.`);

    try {
      if (mode === "desktop") {
        setStatus(await invokeTauri<BackendStatus>("connect", { request }));
      } else {
        setStatus(
          await requestJson<BackendStatus>("/api/connect", {
            method: "POST",
            body: JSON.stringify(request)
          })
        );
      }
      addLog("success", `Serial port opened: ${request.path}. Waiting for MAVLink bytes.`);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Unable to connect serial port.";
      activeConnectionRef.current = null;
      setError(message);
      addLog("error", `Connect failed: ${message}`);
      throw cause;
    }
  }, [addLog, mode]);

  const disconnect = useCallback(async () => {
    setError(null);
    if (mode === "desktop") {
      setStatus(await invokeTauri<BackendStatus>("disconnect"));
    } else {
      setStatus(await requestJson<BackendStatus>("/api/disconnect", { method: "POST" }));
    }
    addLog("info", "Serial port disconnected.");
    activeConnectionRef.current = null;
  }, [addLog, mode]);

  const resetSession = useCallback(async () => {
    if (mode === "desktop") {
      setTelemetry(await invokeTauri<TelemetryState>("reset_session"));
    } else {
      setTelemetry(await requestJson<TelemetryState>("/api/reset", { method: "POST" }));
    }
    warningStateRef.current = { noRawBytes: false, noMavlinkPackets: false };
    addLog("info", "Telemetry session reset.");
  }, [addLog, mode]);

  const startLogging = useCallback(async () => {
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("start_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/start", { method: "POST" }));
    }
    addLog("success", "Telemetry JSONL logging started.");
  }, [addLog, mode]);

  const stopLogging = useCallback(async () => {
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("stop_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/stop", { method: "POST" }));
    }
    addLog("info", "Telemetry JSONL logging stopped.");
  }, [addLog, mode]);

  useEffect(() => {
    addLog("info", `Runtime initialized in ${mode === "desktop" ? "Tauri desktop" : "browser"} mode.`);
    refreshPorts().catch(() => undefined);
    refreshStatus().catch(() => undefined);
  }, [addLog, mode, refreshPorts, refreshStatus]);

  useEffect(() => {
    statusRef.current = status;
    const previous = lastStatusRef.current;

    if (!previous.serialConnected && status.serialConnected) {
      addLog("success", "Serial connection is active.");
    }

    if (previous.serialConnected && !status.serialConnected) {
      addLog("warning", "Serial connection closed.");
    }

    if ((previous.rawBytes ?? 0) === 0 && (status.rawBytes ?? 0) > 0) {
      addLog("success", `Raw serial bytes detected (${status.rawBytes?.toLocaleString()}B).`);
    }

    if (previous.mavlinkPackets === 0 && status.mavlinkPackets > 0) {
      addLog("success", `MAVLink packets detected (${status.mavlinkPackets.toLocaleString()}).`);
    }

    if ((status.parserErrors ?? 0) > (previous.parserErrors ?? 0)) {
      addLog("warning", `Parser errors increased to ${status.parserErrors}. Check baud rate or protocol.`);
    }

    if (status.lastSerialError && status.lastSerialError !== previous.lastSerialError) {
      addLog("error", `Serial error: ${status.lastSerialError}`);
    }

    lastStatusRef.current = status;
  }, [addLog, status]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentStatus = statusRef.current;
      const connection = activeConnectionRef.current;
      if (!connection || !currentStatus.serialConnected) return;

      const elapsedMs = Date.now() - connection.startedAt;
      const rawBytes = currentStatus.rawBytes ?? 0;
      const packets = currentStatus.mavlinkPackets;

      if (elapsedMs > 3000 && rawBytes === 0 && !warningStateRef.current.noRawBytes) {
        warningStateRef.current.noRawBytes = true;
        addLog(
          "warning",
          `No serial bytes after 3s on ${connection.path}. Check TX16S USB mode, cable, driver, selected COM port, and whether telemetry is enabled.`
        );
      }

      if (elapsedMs > 5000 && rawBytes > 0 && packets === 0 && !warningStateRef.current.noMavlinkPackets) {
        warningStateRef.current.noMavlinkPackets = true;
        addLog(
          "warning",
          `Serial bytes are arriving on ${connection.path}, but no MAVLink packets were parsed. Try 460800, 115200, or 57600 baud, and verify the port outputs MAVLink v1/v2 rather than joystick/storage/CRSF data.`
        );
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [addLog]);

  useEffect(() => {
    if (mode === "desktop") {
      return;
    }

    let closedByEffect = false;
    let retryTimer: number | null = null;

    const open = () => {
      const ws = new WebSocket(websocketUrl());

      ws.addEventListener("open", () => {
        setWsConnected(true);
        setError(null);
      });

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "telemetry") {
          setTelemetry(message.data);
        } else if (message.type === "status") {
          setStatus(message.data);
        }
      });

      ws.addEventListener("close", () => {
        setWsConnected(false);
        if (!closedByEffect) {
          retryTimer = window.setTimeout(open, 1000);
        }
      });

      ws.addEventListener("error", () => {
        setWsConnected(false);
      });

      return ws;
    };

    const ws = open();

    return () => {
      closedByEffect = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      ws.close();
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "desktop") {
      return;
    }

    let disposed = false;
    setWsConnected(true);

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenTelemetry = await listen<TelemetryState>("telemetry", (event) => {
        setTelemetry(event.payload);
      });
      const unlistenStatus = await listen<BackendStatus>("status", (event) => {
        setStatus(event.payload);
      });

      if (disposed) {
        unlistenTelemetry();
        unlistenStatus();
      }

      return () => {
        unlistenTelemetry();
        unlistenStatus();
      };
    };

    let cleanup: (() => void) | undefined;
    setup()
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to initialize desktop bridge."));

    return () => {
      disposed = true;
      cleanup?.();
      setWsConnected(false);
    };
  }, [mode]);

  return useMemo(
    () => ({
      telemetry,
      status,
      loggingStatus,
      ports,
      logs,
      error,
      wsConnected,
      runtimeMode: mode,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs
    }),
    [
      telemetry,
      status,
      loggingStatus,
      ports,
      logs,
      error,
      wsConnected,
      mode,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs
    ]
  );
}
