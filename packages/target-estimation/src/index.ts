export { lerpAngleDeg, interpolateTelemetryState } from "./interpolate.js";
export { estimateTargetFromTelemetry, type EstimateTargetInput } from "./estimateTarget.js";
export { FlatTerrainProvider, type FlatTerrainProviderOptions } from "./flatTerrain.js";
export {
  aggregateTargetQuality,
  MIN_DEPRESSION_DEG,
  STALE_TELEMETRY_WARN_MS
} from "./quality.js";
export { depressionAngleDeg, opticalAxisEnu, resolveGimbalAttitude, type ResolvedGimbalAttitude } from "./gimbal.js";
export { enuDeltaToGeodetic, metersPerDegreeLat, metersPerDegreeLon, normalizeVector } from "./geo.js";
export { TargetEstimationSession, type TargetEstimationEstimateOptions, type TargetEstimationSessionOptions } from "./session.js";
export {
  DEFAULT_TELEMETRY_BUFFER_RETENTION_MS,
  TelemetryRingBuffer,
  type TelemetryBufferEntry,
  type TelemetryLookupResult,
  type TelemetryRingBufferOptions
} from "./telemetryBuffer.js";
