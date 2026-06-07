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
  FlatTerrainProvider,
  TargetEstimationSession
} from "@uav-ground-control-station/target-estimation";
import { loadTargetEstimationSettings, loadTerrainModelPath, saveTargetEstimationSettings, saveTerrainModelPath } from "../lib/targetSettings";
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
  const sessionRef = useRef<TargetEstimationSession | null>(null);
  const terrainRef = useRef<TerrainProvider>(new FlatTerrainProvider({ elevationAmslM: 0 }));
  const tauriTerrainRef = useRef<TauriDemTerrainProvider | null>(null);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new TargetEstimationSession({
        terrain: terrainRef.current,
        settings,
        sourceMode
      });
      return;
    }
    sessionRef.current.setSettings(settings);
    sessionRef.current.setSourceMode(sourceMode);
    sessionRef.current.setTerrain(terrainRef.current);
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
    if (mode !== "desktop" || !terrainPath.trim()) {
      terrainRef.current = new FlatTerrainProvider({ elevationAmslM: 0 });
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
        terrainRef.current = new FlatTerrainProvider({ elevationAmslM: 0 });
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

      const lat = telemetry.position.lat;
      const lon = telemetry.position.lon;
      const tauriTerrain = tauriTerrainRef.current;
      if (tauriTerrain && lat !== null && lon !== null) {
        try {
          await tauriTerrain.prepareEstimateAnchor(lat, lon);
        } catch {
          /* estimate will surface dem errors */
        }
      }

      const next = await session.estimate();
      if (!cancelled) setEstimate(next);
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, ESTIMATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sourceMode, settings.videoLatencyMs, telemetry.position.lat, telemetry.position.lon]);

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
    terrainRef.current = new FlatTerrainProvider({ elevationAmslM: 0 });
    tauriTerrainRef.current = null;
    setTerrainMetadata(null);
    ensureSession();
  }, [ensureSession, mode]);

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
    liveOnlyBlocked: sourceMode !== "live"
  };
}
