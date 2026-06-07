import type {
  EnuTuple,
  TerrainElevationSample,
  TerrainMetadata,
  TerrainProvider,
  TerrainRaySample
} from "@uav-ground-control-station/shared";

export interface FlatTerrainProviderOptions {
  /** Constant terrain elevation in meters AMSL. */
  elevationAmslM: number;
  verticalDatum?: string;
  horizontalCrs?: string;
}

/**
 * Synthetic terrain with constant AMSL elevation. In the per-estimate ENU frame
 * the surface is always z=0 (terrain at the anchor elevation).
 */
export class FlatTerrainProvider implements TerrainProvider {
  readonly metadata: TerrainMetadata;
  readonly elevationAmslM: number;

  constructor(options: FlatTerrainProviderOptions) {
    this.elevationAmslM = options.elevationAmslM;
    this.metadata = {
      verticalDatum: options.verticalDatum ?? "constant-amsl",
      horizontalCrs: options.horizontalCrs ?? "local-enu",
      resolutionM: 0
    };
  }

  terrainAmslAt(_lat: number, _lon: number): number {
    return this.elevationAmslM;
  }

  async getElevationAtEnu(_eastM: number, _northM: number): Promise<TerrainElevationSample> {
    return { elevationM: 0, nodata: false };
  }

  async getElevationsAlongRay(
    originEnu: EnuTuple,
    directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<(TerrainRaySample | null)[]> {
    return distancesM.map((distanceM) => {
      const enu: EnuTuple = [
        originEnu[0] + directionEnu[0] * distanceM,
        originEnu[1] + directionEnu[1] * distanceM,
        originEnu[2] + directionEnu[2] * distanceM
      ];
      return {
        distanceM,
        enu,
        elevationM: 0,
        nodata: false
      };
    });
  }
}
