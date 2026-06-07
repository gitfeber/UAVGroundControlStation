import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TargetEstimate,
  TargetEstimationSettings,
  TelemetrySourceMode,
  TelemetryState,
  TerrainMetadata,
  TerrainProvider
} from "@uav-ground-control-station/shared";
import {
  exportTargetSampleLogCsv,
  exportTargetSampleLogJson,
  FlatTerrainProvider,
  MissingDemTerrainProvider,
  TargetEstimationSession
} from "@uav-ground-control-station/target-estimation";
import { loadTargetEstimationSettings, loadTerrainModelPath, saveTargetEstimationSettings, saveTerrainModelPath } from "../lib/targetSettings";
import { downloadTextFile, targetSampleLogFilename } from "../lib/targetSampleLogDownload";
import { TauriDemTerrainProvider } from "../lib/tauriDemTerrain";

const ESTIMATE_INTERVAL_MS = 100;

export interface TargetEstimationController {
  estimate: TargetEstimate | null;
  settings: TargetEstimationSettings;
  setSettings: (settings: TargetEstimationSettings) => void;
  terrainMetadata: TerrainMetadata | null;
  terrainPath: string;
  setTerrainPath: (path: string) => void;
  loadTerrainModel: () => Promise<void>;
  clearTerrainModel: () => Promise<void>;
  runtimeMode: "web" | "desktop";
  liveOnlyBlocked: boolean;
  sampleLogCount: number;
  sampleLogCapacity: number;
  exportSampleLogJson: () => void;
  exportSampleLogCsv: () => void;
  clearSampleLog: () => void;
  saveSampleLogToPath: (path: string) => Promise<void>;
}

function runtimeMode(): "web" | "desktop" {
  return window.__TAURI_INTERNALS__ ? "desktop" : "web";
}

function withSampleTime(state: TelemetryState): TelemetryState {
  return {
    ...state,
    sampledAtMs: state.sampledAtMs ?? state.lastPacketAt ?? Date.now()
  };
}

export function useTargetEstimation(
  telemetry: TelemetryState,
  sourceMode: TelemetrySourceMode
): TargetEstimationController {
  const mode = runtimeMode();
  const [settings, setSettingsState] = useState<TargetEstimationSettings>(() => loadTargetEstimationSettings());
  const [terrainPath, setTerrainPathState] = useState(() => loadTerrainModelPath());
  const [terrainMetadata, setTerrainMetadata] = useState<TerrainMetadata | null>(null);
  const [estimate, setEstimate] = useState<TargetEstimate | null>(null);
  const [sampleLogCount, setSampleLogCount] = useState(0);
  const [sampleLogCapacity, setSampleLogCapacity] = useState(600);
  const sessionRef = useRef<TargetEstimationSession | null>(null);
  const terrainRef = useRef<TerrainProvider>(
    runtimeMode() === "desktop" ? new MissingDemTerrainProvider() : new FlatTerrainProvider({ elevationAmslM: 0 })
  );
  const tauriTerrainRef = useRef<TauriDemTerrainProvider | null>(null);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new TargetEstimationSession({
        terrain: terrainRef.current,
        settings,
        sourceMode
      });
      setSampleLogCapacity(sessionRef.current.getSampleLogCapacity());
      return;
    }
    sessionRef.current.setSettings(settings);
    sessionRef.current.setSourceMode(sourceMode);
    sessionRef.current.setTerrain(terrainRef.current);
    setSampleLogCapacity(sessionRef.current.getSampleLogCapacity());
  }, [settings, sourceMode]);

  useEffect(() => {
    saveTargetEstimationSettings(settings);
    ensureSession();
  }, [settings, ensureSession]);

  useEffect(() => {
    saveTerrainModelPath(terrainPath);
  }, [terrainPath]);

  useEffect(() => {
    ensureSession();
  }, [ensureSession]);

  useEffect(() => {
    if (mode !== "desktop") {
      terrainRef.current = new FlatTerrainProvider({ elevationAmslM: 0 });
      tauriTerrainRef.current = null;
      setTerrainMetadata(null);
      ensureSession();
      return;
    }

    if (!terrainPath.trim()) {
      terrainRef.current = new MissingDemTerrainProvider();
      tauriTerrainRef.current = null;
      setTerrainMetadata(null);
      ensureSession();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const provider = await TauriDemTerrainProvider.load(terrainPath.trim());
        if (cancelled) return;
        tauriTerrainRef.current = provider;
        terrainRef.current = provider;
        setTerrainMetadata(provider.metadata);
        ensureSession();
      } catch {
        if (cancelled) return;
        terrainRef.current = new MissingDemTerrainProvider();
        tauriTerrainRef.current = null;
        setTerrainMetadata(null);
        ensureSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, terrainPath, ensureSession]);

  useEffect(() => {
    if (sourceMode !== "live") {
      setEstimate(null);
      setSampleLogCount(0);
      return;
    }
    sessionRef.current?.push(withSampleTime(telemetry));
  }, [telemetry, sourceMode]);

  useEffect(() => {
    if (sourceMode !== "live") return;

    let cancelled = false;
    const tick = async () => {
      const session = sessionRef.current;
      if (!session || cancelled) return;

      const next = await session.estimate();
      if (!cancelled) {
        setEstimate(next);
        setSampleLogCount(session.getSampleLogSize());
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, ESTIMATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sourceMode, settings.videoLatencyMs]);

  const setSettings = useCallback((next: TargetEstimationSettings) => {
    setSettingsState(next);
  }, []);

  const setTerrainPath = useCallback((path: string) => {
    setTerrainPathState(path);
  }, []);

  const loadTerrainModel = useCallback(async () => {
    if (mode !== "desktop") return;
    const provider = await TauriDemTerrainProvider.load(terrainPath.trim());
    tauriTerrainRef.current = provider;
    terrainRef.current = provider;
    setTerrainMetadata(provider.metadata);
    ensureSession();
  }, [ensureSession, mode, terrainPath]);

  const clearTerrainModel = useCallback(async () => {
    if (mode === "desktop") {
      const { clearDesktopTerrainModel } = await import("../lib/tauriDemTerrain");
      await clearDesktopTerrainModel();
    }
    setTerrainPathState("");
    terrainRef.current = new MissingDemTerrainProvider();
    tauriTerrainRef.current = null;
    setTerrainMetadata(null);
    ensureSession();
  }, [ensureSession, mode]);

  const exportSampleLogJson = useCallback(() => {
    const samples = sessionRef.current?.getSampleLogEntries() ?? [];
    downloadTextFile(
      targetSampleLogFilename("json"),
      exportTargetSampleLogJson(samples),
      "application/json"
    );
  }, []);

  const exportSampleLogCsv = useCallback(() => {
    const samples = sessionRef.current?.getSampleLogEntries() ?? [];
    downloadTextFile(targetSampleLogFilename("csv"), exportTargetSampleLogCsv(samples), "text/csv");
  }, []);

  const clearSampleLog = useCallback(() => {
    sessionRef.current?.clearSampleLog();
    setSampleLogCount(0);
  }, []);

  const saveSampleLogToPath = useCallback(async (path: string) => {
    if (mode !== "desktop") return;
    const samples = sessionRef.current?.getSampleLogEntries() ?? [];
    const trimmed = path.trim();
    if (!trimmed) return;
    const contents = trimmed.toLowerCase().endsWith(".csv")
      ? exportTargetSampleLogCsv(samples)
      : exportTargetSampleLogJson(samples);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_target_log", { path: trimmed, contents });
  }, [mode]);

  return {
    estimate,
    settings,
    setSettings,
    terrainMetadata,
    terrainPath,
    setTerrainPath,
    loadTerrainModel,
    clearTerrainModel,
    runtimeMode: mode,
    liveOnlyBlocked: sourceMode !== "live",
    sampleLogCount,
    sampleLogCapacity,
    exportSampleLogJson,
    exportSampleLogCsv,
    clearSampleLog,
    saveSampleLogToPath
  };
}
