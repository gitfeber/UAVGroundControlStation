import {
  DEFAULT_RAYCAST_CONFIG,
  DEFAULT_TARGET_ESTIMATION_SETTINGS,
  type AltitudeMode,
  type CameraConfig,
  type GimbalFrameConvention,
  type PitchSignConvention,
  type RaycastConfig,
  type TargetEstimationSettings,
  type YawReferenceConvention
} from "@uav-ground-control-station/shared";

const SETTINGS_KEY = "uav-gcs.target.settings";
const TERRAIN_PATH_KEY = "uav-gcs.target.terrainPath";
const MAX_TERRAIN_PATH_LENGTH = 4096;

function finiteInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

function sanitizeCameraConfig(parsed: Partial<CameraConfig> | undefined): CameraConfig {
  const defaults = DEFAULT_TARGET_ESTIMATION_SETTINGS.camera;
  return {
    mountOffsetM: {
      x: finiteInRange(parsed?.mountOffsetM?.x, -500, 500, defaults.mountOffsetM.x),
      y: finiteInRange(parsed?.mountOffsetM?.y, -500, 500, defaults.mountOffsetM.y),
      z: finiteInRange(parsed?.mountOffsetM?.z, -500, 500, defaults.mountOffsetM.z)
    },
    calibrationDeg: {
      roll: finiteInRange(parsed?.calibrationDeg?.roll, -180, 180, defaults.calibrationDeg.roll),
      pitch: finiteInRange(parsed?.calibrationDeg?.pitch, -180, 180, defaults.calibrationDeg.pitch),
      yaw: finiteInRange(parsed?.calibrationDeg?.yaw, -180, 180, defaults.calibrationDeg.yaw)
    },
    gimbalFrame: pickEnum<GimbalFrameConvention>(parsed?.gimbalFrame, ["earth", "body"], defaults.gimbalFrame),
    pitchSign: pickEnum<PitchSignConvention>(parsed?.pitchSign, ["normal", "inverted"], defaults.pitchSign),
    yawReference: pickEnum<YawReferenceConvention>(
      parsed?.yawReference,
      ["north", "vehicle"],
      defaults.yawReference
    ),
    allowBodyFixedWhenGimbalMissing:
      typeof parsed?.allowBodyFixedWhenGimbalMissing === "boolean"
        ? parsed.allowBodyFixedWhenGimbalMissing
        : defaults.allowBodyFixedWhenGimbalMissing
  };
}

function sanitizeRaycastConfig(parsed: Partial<RaycastConfig> | undefined): RaycastConfig {
  const defaults = DEFAULT_RAYCAST_CONFIG;
  return {
    maxRangeM: finiteInRange(parsed?.maxRangeM, 100, 100_000, defaults.maxRangeM),
    stepM: finiteInRange(parsed?.stepM, 1, 500, defaults.stepM),
    minDownAngleDeg: finiteInRange(parsed?.minDownAngleDeg, 0, 89, defaults.minDownAngleDeg),
    refineIterations: Math.round(finiteInRange(parsed?.refineIterations, 1, 64, defaults.refineIterations)),
    staleTelemetryWarnMs: Math.round(
      finiteInRange(parsed?.staleTelemetryWarnMs, 100, 10_000, defaults.staleTelemetryWarnMs)
    ),
    gpsLowAccuracyEphM: finiteInRange(parsed?.gpsLowAccuracyEphM, 0.1, 100, defaults.gpsLowAccuracyEphM),
    gpsFewSatellitesWarn: Math.round(
      finiteInRange(parsed?.gpsFewSatellitesWarn, 0, 30, defaults.gpsFewSatellitesWarn)
    )
  };
}

function sanitizeTargetEstimationSettings(parsed: Partial<TargetEstimationSettings>): TargetEstimationSettings {
  const defaults = DEFAULT_TARGET_ESTIMATION_SETTINGS;
  return {
    videoLatencyMs: Math.round(finiteInRange(parsed.videoLatencyMs, 0, 30_000, defaults.videoLatencyMs)),
    altitudeMode: pickEnum<AltitudeMode>(parsed.altitudeMode, ["amsl", "relative"], defaults.altitudeMode),
    altitudeOffsetM: finiteInRange(parsed.altitudeOffsetM, -10_000, 10_000, defaults.altitudeOffsetM),
    camera: sanitizeCameraConfig(parsed.camera),
    raycast: sanitizeRaycastConfig(parsed.raycast)
  };
}

export function loadTargetEstimationSettings(): TargetEstimationSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return structuredClone(DEFAULT_TARGET_ESTIMATION_SETTINGS);

  try {
    const parsed = JSON.parse(raw) as Partial<TargetEstimationSettings>;
    return sanitizeTargetEstimationSettings(parsed);
  } catch {
    return structuredClone(DEFAULT_TARGET_ESTIMATION_SETTINGS);
  }
}

export function saveTargetEstimationSettings(settings: TargetEstimationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTerrainModelPath(): string {
  const raw = localStorage.getItem(TERRAIN_PATH_KEY) ?? "";
  if (raw.length > MAX_TERRAIN_PATH_LENGTH) {
    return raw.slice(0, MAX_TERRAIN_PATH_LENGTH);
  }
  return raw;
}

export function saveTerrainModelPath(path: string): void {
  localStorage.setItem(TERRAIN_PATH_KEY, path.slice(0, MAX_TERRAIN_PATH_LENGTH));
}
