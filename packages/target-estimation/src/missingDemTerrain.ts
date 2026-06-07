import type {
  EnuTuple,
  TerrainElevationLookup,
  TerrainMetadata,
  TerrainProvider,
  TerrainRayLookup
} from "@uav-ground-control-station/shared";

/**
 * Placeholder terrain provider for desktop live mode when no DEM is loaded.
 * Surfaces `dem_not_loaded` instead of silently using flat terrain.
 */
export class MissingDemTerrainProvider implements TerrainProvider {
  readonly demLoaded = false;
  readonly metadata: TerrainMetadata = {
    verticalDatum: "none",
    horizontalCrs: "none",
    resolutionM: 0
  };

  async getElevationAtEnu(_eastM: number, _northM: number): Promise<TerrainElevationLookup> {
    return { ok: false, reason: "dem_out_of_coverage" };
  }

  async getElevationsAlongRay(
    _originEnu: EnuTuple,
    _directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<TerrainRayLookup[]> {
    return distancesM.map(() => ({ ok: false, reason: "dem_out_of_coverage" }));
  }
}
