import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const refreshPorts = useCallback(async () => {
    if (mode === "desktop") {
      setPorts(await invokeTauri<SerialPortInfo[]>("list_ports"));
    } else {
      setPorts(await requestJson<SerialPortInfo[]>("/api/ports"));
    }
  }, [mode]);

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
  }, [mode]);

  const disconnect = useCallback(async () => {
    setError(null);
    if (mode === "desktop") {
      setStatus(await invokeTauri<BackendStatus>("disconnect"));
    } else {
      setStatus(await requestJson<BackendStatus>("/api/disconnect", { method: "POST" }));
    }
  }, [mode]);

  const resetSession = useCallback(async () => {
    if (mode === "desktop") {
      setTelemetry(await invokeTauri<TelemetryState>("reset_session"));
    } else {
      setTelemetry(await requestJson<TelemetryState>("/api/reset", { method: "POST" }));
    }
  }, [mode]);

  const startLogging = useCallback(async () => {
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("start_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/start", { method: "POST" }));
    }
  }, [mode]);

  const stopLogging = useCallback(async () => {
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("stop_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/stop", { method: "POST" }));
    }
  }, [mode]);

  useEffect(() => {
    refreshPorts().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load ports."));
    refreshStatus().catch(() => undefined);
  }, [refreshPorts, refreshStatus]);

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
      error,
      wsConnected,
      runtimeMode: mode,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging
    }),
    [
      telemetry,
      status,
      loggingStatus,
      ports,
      error,
      wsConnected,
      mode,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging
    ]
  );
}
