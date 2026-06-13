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
import { createEmptyTelemetryState, normalizeTelemetryState } from "../lib/initialTelemetry";
import {
  connectFailureMessage,
  describeConnectFailure,
  describeNoParsedFrames,
  describeNoRawBytes,
  describeParserSpike,
  describeSerialError,
  linkIssueLogMessage,
  type LinkConnection
} from "../lib/linkErrors";
import { runtimeMode } from "../lib/runtimeMode";
import { downloadJsonlSession, SessionRecorder, type SessionRecorderSnapshot } from "../lib/sessionRecorder";
import { WebSerialLink } from "../link/webSerialLink";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

/** Default baud for the cloud runtime: TX16S CRSF telem mirror (420000). */
const CLOUD_DEFAULT_BAUD = 420000;

const initialStatus: BackendStatus = {
  serialConnected: false,
  mavlinkPackets: 0,
  lastPacketMs: null,
  rawBytes: 0,
  txBytes: 0,
  parserErrors: 0,
  lastSerialError: null
};

const initialLoggingStatus: LoggingStatus = {
  active: false,
  filePath: null
};

type ServerMessage = TelemetryEnvelope | StatusEnvelope;

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
  const [linkConnection, setLinkConnection] = useState<LinkConnection | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const statusRef = useRef(status);
  const lastStatusRef = useRef(status);
  const activeConnectionRef = useRef<{ path: string; baudRate: number; startedAt: number } | null>(null);
  const warningStateRef = useRef({ noRawBytes: false, noMavlinkPackets: false });
  const nextLogIdRef = useRef(1);
  const webSerialLinkRef = useRef<WebSerialLink | null>(null);
  const sessionRecorderRef = useRef<SessionRecorder | null>(null);
  const sessionSoftWarnLoggedRef = useRef(false);
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionRecorderSnapshot>({
    eventCount: 0,
    approximateBytes: 0,
    softWarnExceeded: false
  });

  const browserSessionExportEnabled = mode === "cloud" || mode === "web";

  const addLog = useCallback((level: ActivityLogEntry["level"], message: string) => {
    const entry: ActivityLogEntry = {
      id: nextLogIdRef.current++,
      time: Date.now(),
      level,
      message
    };

    setLogs((current) => [entry, ...current].slice(0, 200));
  }, []);

  const refreshSessionSnapshot = useCallback(() => {
    const recorder = sessionRecorderRef.current;
    if (!recorder) {
      setSessionSnapshot({ eventCount: 0, approximateBytes: 0, softWarnExceeded: false });
      return;
    }
    setSessionSnapshot(recorder.snapshot);
  }, []);

  const recordSessionActivity = useCallback(
    (level: ActivityLogEntry["level"], message: string) => {
      if (!browserSessionExportEnabled) return;
      const recorder = sessionRecorderRef.current;
      if (!recorder) return;
      const mappedLevel = level === "warning" ? "warn" : level === "success" ? "info" : level;
      recorder.recordActivity(mappedLevel, message);
      if (recorder.snapshot.softWarnExceeded && !sessionSoftWarnLoggedRef.current) {
        sessionSoftWarnLoggedRef.current = true;
        addLog(
          "warning",
          "Session buffer exceeded ~25 MB. Download the session soon or reset to avoid high memory use."
        );
      }
      refreshSessionSnapshot();
    },
    [addLog, browserSessionExportEnabled, refreshSessionSnapshot]
  );

  const clearSessionRecorder = useCallback(() => {
    sessionRecorderRef.current?.clear();
    sessionSoftWarnLoggedRef.current = false;
    refreshSessionSnapshot();
  }, [refreshSessionSnapshot]);

  const downloadSession = useCallback(() => {
    const recorder = sessionRecorderRef.current;
    if (!recorder?.hasBufferedEvents()) return;
    downloadJsonlSession(recorder.toJsonlText(), recorder.suggestedFileName());
    addLog("success", "Session downloaded as replay JSONL.");
  }, [addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const refreshPorts = useCallback(async () => {
    if (mode === "cloud") {
      // No device list in the browser — Web Serial uses its own picker on connect.
      setPorts([]);
      return;
    }
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
    if (mode === "cloud") {
      // Status is pushed by the Web Serial link's callbacks; nothing to poll.
      return;
    }
    if (mode === "desktop") {
      const [nextStatus, nextTelemetry, nextLoggingStatus] = await Promise.all([
        invokeTauri<BackendStatus>("get_status"),
        invokeTauri<TelemetryState>("get_telemetry"),
        invokeTauri<LoggingStatus>("logging_status")
      ]);
      setStatus(nextStatus);
      setTelemetry(normalizeTelemetryState(nextTelemetry));
      setLoggingStatus(nextLoggingStatus);
    } else {
      setStatus(await requestJson<BackendStatus>("/api/status"));
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/status"));
    }
  }, [mode]);

  const connect = useCallback(async (request: ConnectRequest) => {
    setError(null);
    warningStateRef.current = { noRawBytes: false, noMavlinkPackets: false };

    if (mode === "cloud") {
      const baudRate = request.baudRate ?? CLOUD_DEFAULT_BAUD;
      activeConnectionRef.current = { path: "Web Serial device", baudRate, startedAt: Date.now() };
      setLinkConnection(activeConnectionRef.current);
      addLog("info", `Opening a serial device at ${baudRate} baud via the browser picker.`);
      try {
        await webSerialLinkRef.current?.connect(baudRate);
        // Success is logged by the link's onOpen callback; telemetry flows via callbacks.
      } catch (cause: unknown) {
        activeConnectionRef.current = null;
        setLinkConnection(null);
        const message = connectFailureMessage(cause);
        setError(message);
        addLog("error", linkIssueLogMessage(describeConnectFailure(cause)));
        recordSessionActivity("error", linkIssueLogMessage(describeConnectFailure(cause)));
        throw cause;
      }
      return;
    }

    activeConnectionRef.current = {
      path: request.path,
      baudRate: request.baudRate ?? 420000,
      startedAt: Date.now()
    };
    setLinkConnection(activeConnectionRef.current);
    addLog("info", `Opening ${request.path} at ${request.baudRate ?? 420000} baud.`);

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
      addLog("success", `Serial port opened: ${request.path}. 8N1/no-flow-control, DTR/RTS enabled, initial GCS heartbeat written.`);
      recordSessionActivity("success", `Serial port opened: ${request.path}.`);
    } catch (cause: unknown) {
      const message = connectFailureMessage(cause);
      activeConnectionRef.current = null;
      setLinkConnection(null);
      setError(message);
      addLog("error", linkIssueLogMessage(describeConnectFailure(cause)));
      recordSessionActivity("error", linkIssueLogMessage(describeConnectFailure(cause)));
      throw cause;
    }
  }, [addLog, mode, recordSessionActivity]);

  const disconnect = useCallback(async () => {
    setError(null);
    if (mode === "cloud") {
      await webSerialLinkRef.current?.disconnect("Disconnected by operator.");
      addLog("info", "Serial device disconnected.");
      recordSessionActivity("info", "Serial device disconnected.");
      activeConnectionRef.current = null;
      setLinkConnection(null);
      return;
    }
    if (mode === "desktop") {
      setStatus(await invokeTauri<BackendStatus>("disconnect"));
    } else {
      setStatus(await requestJson<BackendStatus>("/api/disconnect", { method: "POST" }));
    }
    addLog("info", "Serial port disconnected.");
    recordSessionActivity("info", "Serial port disconnected.");
    activeConnectionRef.current = null;
    setLinkConnection(null);
  }, [addLog, mode, recordSessionActivity]);

  const resetSession = useCallback(async () => {
    clearSessionRecorder();
    if (mode === "cloud") {
      webSerialLinkRef.current?.resetSession();
      warningStateRef.current = { noRawBytes: false, noMavlinkPackets: false };
      addLog("info", "Telemetry session reset.");
      return;
    }
    if (mode === "desktop") {
      setTelemetry(normalizeTelemetryState(await invokeTauri<TelemetryState>("reset_session")));
    } else {
      setTelemetry(normalizeTelemetryState(await requestJson<TelemetryState>("/api/reset", { method: "POST" })));
    }
    warningStateRef.current = { noRawBytes: false, noMavlinkPackets: false };
    addLog("info", "Telemetry session reset.");
  }, [addLog, clearSessionRecorder, mode]);

  const startLogging = useCallback(async () => {
    if (mode === "cloud") {
      addLog("info", "Use Download session in the top bar to save replay JSONL locally. Nothing is uploaded.");
      return;
    }
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("start_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/start", { method: "POST" }));
    }
    addLog("success", "Telemetry JSONL logging started.");
  }, [addLog, mode]);

  const stopLogging = useCallback(async () => {
    if (mode === "cloud") {
      return;
    }
    if (mode === "desktop") {
      setLoggingStatus(await invokeTauri<LoggingStatus>("stop_logging"));
    } else {
      setLoggingStatus(await requestJson<LoggingStatus>("/api/logging/stop", { method: "POST" }));
    }
    addLog("info", "Telemetry JSONL logging stopped.");
  }, [addLog, mode]);

  useEffect(() => {
    const modeLabel =
      mode === "desktop" ? "Tauri desktop" : mode === "cloud" ? "cloud (Web Serial)" : "browser";
    addLog("info", `Runtime initialized in ${modeLabel} mode.`);
    refreshPorts().catch(() => undefined);
    refreshStatus().catch(() => undefined);
  }, [addLog, mode, refreshPorts, refreshStatus]);

  useEffect(() => {
    if (mode !== "cloud") {
      return;
    }

    const link = new WebSerialLink({
      onTelemetry: (next) => setTelemetry(normalizeTelemetryState(next)),
      onStatus: (next) => setStatus(next),
      onOpen: () => {
        setWsConnected(true);
        setError(null);
        addLog("success", "Serial device opened via Web Serial.");
        recordSessionActivity("success", "Serial device opened via Web Serial.");
      },
      onClose: (reason) => {
        setWsConnected(false);
        activeConnectionRef.current = null;
        setLinkConnection(null);
        const issue = describeSerialError(reason);
        const message = issue ? linkIssueLogMessage(issue) : `Serial link closed: ${reason}`;
        addLog("warning", message);
        recordSessionActivity("warning", message);
      }
    });
    webSerialLinkRef.current = link;

    return () => {
      webSerialLinkRef.current = null;
      void link.disconnect("Leaving the dashboard.");
    };
  }, [addLog, mode, recordSessionActivity]);

  useEffect(() => {
    statusRef.current = status;
    const previous = lastStatusRef.current;

    if (!previous.serialConnected && status.serialConnected) {
      addLog("success", "Serial connection is active.");
      recordSessionActivity("success", "Serial connection is active.");
    }

    if (previous.serialConnected && !status.serialConnected) {
      addLog("warning", "Serial connection closed.");
      recordSessionActivity("warning", "Serial connection closed.");
    }

    if ((previous.rawBytes ?? 0) === 0 && (status.rawBytes ?? 0) > 0) {
      addLog("success", `Raw serial bytes detected (${status.rawBytes?.toLocaleString()}B).`);
    }

    if ((previous.txBytes ?? 0) === 0 && (status.txBytes ?? 0) > 0) {
      addLog("info", `Outbound wake-up bytes sent (${status.txBytes?.toLocaleString()}B).`);
    }

    if (previous.mavlinkPackets === 0 && status.mavlinkPackets > 0) {
      addLog("success", `Telemetry frames detected (${status.mavlinkPackets.toLocaleString()}).`);
    }

    if (
      status.serialConnected &&
      (status.parserErrors ?? 0) > (previous.parserErrors ?? 0)
    ) {
      const issue = describeParserSpike(status);
      if (issue) {
        const message = linkIssueLogMessage(issue);
        addLog("warning", message);
        recordSessionActivity("warning", message);
      }
    }

    if (status.lastSerialError && status.lastSerialError !== previous.lastSerialError) {
      const issue = describeSerialError(status.lastSerialError);
      const message = issue ? linkIssueLogMessage(issue) : `Serial error: ${status.lastSerialError}`;
      addLog("error", message);
      recordSessionActivity("error", message);
    }

    lastStatusRef.current = status;
  }, [addLog, recordSessionActivity, status]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentStatus = statusRef.current;
      const connection = activeConnectionRef.current;
      if (!connection || !currentStatus.serialConnected) return;

      const elapsedMs = Date.now() - connection.startedAt;
      const rawBytes = currentStatus.rawBytes ?? 0;
      const txBytes = currentStatus.txBytes ?? 0;
      const packets = currentStatus.mavlinkPackets;

      if (elapsedMs > 3000 && rawBytes === 0 && !warningStateRef.current.noRawBytes) {
        warningStateRef.current.noRawBytes = true;
        addLog("warning", linkIssueLogMessage(describeNoRawBytes(connection, txBytes)));
      }

      if (elapsedMs > 5000 && rawBytes > 0 && packets === 0 && !warningStateRef.current.noMavlinkPackets) {
        warningStateRef.current.noMavlinkPackets = true;
        addLog("warning", linkIssueLogMessage(describeNoParsedFrames(connection)));
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [addLog]);

  useEffect(() => {
    // The WebSocket transport is only for the Node-server "web" runtime.
    // Desktop uses the Tauri event bridge; cloud uses the Web Serial link.
    if (mode !== "web") {
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
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          addLog("warning", "Discarded a malformed telemetry message from the server.");
          return;
        }
        if (message.type === "telemetry") {
          setTelemetry(normalizeTelemetryState(message.data));
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
  }, [addLog, mode]);

  useEffect(() => {
    if (mode !== "desktop") {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async (): Promise<(() => void) | undefined> => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenTelemetry = await listen<TelemetryState>("telemetry", (event) => {
        setTelemetry(normalizeTelemetryState(event.payload));
      });
      const unlistenStatus = await listen<BackendStatus>("status", (event) => {
        setStatus(event.payload);
      });

      if (disposed) {
        await Promise.all([unlistenTelemetry(), unlistenStatus()]);
        return undefined;
      }

      setWsConnected(true);
      setError(null);
      addLog("success", "Desktop event bridge connected.");

      return () => {
        void Promise.all([unlistenTelemetry(), unlistenStatus()]);
      };
    };

    setup()
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : "Unable to initialize desktop event listeners.";
        addLog(
          "warning",
          `${message} Falling back to 1s polling. Rebuild the desktop app if this persists after an MSI upgrade.`
        );
        setWsConnected(false);
      });

    return () => {
      disposed = true;
      cleanup?.();
      setWsConnected(false);
    };
  }, [addLog, mode]);

  useEffect(() => {
    if (mode !== "desktop") {
      return;
    }

    const timer = window.setInterval(() => {
      refreshStatus().catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "Unable to refresh desktop status.";
        setError(message);
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [mode, refreshStatus]);

  useEffect(() => {
    if (!browserSessionExportEnabled) {
      sessionRecorderRef.current = null;
      refreshSessionSnapshot();
      return;
    }

    const recorder = new SessionRecorder();
    sessionRecorderRef.current = recorder;
    recorder.recordActivity("info", "Browser session recording started.");
    refreshSessionSnapshot();

    return () => {
      sessionRecorderRef.current = null;
    };
  }, [browserSessionExportEnabled, refreshSessionSnapshot]);

  useEffect(() => {
    if (!browserSessionExportEnabled) return;
    sessionRecorderRef.current?.recordTelemetry(telemetry);
    refreshSessionSnapshot();
  }, [browserSessionExportEnabled, refreshSessionSnapshot, telemetry]);

  useEffect(() => {
    if (!browserSessionExportEnabled || sessionSnapshot.eventCount === 0) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [browserSessionExportEnabled, sessionSnapshot.eventCount]);

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
      browserSessionExportEnabled,
      sessionSnapshot,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs,
      downloadSession,
      linkConnection
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
      browserSessionExportEnabled,
      sessionSnapshot,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs,
      downloadSession,
      linkConnection
    ]
  );
}
