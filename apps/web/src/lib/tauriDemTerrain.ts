import type {
  EnuTuple,
  TerrainElevationLookup,
  TerrainMetadata,
  TerrainProvider,
  TerrainRayLookup,
  TerrainSampleFailureReason
} from "@uav-ground-control-station/shared";
import type {
  AnchorCapableTerrainProvider,
  TerrainAnchorPrepareResult
} from "@uav-ground-control-station/target-estimation";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TerrainMetadataResponse {
  verticalDatum: string;
  horizontalCrs: string;
  resolutionM: number;
  loaded: boolean;
  sourcePath: string | null;
}

interface TerrainLookupResponse {
  elevationM?: number;
  sample?: TerrainRaySampleResponse;
  failure?: TerrainSampleFailureReason;
}

interface TerrainRaySampleResponse {
  distanceM: number;
  enu: [number, number, number];
  elevationM: number;
  nodata: boolean;
}

interface EnuPointResponse {
  eastM: number;
  northM: number;
  upM: number;
}

async function defaultInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function toFailureReason(failure: string | undefined): TerrainSampleFailureReason {
  return failure === "dem_nodata" ? "dem_nodata" : "dem_out_of_coverage";
}

export class TauriDemTerrainProvider implements TerrainProvider, AnchorCapableTerrainProvider {
  readonly metadata: TerrainMetadata;
  private anchorLat = 0;
  private anchorLon = 0;
  private anchorAmslM: number | null = null;
  private readonly invokeFn: InvokeFn;

  constructor(metadata: TerrainMetadata, invokeFn: InvokeFn = defaultInvoke) {
    this.metadata = metadata;
    this.invokeFn = invokeFn;
  }

  static async load(path: string, invokeFn: InvokeFn = defaultInvoke): Promise<TauriDemTerrainProvider> {
    const response = await invokeFn<TerrainMetadataResponse>("load_terrain_model", { path });
    return new TauriDemTerrainProvider(
      {
        verticalDatum: response.verticalDatum,
        horizontalCrs: response.horizontalCrs,
        resolutionM: response.resolutionM
      },
      invokeFn
    );
  }

  static async fromMetadata(invokeFn: InvokeFn = defaultInvoke): Promise<TauriDemTerrainProvider | null> {
    const response = await invokeFn<TerrainMetadataResponse>("get_terrain_metadata");
    if (!response.loaded) return null;
    return new TauriDemTerrainProvider(
      {
        verticalDatum: response.verticalDatum,
        horizontalCrs: response.horizontalCrs,
        resolutionM: response.resolutionM
      },
      invokeFn
    );
  }

  async prepareEstimateAnchor(lat: number, lon: number): Promise<TerrainAnchorPrepareResult> {
    this.anchorLat = lat;
    this.anchorLon = lon;
    const response = await this.invokeFn<TerrainLookupResponse>("sample_terrain_amsl_at", {
      anchorLat: lat,
      anchorLon: lon,
      lat,
      lon
    });

    if (response.failure) {
      this.anchorAmslM = null;
      return { ok: false, reason: toFailureReason(response.failure) };
    }

    if (response.elevationM === undefined || response.elevationM === null) {
      this.anchorAmslM = null;
      return { ok: false, reason: "dem_out_of_coverage" };
    }

    this.anchorAmslM = response.elevationM;
    return { ok: true, elevationAmslM: response.elevationM };
  }

  getAnchorElevationAmsl(): number | null {
    return this.anchorAmslM;
  }

  terrainAmslAt(lat: number, lon: number): number | null {
    if (this.anchorAmslM !== null && lat === this.anchorLat && lon === this.anchorLon) {
      return this.anchorAmslM;
    }
    return null;
  }

  async getElevationAtEnu(eastM: number, northM: number): Promise<TerrainElevationLookup> {
    const response = await this.invokeFn<TerrainLookupResponse>("get_elevation_at_enu", {
      anchorLat: this.anchorLat,
      anchorLon: this.anchorLon,
      eastM,
      northM
    });

    if (response.failure) {
      return { ok: false, reason: toFailureReason(response.failure) };
    }

    if (response.elevationM === undefined || response.elevationM === null) {
      return { ok: false, reason: "dem_out_of_coverage" };
    }

    return { ok: true, elevationM: response.elevationM };
  }

  async getElevationsAlongRay(
    originEnu: EnuTuple,
    directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<TerrainRayLookup[]> {
    const origin: EnuPointResponse = {
      eastM: originEnu[0],
      northM: originEnu[1],
      upM: originEnu[2]
    };
    const direction: EnuPointResponse = {
      eastM: directionEnu[0],
      northM: directionEnu[1],
      upM: directionEnu[2]
    };

    const samples = await this.invokeFn<TerrainLookupResponse[]>("get_elevations_along_ray", {
      anchorLat: this.anchorLat,
      anchorLon: this.anchorLon,
      origin,
      direction,
      distancesM: [...distancesM]
    });

    return samples.map((entry) => {
      if (entry.failure) {
        return { ok: false, reason: toFailureReason(entry.failure) };
      }
      if (!entry.sample) {
        return { ok: false, reason: "dem_out_of_coverage" };
      }
      return {
        ok: true,
        distanceM: entry.sample.distanceM,
        enu: entry.sample.enu,
        elevationM: entry.sample.elevationM
      };
    });
  }
}

export async function clearDesktopTerrainModel(invokeFn: InvokeFn = defaultInvoke): Promise<TerrainMetadata> {
  const response = await invokeFn<TerrainMetadataResponse>("clear_terrain_model");
  return {
    verticalDatum: response.verticalDatum,
    horizontalCrs: response.horizontalCrs,
    resolutionM: response.resolutionM
  };
}
