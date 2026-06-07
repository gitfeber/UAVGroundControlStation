import { useCallback, useMemo, useState } from "react";
import type { ConnectRequest, TelemetryState, TelemetrySourceMode } from "@uav-ground-control-station/shared";
import { useTelemetry, type ActivityLogEntry } from "./useTelemetry";
import { useReplayController, type ReplayController } from "./useReplayController";

/**
 * Source-mode wrapper hook (ADR 0003, handoff §3/§4/§11).
 *
 * Wraps the live {@link useTelemetry} hook and the {@link useReplayController}
 * and exposes a single dashboard-facing surface. The displayed telemetry is
 * selected from the active source mode; live, replay, and simulation telemetry
 * stay internally separate. Only one mode drives the visible dashboard at a time.
 *
 * Live telemetry keeps running in the background while replaying/simulating.
 * Live session-mutating controls (connect/disconnect/reset/logging) are GUARDED
 * to no-op while a non-live mode is active, so replay/simulation can never
 * trigger serial writes, wake-up bytes, stream requests, or reconnect logic.
 */

export interface TelemetrySource {
  // Dashboard-facing surface (same names the dashboard already consumes).
  telemetry: TelemetryState;
  status: ReturnType<typeof useTelemetry>["status"];
  loggingStatus: ReturnType<typeof useTelemetry>["loggingStatus"];
  ports: ReturnType<typeof useTelemetry>["ports"];
  logs: ActivityLogEntry[];
  error: string | null;
  wsConnected: boolean;
  runtimeMode: "web" | "desktop";
  refreshPorts: () => Promise<void>;
  connect: (request: ConnectRequest) => Promise<void>;
  disconnect: () => Promise<void>;
  resetSession: () => Promise<void>;
  startLogging: () => Promise<void>;
  stopLogging: () => Promise<void>;
  clearLogs: () => void;

  // Source-mode surface.
  activeSourceMode: TelemetrySourceMode;
  setSourceMode: (mode: TelemetrySourceMode) => void;
  liveControlsLocked: boolean;
  liveConnectedInBackground: boolean;

  // Replay/simulation engine (controls, state, diagnostics, controlled track).
  replay: ReplayController;
}

export function useTelemetrySource(): TelemetrySource {
  const live = useTelemetry();
  const replay = useReplayController();
  const [activeSourceMode, setActiveSourceMode] = useState<TelemetrySourceMode>("live");

  const liveControlsLocked = activeSourceMode !== "live";

  // Displayed telemetry comes from exactly one source mode. The controller holds
  // both replay and simulation telemetry (simulation feeds the same engine).
  const telemetry = activeSourceMode === "live" ? live.telemetry : replay.replayTelemetry;

  const setSourceMode = useCallback(
    (mode: TelemetrySourceMode) => {
      setActiveSourceMode((current) => {
        if (mode === current) return current;
        // Leaving a non-live mode: halt the rAF driver but keep its state.
        if (current !== "live") replay.pause();
        // Switching directly between replay and simulation discards the prior load
        // so the dashboard never shows stale data under the wrong banner.
        if (current !== "live" && mode !== "live" && mode !== current) replay.stop();
        return mode;
      });
    },
    [replay]
  );

  const liveConnectedInBackground = liveControlsLocked && live.status.serialConnected;

  // Guard live session-mutating actions while replay/simulation is active.
  const connect = useCallback(
    (request: ConnectRequest) => (liveControlsLocked ? Promise.resolve() : live.connect(request)),
    [live, liveControlsLocked]
  );
  const disconnect = useCallback(
    () => (liveControlsLocked ? Promise.resolve() : live.disconnect()),
    [live, liveControlsLocked]
  );
  const resetSession = useCallback(
    () => (liveControlsLocked ? Promise.resolve() : live.resetSession()),
    [live, liveControlsLocked]
  );
  const startLogging = useCallback(
    () => (liveControlsLocked ? Promise.resolve() : live.startLogging()),
    [live, liveControlsLocked]
  );
  const stopLogging = useCallback(
    () => (liveControlsLocked ? Promise.resolve() : live.stopLogging()),
    [live, liveControlsLocked]
  );
  const refreshPorts = useCallback(
    () => (liveControlsLocked ? Promise.resolve() : live.refreshPorts()),
    [live, liveControlsLocked]
  );

  // Merge live + replay/sim activity logs (handoff §11): newest first, capped.
  const logs = useMemo(() => {
    return [...live.logs, ...replay.replaySimLogs]
      .sort((a, b) => b.time - a.time || b.id - a.id)
      .slice(0, 200);
  }, [live.logs, replay.replaySimLogs]);

  const clearLogs = useCallback(() => {
    live.clearLogs();
    replay.clearReplaySimLogs();
  }, [live, replay]);

  return useMemo(
    () => ({
      telemetry,
      status: live.status,
      loggingStatus: live.loggingStatus,
      ports: live.ports,
      logs,
      error: live.error,
      wsConnected: live.wsConnected,
      runtimeMode: live.runtimeMode,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs,
      activeSourceMode,
      setSourceMode,
      liveControlsLocked,
      liveConnectedInBackground,
      replay
    }),
    [
      telemetry,
      live.status,
      live.loggingStatus,
      live.ports,
      live.error,
      live.wsConnected,
      live.runtimeMode,
      logs,
      refreshPorts,
      connect,
      disconnect,
      resetSession,
      startLogging,
      stopLogging,
      clearLogs,
      activeSourceMode,
      setSourceMode,
      liveControlsLocked,
      liveConnectedInBackground,
      replay
    ]
  );
}
