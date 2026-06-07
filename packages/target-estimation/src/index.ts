export { lerpAngleDeg, interpolateTelemetryState } from "./interpolate.js";
export { estimateTargetFromTelemetry, type EstimateTargetInput } from "./estimateTarget.js";
export { FlatTerrainProvider, type FlatTerrainProviderOptions } from "./flatTerrain.js";
export { intersectRayWithTerrain, type RayIntersectFailureReason, type RayIntersectOptions, type RayIntersectionHit, type RayIntersectResult } from "./rayIntersect.js";
export { SlopedPlaneTerrainProvider, type SlopedPlaneTerrainProviderOptions } from "./slopedTerrain.js";
export { terrainAmslAt, type AnchorTerrainProvider } from "./terrainUtils.js";
export {
  aggregateTargetQuality,
  MIN_DEPRESSION_DEG,
  STALE_TELEMETRY_WARN_MS
} from "./quality.js";
export { depressionAngleDeg, opticalAxisEnu, resolveGimbalAttitude, type ResolvedGimbalAttitude } from "./gimbal.js";
export { enuDeltaToGeodetic, metersPerDegreeLat, metersPerDegreeLon, normalizeVector } from "./geo.js";
export {
  createTargetSampleLogEntry,
  DEFAULT_TARGET_SAMPLE_LOG_CAPACITY,
  exportTargetSampleLogCsv,
  exportTargetSampleLogJson,
  slimTelemetrySlice,
  TargetSampleLog,
  type TargetSampleLogEntry,
  type TargetSampleLogOptions,
  type TargetSampleTelemetrySlice
} from "./sampleLog.js";
export { TargetEstimationSession, type TargetEstimationEstimateOptions, type TargetEstimationSessionOptions } from "./session.js";
export {
  DEFAULT_TELEMETRY_BUFFER_RETENTION_MS,
  TelemetryRingBuffer,
  type TelemetryBufferEntry,
  type TelemetryLookupResult,
  type TelemetryRingBufferOptions
} from "./telemetryBuffer.js";
