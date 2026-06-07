import type {
  EnuTuple,
  TerrainElevationSample,
  TerrainMetadata,
  TerrainProvider,
  TerrainRaySample
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

  async getElevationAtEnu(_eastM: number, _northM: number): Promise<TerrainElevationSample | null> {
    return null;
  }

  async getElevationsAlongRay(
    _originEnu: EnuTuple,
    _directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<(TerrainRaySample | null)[]> {
    return distancesM.map(() => null);
  }
}
