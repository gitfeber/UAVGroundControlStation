import {
  createEmptyTargetEstimate,
  type EnuTuple,
  type TargetEstimate,
  type TargetEstimateInvalidReason,
  type TargetEstimationSettings,
  type TelemetryState,
  type TerrainProvider
} from "@uav-ground-control-station/shared";
import { depressionAngleDeg, opticalAxisEnu, resolveGimbalAttitude } from "./gimbal.js";
import { enuDeltaToGeodetic, normalizeVector } from "./geo.js";
import { aggregateTargetQuality, MIN_DEPRESSION_DEG, STALE_TELEMETRY_WARN_MS } from "./quality.js";
import { intersectRayWithTerrain } from "./rayIntersect.js";
import type { TelemetryLookupResult } from "./telemetryBuffer.js";
import { terrainAmslAt } from "./terrainUtils.js";

export interface EstimateTargetInput {
  telemetry: TelemetryState;
  lookup: TelemetryLookupResult;
  terrain: TerrainProvider;
  settings: TargetEstimationSettings;
  estimatedAtMs: number;
  telemetrySampledAtMs: number;
}

export async function estimateTargetFromTelemetry(input: EstimateTargetInput): Promise<TargetEstimate> {
  const { telemetry, lookup, terrain, settings, estimatedAtMs, telemetrySampledAtMs } = input;
  const estimate = createEmptyTargetEstimate(estimatedAtMs);
  estimate.telemetrySampledAtMs = telemetrySampledAtMs;

  const reasons: TargetEstimateInvalidReason[] = [];

  if (lookup.trailingGapMs !== null && lookup.trailingGapMs > STALE_TELEMETRY_WARN_MS) {
    reasons.push("telemetry_stale");
  }

  const lat = telemetry.position.lat;
  const lon = telemetry.position.lon;
  if (lat === null || lon === null) {
    reasons.push("missing_position");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, null);
  }

  estimate.uavLat = lat;
  estimate.uavLon = lon;
  estimate.anchorLat = lat;
  estimate.anchorLon = lon;

  if ((telemetry.gps.fixType ?? 0) < 3) {
    reasons.push("gps_not_3d");
  }

  const gimbal = resolveGimbalAttitude(telemetry, settings.camera);
  if (!gimbal) {
    reasons.push("gimbal_unavailable");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, gimbal);
  }

  estimate.gimbalSource = gimbal.source;

  let rayOriginAltMsl: number | null = null;
  if (settings.altitudeMode === "amsl") {
    if (telemetry.position.altMsl !== null) {
      rayOriginAltMsl = telemetry.position.altMsl + settings.altitudeOffsetM;
    } else if (telemetry.position.relativeAlt !== null) {
      const terrainAtUav = terrainAmslAt(terrain, lat, lon);
      rayOriginAltMsl = terrainAtUav + telemetry.position.relativeAlt + settings.altitudeOffsetM;
      reasons.push("altitude_fallback_relative");
    }
  } else if (telemetry.position.relativeAlt !== null) {
    const terrainAtUav = terrainAmslAt(terrain, lat, lon);
    rayOriginAltMsl = terrainAtUav + telemetry.position.relativeAlt + settings.altitudeOffsetM;
  }

  if (rayOriginAltMsl === null) {
    reasons.push("missing_altitude");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, gimbal);
  }

  estimate.uavAltM = rayOriginAltMsl;

  const terrainAtAnchor = terrainAmslAt(terrain, lat, lon);
  const originEnu: EnuTuple = [0, 0, rayOriginAltMsl - terrainAtAnchor];
  const axis = opticalAxisEnu(gimbal.rollDeg, gimbal.pitchDeg, gimbal.yawDeg);
  const directionEnu = normalizeVector(axis[0], axis[1], axis[2]) as EnuTuple;
  const depression = depressionAngleDeg(directionEnu);
  estimate.depressionAngleDeg = depression;

  if (depression < MIN_DEPRESSION_DEG) {
    reasons.push("horizon_too_shallow");
  }

  const intersection = await intersectRayWithTerrain(originEnu, directionEnu, terrain);
  if (!intersection.ok) {
    reasons.push(intersection.reason);
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, gimbal);
  }

  const { hitEnu, slantRangeM, terrainElevationM } = intersection.hit;
  const hitGeo = enuDeltaToGeodetic(lat, lon, hitEnu[0], hitEnu[1]);

  estimate.lat = hitGeo.lat;
  estimate.lon = hitGeo.lon;
  estimate.terrainElevationM = terrainAtAnchor + terrainElevationM;
  estimate.slantRangeM = slantRangeM;
  estimate.groundRangeM = Math.hypot(hitEnu[0], hitEnu[1]);
  estimate.reasons = reasons;

  return finalizeEstimate(estimate, reasons, gimbal);
}

function finalizeEstimate(
  estimate: TargetEstimate,
  reasons: TargetEstimateInvalidReason[],
  gimbal: ReturnType<typeof resolveGimbalAttitude>
): TargetEstimate {
  const hasCoordinates = estimate.lat !== null && estimate.lon !== null;
  const { quality, valid } = aggregateTargetQuality(reasons, hasCoordinates);
  estimate.quality = quality;
  estimate.valid = valid;
  estimate.reasons = [...new Set(reasons)];

  if (gimbal?.source === "bodyFixed" && estimate.valid && estimate.quality === "good") {
    estimate.quality = "warn";
  }

  return estimate;
}
