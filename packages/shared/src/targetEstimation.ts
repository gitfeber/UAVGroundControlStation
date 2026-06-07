// ---------------------------------------------------------------------------
// Ground target estimation (ADR 0005 — shared contracts)
// ---------------------------------------------------------------------------

/** Local East-North-Up tuple in meters relative to an ENU anchor. */
export type EnuTuple = [eastM: number, northM: number, upM: number];

export type GimbalAttitudeSource = "mavlink285" | "mavlink265" | "bodyFixed";

export interface GimbalState {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  source: GimbalAttitudeSource;
  /** Monotonic time when this gimbal snapshot was sampled. */
  sampledAtMs: number;
  /** MAVLink 285 flags: true when quaternion yaw is earth-referenced. */
  yawInEarthFrame?: boolean | null;
}

export type GimbalFrameConvention = "earth" | "body";
export type PitchSignConvention = "normal" | "inverted";
export type YawReferenceConvention = "north" | "vehicle";

export interface CameraConfig {
  /** Body-frame mount offset from vehicle reference point (meters). */
  mountOffsetM: { x: number; y: number; z: number };
  /** Operator calibration offsets applied after telemetry decode (degrees). */
  calibrationDeg: { roll: number; pitch: number; yaw: number };
  gimbalFrame: GimbalFrameConvention;
  pitchSign: PitchSignConvention;
  yawReference: YawReferenceConvention;
  /** Use vehicle ATTITUDE when dedicated gimbal telemetry is absent. */
  allowBodyFixedWhenGimbalMissing: boolean;
}

export type AltitudeMode = "amsl" | "relative";

export interface TargetEstimationSettings {
  /** Milliseconds subtracted from estimate tick time for delayed video. */
  videoLatencyMs: number;
  altitudeMode: AltitudeMode;
  /** Added to ray-origin altitude to align with terrain vertical datum. */
  altitudeOffsetM: number;
  camera: CameraConfig;
}

export interface TerrainMetadata {
  verticalDatum: string;
  horizontalCrs: string;
  resolutionM: number;
}

export type TargetEstimateQuality = "good" | "warn" | "bad";

export type TargetEstimateInvalidReason =
  | "telemetry_incomplete"
  | "gimbal_unavailable"
  | "dem_not_loaded"
  | "dem_out_of_coverage"
  | "dem_nodata"
  | "camera_above_horizon"
  | "gps_no_3d_fix"
  | "telemetry_stale"
  | "using_relative_altitude_fallback"
  | "gimbal_body_fixed_fallback"
  | "gimbal_mount_orientation"
  | "gps_low_accuracy"
  | "gps_few_satellites"
  | "no_ray_intersection"
  | "target_estimation_live_only";

export interface TerrainElevationSample {
  elevationM: number;
  nodata: boolean;
}

export interface TerrainRaySample extends TerrainElevationSample {
  /** Distance along the ray from the camera origin (meters). */
  distanceM: number;
  /** Sample location in ENU meters relative to the estimate anchor. */
  enu: EnuTuple;
}

export interface TerrainProvider {
  readonly metadata: TerrainMetadata;
  /** Single-point elevation lookup in ENU meters relative to the anchor. */
  getElevationAtEnu(eastM: number, northM: number): Promise<TerrainElevationSample | null>;
  /**
   * Batched elevation samples along a ray. Returns null entries when a sample
   * cannot be resolved (out of coverage, nodata, etc.).
   */
  getElevationsAlongRay(
    originEnu: EnuTuple,
    directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<(TerrainRaySample | null)[]>;
}

export interface TargetEstimate {
  valid: boolean;
  quality: TargetEstimateQuality;
  /** Worst-wins aggregation of active quality gates. */
  reasons: TargetEstimateInvalidReason[];

  lat: number | null;
  lon: number | null;
  terrainElevationM: number | null;
  slantRangeM: number | null;
  groundRangeM: number | null;

  /** WGS84 ENU anchor for this estimate. */
  anchorLat: number | null;
  anchorLon: number | null;

  uavLat: number | null;
  uavLon: number | null;
  uavAltM: number | null;

  /** Wall-clock time when the estimate was computed. */
  estimatedAtMs: number;
  /** Interpolated telemetry sample time used for pose lookup. */
  telemetrySampledAtMs: number | null;
  gimbalSource: GimbalAttitudeSource | null;
  /** Camera depression angle below horizontal (degrees, positive = down). */
  depressionAngleDeg: number | null;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  mountOffsetM: { x: 0, y: 0, z: 0 },
  calibrationDeg: { roll: 0, pitch: 0, yaw: 0 },
  gimbalFrame: "earth",
  pitchSign: "normal",
  yawReference: "north",
  allowBodyFixedWhenGimbalMissing: false
};

export const DEFAULT_TARGET_ESTIMATION_SETTINGS: TargetEstimationSettings = {
  videoLatencyMs: 200,
  altitudeMode: "amsl",
  altitudeOffsetM: 0,
  camera: DEFAULT_CAMERA_CONFIG
};

export function createEmptyTargetEstimate(estimatedAtMs: number): TargetEstimate {
  return {
    valid: false,
    quality: "bad",
    reasons: [],
    lat: null,
    lon: null,
    terrainElevationM: null,
    slantRangeM: null,
    groundRangeM: null,
    anchorLat: null,
    anchorLon: null,
    uavLat: null,
    uavLon: null,
    uavAltM: null,
    estimatedAtMs,
    telemetrySampledAtMs: null,
    gimbalSource: null,
    depressionAngleDeg: null
  };
}
