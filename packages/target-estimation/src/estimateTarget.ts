import {
  createEmptyTargetEstimate,
  DEFAULT_RAYCAST_CONFIG,
  type EnuTuple,
  type TargetEstimate,
  type TargetEstimateInvalidReason,
  type TargetEstimationSettings,
  type TelemetryState,
  type TerrainProvider
} from "@uav-ground-control-station/shared";
import { depressionAngleDeg, opticalAxisEnu, resolveGimbalAttitude } from "./gimbal.js";
import { enuDeltaToGeodetic, normalizeVector } from "./geo.js";
import {
  aggregateTargetQuality,
  DEFAULT_GPS_FEW_SATELLITES_WARN,
  DEFAULT_GPS_LOW_ACCURACY_EPH_M
} from "./quality.js";
import { intersectRayWithTerrain } from "./rayIntersect.js";
import type { TelemetryLookupResult } from "./telemetryBuffer.js";
import { prepareTerrainAnchor } from "./terrainUtils.js";

export interface EstimateTargetInput {
  telemetry: TelemetryState;
  lookup: TelemetryLookupResult;
  terrain: TerrainProvider;
  settings: TargetEstimationSettings;
  estimatedAtMs: number;
  telemetrySampledAtMs: number;
}

function isDemLoaded(terrain: TerrainProvider): boolean {
  if ("demLoaded" in terrain && terrain.demLoaded === false) {
    return false;
  }
  return true;
}

function collectGpsWarnReasons(
  telemetry: TelemetryState,
  raycast: TargetEstimationSettings["raycast"]
): TargetEstimateInvalidReason[] {
  const reasons: TargetEstimateInvalidReason[] = [];
  const { eph, satellites } = telemetry.gps;
  const maxEph = raycast.gpsLowAccuracyEphM ?? DEFAULT_GPS_LOW_ACCURACY_EPH_M;
  const minSats = raycast.gpsFewSatellitesWarn ?? DEFAULT_GPS_FEW_SATELLITES_WARN;

  if (eph !== null && eph > maxEph) {
    reasons.push("gps_low_accuracy");
  }
  if (satellites !== null && satellites < minSats) {
    reasons.push("gps_few_satellites");
  }
  return reasons;
}

export async function estimateTargetFromTelemetry(input: EstimateTargetInput): Promise<TargetEstimate> {
  const { telemetry, lookup, terrain, settings, estimatedAtMs, telemetrySampledAtMs } = input;
  const estimate = createEmptyTargetEstimate(estimatedAtMs);
  estimate.telemetrySampledAtMs = telemetrySampledAtMs;

  const reasons: TargetEstimateInvalidReason[] = [];
  const raycast = { ...DEFAULT_RAYCAST_CONFIG, ...settings.raycast };
  const staleThresholdMs = raycast.staleTelemetryWarnMs;

  if (lookup.trailingGapMs !== null && lookup.trailingGapMs > staleThresholdMs) {
    reasons.push("telemetry_stale");
  }

  if (!isDemLoaded(terrain)) {
    reasons.push("dem_not_loaded");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, null);
  }

  const lat = telemetry.position.lat;
  const lon = telemetry.position.lon;
  if (lat === null || lon === null) {
    reasons.push("telemetry_incomplete");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, null);
  }

  estimate.uavLat = lat;
  estimate.uavLon = lon;
  estimate.anchorLat = lat;
  estimate.anchorLon = lon;

  const anchorPrep = await prepareTerrainAnchor(terrain, lat, lon);
  if (!anchorPrep.ok) {
    reasons.push(anchorPrep.reason);
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, null);
  }

  if ((telemetry.gps.fixType ?? 0) < 3) {
    reasons.push("gps_no_3d_fix");
  }

  reasons.push(...collectGpsWarnReasons(telemetry, raycast));

  const gimbal = resolveGimbalAttitude(telemetry, settings.camera);
  if (!gimbal) {
    reasons.push("gimbal_unavailable");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, gimbal);
  }

  estimate.gimbalSource = gimbal.source;

  if (gimbal.source === "mavlink265") {
    reasons.push("gimbal_mount_orientation");
  }
  if (gimbal.source === "bodyFixed") {
    reasons.push("gimbal_body_fixed_fallback");
  }

  const terrainAtAnchor = anchorPrep.elevationAmslM;

  let rayOriginAltMsl: number | null = null;
  if (settings.altitudeMode === "amsl") {
    if (telemetry.position.altMsl !== null) {
      rayOriginAltMsl = telemetry.position.altMsl + settings.altitudeOffsetM;
    } else if (telemetry.position.relativeAlt !== null) {
      rayOriginAltMsl = terrainAtAnchor + telemetry.position.relativeAlt + settings.altitudeOffsetM;
      reasons.push("using_relative_altitude_fallback");
    }
  } else if (telemetry.position.relativeAlt !== null) {
    rayOriginAltMsl = terrainAtAnchor + telemetry.position.relativeAlt + settings.altitudeOffsetM;
  }

  if (rayOriginAltMsl === null) {
    reasons.push("telemetry_incomplete");
    estimate.reasons = reasons;
    return finalizeEstimate(estimate, reasons, gimbal);
  }

  estimate.uavAltM = rayOriginAltMsl;

  const originEnu: EnuTuple = [0, 0, rayOriginAltMsl - terrainAtAnchor];
  const axis = opticalAxisEnu(gimbal.rollDeg, gimbal.pitchDeg, gimbal.yawDeg);
  const directionEnu = normalizeVector(axis[0], axis[1], axis[2]) as EnuTuple;
  const depression = depressionAngleDeg(directionEnu);
  estimate.depressionAngleDeg = depression;

  const minDownAngleDeg = raycast.minDownAngleDeg;
  if (depression < minDownAngleDeg) {
    reasons.push("camera_above_horizon");
  }

  const intersection = await intersectRayWithTerrain(originEnu, directionEnu, terrain, {
    stepM: raycast.stepM,
    maxRangeM: raycast.maxRangeM,
    refineIterations: raycast.refineIterations
  });
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
  _gimbal: ReturnType<typeof resolveGimbalAttitude>
): TargetEstimate {
  const hasCoordinates = estimate.lat !== null && estimate.lon !== null;
  const { quality, valid } = aggregateTargetQuality(reasons, hasCoordinates);
  estimate.quality = quality;
  estimate.valid = valid;
  estimate.reasons = [...new Set(reasons)];

  return estimate;
}
