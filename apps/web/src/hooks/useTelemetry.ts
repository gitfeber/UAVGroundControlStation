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
  lastPacketMs: null
};

const initialLoggingStatus: LoggingStatus = {
  active: false,
  filePath: null
};

type ServerMessage = TelemetryEnvelope | StatusEnvelope;

function websocketUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
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
  const [telemetry, setTelemetry] = useState<TelemetryState>(() => createEmptyTelemetryState());
  const [status, setStatus] = useState<BackendStatus>(initialStatus);
  const [loggingStatus, setLoggingStatus] = useState<LoggingStatus>(initialLoggingStatus);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const refreshPorts = useCallback(async () => {
    setPorts(await requestJson<SerialPortInfo[]>("/api/ports"));
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatus(await requestJson<BackendStatus>("/api/status"));
    setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/status"));
  }, []);

  const connect = useCallback(async (request: ConnectRequest) => {
    setError(null);
    setStatus(
      await requestJson<BackendStatus>("/api/connect", {
        method: "POST",
        body: JSON.stringify(request)
      })
    );
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    setStatus(await requestJson<BackendStatus>("/api/disconnect", { method: "POST" }));
  }, []);

  const resetSession = useCallback(async () => {
    setTelemetry(await requestJson<TelemetryState>("/api/reset", { method: "POST" }));
  }, []);

  const startLogging = useCallback(async () => {
    setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/start", { method: "POST" }));
  }, []);

  const stopLogging = useCallback(async () => {
    setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/stop", { method: "POST" }));
  }, []);

  useEffect(() => {
    refreshPorts().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load ports."));
    refreshStatus().catch(() => undefined);
  }, [refreshPorts, refreshStatus]);

  useEffect(() => {
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
  }, []);

  return useMemo(
    () => ({
      telemetry,
      status,
      loggingStatus,
      ports,
      error,
      wsConnected,
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
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging
    ]
  );
}
