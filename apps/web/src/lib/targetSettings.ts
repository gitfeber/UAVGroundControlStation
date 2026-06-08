import {
  DEFAULT_RAYCAST_CONFIG,
  DEFAULT_TARGET_ESTIMATION_SETTINGS,
  type TargetEstimationSettings
} from "@uav-ground-control-station/shared";

const SETTINGS_KEY = "uav-gcs.target.settings";
const TERRAIN_PATH_KEY = "uav-gcs.target.terrainPath";

export function loadTargetEstimationSettings(): TargetEstimationSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return structuredClone(DEFAULT_TARGET_ESTIMATION_SETTINGS);

  try {
    const parsed = JSON.parse(raw) as Partial<TargetEstimationSettings>;
    return {
      ...DEFAULT_TARGET_ESTIMATION_SETTINGS,
      ...parsed,
      camera: {
        ...DEFAULT_TARGET_ESTIMATION_SETTINGS.camera,
        ...parsed.camera,
        mountOffsetM: {
          ...DEFAULT_TARGET_ESTIMATION_SETTINGS.camera.mountOffsetM,
          ...parsed.camera?.mountOffsetM
        },
        calibrationDeg: {
          ...DEFAULT_TARGET_ESTIMATION_SETTINGS.camera.calibrationDeg,
          ...parsed.camera?.calibrationDeg
        }
      },
      raycast: {
        ...DEFAULT_RAYCAST_CONFIG,
        ...parsed.raycast
      }
    };
  } catch {
    return structuredClone(DEFAULT_TARGET_ESTIMATION_SETTINGS);
  }
}

export function saveTargetEstimationSettings(settings: TargetEstimationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTerrainModelPath(): string {
  return localStorage.getItem(TERRAIN_PATH_KEY) ?? "";
}

export function saveTerrainModelPath(path: string): void {
  localStorage.setItem(TERRAIN_PATH_KEY, path);
}
