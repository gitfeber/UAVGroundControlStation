import type { EnuTuple, TerrainProvider } from "@uav-ground-control-station/shared";

export interface RayIntersectOptions {
  stepM?: number;
  maxRangeM?: number;
  batchSize?: number;
  refineIterations?: number;
}

export interface RayIntersectionHit {
  hitEnu: EnuTuple;
  slantRangeM: number;
  terrainElevationM: number;
}

export type RayIntersectFailureReason = "no_ray_intersection" | "dem_nodata" | "dem_out_of_coverage";

export type RayIntersectResult =
  | { ok: true; hit: RayIntersectionHit }
  | { ok: false; reason: RayIntersectFailureReason };

const DEFAULT_STEP_M = 5;
const DEFAULT_MAX_RANGE_M = 20_000;
const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_REFINE_ITERATIONS = 14;

function rayPoint(originEnu: EnuTuple, directionEnu: EnuTuple, distanceM: number): EnuTuple {
  return [
    originEnu[0] + directionEnu[0] * distanceM,
    originEnu[1] + directionEnu[1] * distanceM,
    originEnu[2] + directionEnu[2] * distanceM
  ];
}

async function heightAboveTerrainAtDistance(
  originEnu: EnuTuple,
  directionEnu: EnuTuple,
  distanceM: number,
  terrain: TerrainProvider
): Promise<number | null | "out_of_coverage"> {
  const [east, north, up] = rayPoint(originEnu, directionEnu, distanceM);
  const sample = await terrain.getElevationAtEnu(east, north);
  if (sample === null) return "out_of_coverage";
  if (sample.nodata) return null;
  return up - sample.elevationM;
}

async function refineIntersection(
  originEnu: EnuTuple,
  directionEnu: EnuTuple,
  terrain: TerrainProvider,
  lowerDistanceM: number,
  upperDistanceM: number,
  iterations: number
): Promise<RayIntersectResult> {
  let low = lowerDistanceM;
  let high = upperDistanceM;

  for (let index = 0; index < iterations; index += 1) {
    const mid = (low + high) / 2;
    const height = await heightAboveTerrainAtDistance(originEnu, directionEnu, mid, terrain);
    if (height === "out_of_coverage") {
      return { ok: false, reason: "dem_out_of_coverage" };
    }
    if (height === null) {
      return { ok: false, reason: "dem_nodata" };
    }
    if (height > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const slantRangeM = high;
  const hitEnu = rayPoint(originEnu, directionEnu, slantRangeM);
  const terrainSample = await terrain.getElevationAtEnu(hitEnu[0], hitEnu[1]);
  if (terrainSample === null) {
    return { ok: false, reason: "dem_out_of_coverage" };
  }
  if (terrainSample.nodata) {
    return { ok: false, reason: "dem_nodata" };
  }

  return {
    ok: true,
    hit: {
      hitEnu: [hitEnu[0], hitEnu[1], terrainSample.elevationM],
      slantRangeM,
      terrainElevationM: terrainSample.elevationM
    }
  };
}

/**
 * March along a unit ray and intersect the terrain surface using batched DEM samples.
 */
export async function intersectRayWithTerrain(
  originEnu: EnuTuple,
  directionEnu: EnuTuple,
  terrain: TerrainProvider,
  options: RayIntersectOptions = {}
): Promise<RayIntersectResult> {
  const stepM = options.stepM ?? DEFAULT_STEP_M;
  const maxRangeM = options.maxRangeM ?? DEFAULT_MAX_RANGE_M;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const refineIterations = options.refineIterations ?? DEFAULT_REFINE_ITERATIONS;

  if (directionEnu[2] >= -1e-9) {
    return { ok: false, reason: "no_ray_intersection" };
  }

  const originHeight = await heightAboveTerrainAtDistance(originEnu, directionEnu, 0, terrain);
  if (originHeight === "out_of_coverage") {
    return { ok: false, reason: "dem_out_of_coverage" };
  }
  if (originHeight === null) {
    return { ok: false, reason: "dem_nodata" };
  }
  if (originHeight <= 0) {
    return { ok: false, reason: "no_ray_intersection" };
  }

  const distances: number[] = [];
  for (let distanceM = stepM; distanceM <= maxRangeM; distanceM += stepM) {
    distances.push(distanceM);
  }

  let previousDistanceM = 0;
  let previousHeight = originHeight;

  for (let offset = 0; offset < distances.length; offset += batchSize) {
    const batchDistances = distances.slice(offset, offset + batchSize);
    const samples = await terrain.getElevationsAlongRay(originEnu, directionEnu, batchDistances);

    for (let index = 0; index < batchDistances.length; index += 1) {
      const distanceM = batchDistances[index]!;
      const sample = samples[index];
      if (sample === null || sample === undefined) {
        return { ok: false, reason: "dem_out_of_coverage" };
      }
      if (sample.nodata) {
        return { ok: false, reason: "dem_nodata" };
      }

      const rayUp = rayPoint(originEnu, directionEnu, distanceM)[2];
      const height = rayUp - sample.elevationM;
      if (height <= 0) {
        return refineIntersection(
          originEnu,
          directionEnu,
          terrain,
          previousDistanceM,
          distanceM,
          refineIterations
        );
      }

      previousDistanceM = distanceM;
      previousHeight = height;
    }
  }

  void previousHeight;
  return { ok: false, reason: "no_ray_intersection" };
}
