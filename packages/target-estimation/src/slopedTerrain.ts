import type {
  EnuTuple,
  TerrainElevationLookup,
  TerrainMetadata,
  TerrainProvider,
  TerrainRayLookup
} from "@uav-ground-control-station/shared";

export interface SlopedPlaneTerrainProviderOptions {
  /** Terrain AMSL at the ENU anchor (0, 0). */
  elevationAmslM: number;
  /** ENU surface rise per meter east. */
  slopeEast?: number;
  /** ENU surface rise per meter north. */
  slopeNorth?: number;
  /** Optional absolute ENU coverage radius; outside returns out-of-coverage. */
  coverageRadiusM?: number;
  verticalDatum?: string;
  horizontalCrs?: string;
}

/**
 * Synthetic sloped plane in ENU: z = east * slopeEast + north * slopeNorth.
 */
export class SlopedPlaneTerrainProvider implements TerrainProvider {
  readonly metadata: TerrainMetadata;
  readonly elevationAmslM: number;
  readonly slopeEast: number;
  readonly slopeNorth: number;
  readonly coverageRadiusM: number | null;

  constructor(options: SlopedPlaneTerrainProviderOptions) {
    this.elevationAmslM = options.elevationAmslM;
    this.slopeEast = options.slopeEast ?? 0;
    this.slopeNorth = options.slopeNorth ?? 0;
    this.coverageRadiusM = options.coverageRadiusM ?? null;
    this.metadata = {
      verticalDatum: options.verticalDatum ?? "synthetic-enu-plane",
      horizontalCrs: options.horizontalCrs ?? "local-enu",
      resolutionM: 1
    };
  }

  terrainAmslAt(_lat: number, _lon: number): number {
    return this.elevationAmslM;
  }

  surfaceEnuAt(eastM: number, northM: number): number {
    return eastM * this.slopeEast + northM * this.slopeNorth;
  }

  private isInCoverage(eastM: number, northM: number): boolean {
    if (this.coverageRadiusM === null) return true;
    return Math.hypot(eastM, northM) <= this.coverageRadiusM;
  }

  async getElevationAtEnu(eastM: number, northM: number): Promise<TerrainElevationLookup> {
    if (!this.isInCoverage(eastM, northM)) {
      return { ok: false, reason: "dem_out_of_coverage" };
    }
    return { ok: true, elevationM: this.surfaceEnuAt(eastM, northM) };
  }

  async getElevationsAlongRay(
    originEnu: EnuTuple,
    directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<TerrainRayLookup[]> {
    return Promise.all(
      distancesM.map(async (distanceM) => {
        const enu = [
          originEnu[0] + directionEnu[0] * distanceM,
          originEnu[1] + directionEnu[1] * distanceM,
          originEnu[2] + directionEnu[2] * distanceM
        ] as EnuTuple;
        const elevation = await this.getElevationAtEnu(enu[0], enu[1]);
        if (!elevation.ok) {
          return { ok: false, reason: elevation.reason };
        }
        return {
          ok: true,
          distanceM,
          enu,
          elevationM: elevation.elevationM
        };
      })
    );
  }
}
