import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NormalizedReplayEvent,
  ReplayControllerState,
  ReplayDiagnostics,
  ReplayFixedRateHz,
  ReplayLogMetadata,
  ReplaySpeedMode,
  ReplayStatus,
  ReplayTimingMode,
  SimulationOptions,
  TelemetrySourceMode,
  TelemetryState
} from "@uav-ground-control-station/shared";
import type { ActivityLogEntry } from "./useTelemetry";
import {
  DEFAULT_MAX_EVENTS_PER_CHUNK,
  type SchedulerConfig,
  advanceTo,
  seekTo,
  stepOnce,
  totalDurationMs
} from "../replay/scheduler";
import { createEmptyReplayState, foldEvents, type TrackPoint } from "../replay/reconstruct";
import type { ParseReplayLogResult } from "../replay/parser";
import { generateSimulationEvents, generateSimulationMetadata } from "../replay/simulation";

/**
 * Replay controller hook (ADR 0003, handoff §6/§9).
 *
 * Owns replay/simulation engine state and a thin requestAnimationFrame driver
 * over the pure scheduler core. All heavy logic (scheduling, reconstruction,
 * simulation) lives in tested pure modules; this hook only reads wall time,
 * commits React state once per frame, and guarantees rAF cleanup/idempotency.
 *
 * It NEVER touches serial, MAVLink, CRSF, wake-up bytes, or any hardware path.
 */

const RELOAD_MARKER_KEY = "uav-gcs.replay.playing";

interface Engine {
  events: NormalizedReplayEvent[];
  cursor: number;
  currentTimeMs: number;
  telemetry: TelemetryState;
  track: TrackPoint[];
  playStartWallMs: number;
  playStartVirtualMs: number;
  rafId: number | null;
  emittedTelemetry: number;
  emittedActivity: number;
  emittedDiagnostic: number;
  skipped: number;
  parseWarnings: number;
}

function createEngine(): Engine {
  return {
    events: [],
    cursor: 0,
    currentTimeMs: 0,
    telemetry: createEmptyReplayState(),
    track: [],
    playStartWallMs: 0,
    playStartVirtualMs: 0,
    rafId: null,
    emittedTelemetry: 0,
    emittedActivity: 0,
    emittedDiagnostic: 0,
    skipped: 0,
    parseWarnings: 0
  };
}

function initialDiagnostics(sourceMode: TelemetrySourceMode): ReplayDiagnostics {
  return {
    status: "idle",
    sourceMode,
    currentEventIndex: -1,
    currentReplayTimeMs: 0,
    durationMs: 0,
    emittedTelemetryEvents: 0,
    emittedActivityEvents: 0,
    emittedDiagnosticEvents: 0,
    skippedEvents: 0,
    parseWarnings: 0,
    lastError: null,
    averageEmitRateHz: 0
  };
}

function initialControllerState(): ReplayControllerState {
  return {
    sourceMode: "replay",
    status: "idle",
    timingMode: "original",
    speedMultiplier: 1,
    fixedRateHz: 20,
    currentEventIndex: -1,
    currentReplayTimeMs: 0,
    durationMs: 0,
    loadedFileName: null,
    metadata: null,
    lastError: null,
    diagnostics: initialDiagnostics("replay")
  };
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function activityLevelToLog(level: "debug" | "info" | "warn" | "error"): ActivityLogEntry["level"] {
  if (level === "warn") return "warning";
  if (level === "error") return "error";
  return "info";
}

export interface ReplayController {
  replayTelemetry: TelemetryState;
  replayTrack: TrackPoint[];
  replaySimLogs: ActivityLogEntry[];
  controllerState: ReplayControllerState;
  loadParsedLog: (result: ParseReplayLogResult) => void;
  loadSimulation: (options: SimulationOptions) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  restart: () => void;
  seek: (targetMs: number) => void;
  step: () => void;
  setTimingMode: (mode: ReplayTimingMode) => void;
  setSpeed: (speed: ReplaySpeedMode) => void;
  setFixedRate: (hz: ReplayFixedRateHz) => void;
  clearReplaySimLogs: () => void;
}

export function useReplayController(): ReplayController {
  const [replayTelemetry, setReplayTelemetry] = useState<TelemetryState>(createEmptyReplayState);
  const [replayTrack, setReplayTrack] = useState<TrackPoint[]>([]);
  const [replaySimLogs, setReplaySimLogs] = useState<ActivityLogEntry[]>([]);
  const [controllerState, setControllerState] = useState<ReplayControllerState>(initialControllerState);

  const engineRef = useRef<Engine>(createEngine());
  const configRef = useRef<{ timingMode: ReplayTimingMode; speedMultiplier: ReplaySpeedMode; fixedRateHz: ReplayFixedRateHz }>(
    { timingMode: "original", speedMultiplier: 1, fixedRateHz: 20 }
  );
  const sourceModeRef = useRef<TelemetrySourceMode>("replay");
  const statusRef = useRef<ReplayStatus>("idle");
  const logIdRef = useRef(1);

  const addLog = useCallback((level: ActivityLogEntry["level"], message: string) => {
    const tag = sourceModeRef.current === "simulation" ? "[SIM]" : "[REPLAY]";
    const entry: ActivityLogEntry = {
      id: logIdRef.current++,
      time: Date.now(),
      level,
      message: `${tag} ${message}`
    };
    setReplaySimLogs((current) => [entry, ...current].slice(0, 200));
  }, []);

  const schedulerConfig = useCallback((): SchedulerConfig => {
    const config = configRef.current;
    const timingMode: ReplayTimingMode =
      config.speedMultiplier === "max" ? "max" : config.timingMode;
    return { timingMode, fixedRateHz: config.fixedRateHz, maxEventsPerChunk: DEFAULT_MAX_EVENTS_PER_CHUNK };
  }, []);

  const buildDiagnostics = useCallback(
    (status: ReplayStatus): ReplayDiagnostics => {
      const engine = engineRef.current;
      const seconds = engine.currentTimeMs / 1000;
      return {
        status,
        sourceMode: sourceModeRef.current,
        currentEventIndex: engine.cursor - 1,
        currentReplayTimeMs: engine.currentTimeMs,
        durationMs: totalDurationMs(engine.events, schedulerConfig()),
        emittedTelemetryEvents: engine.emittedTelemetry,
        emittedActivityEvents: engine.emittedActivity,
        emittedDiagnosticEvents: engine.emittedDiagnostic,
        skippedEvents: engine.skipped,
        parseWarnings: engine.parseWarnings,
        lastError: null,
        averageEmitRateHz: seconds > 0 ? Math.round((engine.emittedTelemetry / seconds) * 10) / 10 : 0
      };
    },
    [schedulerConfig]
  );

  const commit = useCallback(
    (status: ReplayStatus) => {
      const engine = engineRef.current;
      statusRef.current = status;
      setReplayTelemetry(engine.telemetry);
      setReplayTrack(engine.track);
      setControllerState((prev) => ({
        ...prev,
        sourceMode: sourceModeRef.current,
        status,
        currentEventIndex: engine.cursor - 1,
        currentReplayTimeMs: engine.currentTimeMs,
        durationMs: totalDurationMs(engine.events, schedulerConfig()),
        diagnostics: buildDiagnostics(status)
      }));
    },
    [buildDiagnostics, schedulerConfig]
  );

  /** Route a chunk of events: count + log activity, then fold telemetry/track. */
  const applyChunk = useCallback(
    (events: NormalizedReplayEvent[]) => {
      const engine = engineRef.current;
      for (const event of events) {
        if (event.type === "telemetry" || event.type === "partialTelemetry") {
          engine.emittedTelemetry += 1;
        } else if (event.type === "activity" && event.activity) {
          engine.emittedActivity += 1;
          addLog(activityLevelToLog(event.activity.level), event.activity.message);
        } else if (event.type === "diagnostic") {
          engine.emittedDiagnostic += 1;
        }
      }
      const { state, track } = foldEvents(engine.telemetry, engine.track, events);
      engine.telemetry = state;
      engine.track = track;
    },
    [addLog]
  );

  const stopLoop = useCallback(() => {
    const engine = engineRef.current;
    if (engine.rafId !== null) {
      cancelAnimationFrame(engine.rafId);
      engine.rafId = null;
    }
  }, []);

  // rAF callback stored in a ref so the loop can re-schedule itself without a
  // self-referencing useCallback (and without stale closures over config/state).
  const tickRef = useRef<() => void>(() => undefined);

  const tick = useCallback(() => {
    const engine = engineRef.current;
    const config = configRef.current;
    const sched = schedulerConfig();

    let result;
    if (sched.timingMode === "max") {
      result = advanceTo(engine.events, sched, { cursor: engine.cursor, currentTimeMs: engine.currentTimeMs }, 0);
    } else if (sched.timingMode === "manual") {
      // Manual mode never auto-advances; stop the loop defensively.
      stopLoop();
      return;
    } else {
      const speed = typeof config.speedMultiplier === "number" ? config.speedMultiplier : 1;
      const wallElapsed = performance.now() - engine.playStartWallMs;
      const virtualMs = engine.playStartVirtualMs + wallElapsed * speed;
      result = advanceTo(engine.events, sched, { cursor: engine.cursor, currentTimeMs: engine.currentTimeMs }, virtualMs);
    }

    applyChunk(result.eventsToApply);
    engine.cursor = result.cursor;
    engine.currentTimeMs = result.currentReplayTimeMs;

    if (result.ended) {
      engine.rafId = null;
      try {
        sessionStorage.removeItem(RELOAD_MARKER_KEY);
      } catch {
        /* ignore storage failures */
      }
      commit("ended");
      addLog("info", "Ended");
      return;
    }

    commit("playing");
    engine.rafId = requestAnimationFrame(() => tickRef.current());
  }, [addLog, applyChunk, commit, schedulerConfig, stopLoop]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startLoop = useCallback(() => {
    const engine = engineRef.current;
    if (engine.rafId !== null) return; // prevent duplicate loops on rapid clicks
    engine.playStartWallMs = performance.now();
    engine.playStartVirtualMs = engine.currentTimeMs;
    try {
      sessionStorage.setItem(RELOAD_MARKER_KEY, "1");
    } catch {
      /* ignore storage failures */
    }
    engine.rafId = requestAnimationFrame(() => tickRef.current());
  }, []);

  /** Reset the engine playback position to the start (shared by stop/restart). */
  const resetToStart = useCallback(() => {
    const engine = engineRef.current;
    engine.cursor = 0;
    engine.currentTimeMs = 0;
    engine.telemetry = createEmptyReplayState();
    engine.track = [];
    engine.emittedTelemetry = 0;
    engine.emittedActivity = 0;
    engine.emittedDiagnostic = 0;
  }, []);

  const load = useCallback(
    (
      events: NormalizedReplayEvent[],
      metadata: ReplayLogMetadata,
      fileName: string,
      sourceMode: TelemetrySourceMode
    ) => {
      stopLoop();
      sourceModeRef.current = sourceMode;
      const engine = engineRef.current;
      engine.events = events;
      engine.parseWarnings = metadata.parseWarningCount;
      engine.skipped = metadata.skippedEventCount;
      resetToStart();
      commit("loaded");
      setControllerState((prev) => ({
        ...prev,
        loadedFileName: fileName,
        metadata,
        lastError: null
      }));
      const label = sourceMode === "simulation" ? "Loaded" : "File loaded";
      addLog("success", `${label}: ${fileName} (${metadata.eventCount} events, ${formatClock(metadata.durationMs)})`);
      if (metadata.parseWarningCount > 0) {
        addLog("warning", `${metadata.parseWarningCount} line(s) skipped while parsing.`);
      }
    },
    [addLog, commit, resetToStart, stopLoop]
  );

  const loadParsedLog = useCallback(
    (result: ParseReplayLogResult) => {
      load(result.events, result.metadata, result.metadata.fileName, "replay");
    },
    [load]
  );

  const loadSimulation = useCallback(
    (options: SimulationOptions) => {
      const events = generateSimulationEvents(options);
      const metadata = generateSimulationMetadata(options, events);
      load(events, metadata, metadata.fileName, "simulation");
    },
    [load]
  );

  const start = useCallback(() => {
    const engine = engineRef.current;
    if (engine.events.length === 0) return;
    if (configRef.current.timingMode === "manual") {
      // No auto-advance in manual mode; Step is the only way forward.
      commit("paused");
      addLog("info", "Manual mode — use Step to advance.");
      return;
    }
    if (statusRef.current === "ended") resetToStart();
    addLog("info", "Started");
    commit("playing");
    startLoop();
  }, [addLog, commit, resetToStart, startLoop]);

  const pause = useCallback(() => {
    if (statusRef.current !== "playing") return; // idempotent
    stopLoop();
    commit("paused");
    addLog("info", "Paused");
  }, [addLog, commit, stopLoop]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return; // idempotent
    if (configRef.current.timingMode === "manual") return;
    addLog("info", "Resumed");
    commit("playing");
    startLoop();
  }, [addLog, commit, startLoop]);

  const stop = useCallback(() => {
    stopLoop();
    resetToStart();
    try {
      sessionStorage.removeItem(RELOAD_MARKER_KEY);
    } catch {
      /* ignore */
    }
    commit("loaded");
    addLog("info", "Stopped");
  }, [addLog, commit, resetToStart, stopLoop]);

  const restart = useCallback(() => {
    const wasPlaying = statusRef.current === "playing";
    stopLoop();
    resetToStart();
    addLog("info", "Restarted");
    if (wasPlaying && configRef.current.timingMode !== "manual") {
      commit("playing");
      startLoop();
    } else {
      commit("loaded");
    }
  }, [addLog, commit, resetToStart, startLoop, stopLoop]);

  const seek = useCallback(
    (targetMs: number) => {
      const engine = engineRef.current;
      if (engine.events.length === 0) return;
      const result = seekTo(engine.events, schedulerConfig(), targetMs);

      // Rebuild deterministically from an empty state so the track never duplicates.
      engine.emittedTelemetry = 0;
      engine.emittedActivity = 0;
      engine.emittedDiagnostic = 0;
      const { state, track } = foldEvents(createEmptyReplayState(), [], result.eventsToApply);
      for (const event of result.eventsToApply) {
        if (event.type === "telemetry" || event.type === "partialTelemetry") engine.emittedTelemetry += 1;
        else if (event.type === "activity") engine.emittedActivity += 1;
        else if (event.type === "diagnostic") engine.emittedDiagnostic += 1;
      }
      engine.telemetry = state;
      engine.track = track;
      engine.cursor = result.cursor;
      engine.currentTimeMs = result.currentReplayTimeMs;

      if (engine.rafId !== null) {
        engine.playStartWallMs = performance.now();
        engine.playStartVirtualMs = engine.currentTimeMs;
      }

      commit(result.ended ? "ended" : statusRef.current === "playing" ? "playing" : "paused");
      addLog("info", `Seeked to ${formatClock(result.currentReplayTimeMs)}`);
    },
    [addLog, commit, schedulerConfig]
  );

  const step = useCallback(() => {
    const engine = engineRef.current;
    if (engine.events.length === 0) return;
    stopLoop();
    const result = stepOnce(engine.events, schedulerConfig(), { cursor: engine.cursor, currentTimeMs: engine.currentTimeMs });
    applyChunk(result.eventsToApply);
    engine.cursor = result.cursor;
    engine.currentTimeMs = result.currentReplayTimeMs;
    commit(result.ended ? "ended" : "paused");
  }, [applyChunk, commit, schedulerConfig, stopLoop]);

  const setTimingMode = useCallback(
    (mode: ReplayTimingMode) => {
      configRef.current.timingMode = mode;
      const engine = engineRef.current;
      if (engine.rafId !== null) {
        engine.playStartWallMs = performance.now();
        engine.playStartVirtualMs = engine.currentTimeMs;
      }
      setControllerState((prev) => ({
        ...prev,
        timingMode: mode,
        durationMs: totalDurationMs(engine.events, schedulerConfig())
      }));
    },
    [schedulerConfig]
  );

  const setSpeed = useCallback((speed: ReplaySpeedMode) => {
    configRef.current.speedMultiplier = speed;
    const engine = engineRef.current;
    if (engine.rafId !== null) {
      engine.playStartWallMs = performance.now();
      engine.playStartVirtualMs = engine.currentTimeMs;
    }
    setControllerState((prev) => ({ ...prev, speedMultiplier: speed }));
  }, []);

  const setFixedRate = useCallback(
    (hz: ReplayFixedRateHz) => {
      configRef.current.fixedRateHz = hz;
      const engine = engineRef.current;
      setControllerState((prev) => ({
        ...prev,
        fixedRateHz: hz,
        durationMs: totalDurationMs(engine.events, schedulerConfig())
      }));
    },
    [schedulerConfig]
  );

  const clearReplaySimLogs = useCallback(() => {
    setReplaySimLogs([]);
  }, []);

  // Reload behavior (handoff §12): if playback was interrupted by a reload,
  // clear the marker and surface a single notice. Always clean up rAF on unmount.
  useEffect(() => {
    let interrupted = false;
    try {
      interrupted = sessionStorage.getItem(RELOAD_MARKER_KEY) === "1";
      if (interrupted) sessionStorage.removeItem(RELOAD_MARKER_KEY);
    } catch {
      /* ignore */
    }
    if (interrupted) {
      addLog("warning", "Previous playback was reset due to app reload.");
    }
    return () => {
      stopLoop();
    };
  }, [addLog, stopLoop]);

  return useMemo(
    () => ({
      replayTelemetry,
      replayTrack,
      replaySimLogs,
      controllerState,
      loadParsedLog,
      loadSimulation,
      start,
      pause,
      resume,
      stop,
      restart,
      seek,
      step,
      setTimingMode,
      setSpeed,
      setFixedRate,
      clearReplaySimLogs
    }),
    [
      replayTelemetry,
      replayTrack,
      replaySimLogs,
      controllerState,
      loadParsedLog,
      loadSimulation,
      start,
      pause,
      resume,
      stop,
      restart,
      seek,
      step,
      setTimingMode,
      setSpeed,
      setFixedRate,
      clearReplaySimLogs
    ]
  );
}
