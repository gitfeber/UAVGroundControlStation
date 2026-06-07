import type {
  EnuTuple,
  TerrainElevationSample,
  TerrainMetadata,
  TerrainProvider,
  TerrainRaySample
} from "@uav-ground-control-station/shared";
import type { AnchorTerrainProvider } from "@uav-ground-control-station/target-estimation";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TerrainMetadataResponse {
  verticalDatum: string;
  horizontalCrs: string;
  resolutionM: number;
  loaded: boolean;
  sourcePath: string | null;
}

interface TerrainElevationSampleResponse {
  elevationM: number;
  nodata: boolean;
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

export class TauriDemTerrainProvider implements TerrainProvider, AnchorTerrainProvider {
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

  /** Cache anchor AMSL for synchronous terrainAmslAt during one estimate tick. */
  async prepareEstimateAnchor(lat: number, lon: number): Promise<void> {
    this.anchorLat = lat;
    this.anchorLon = lon;
    this.anchorAmslM = await this.invokeFn<number | null>("sample_terrain_amsl_at", {
      anchorLat: lat,
      anchorLon: lon,
      lat,
      lon
    });
  }

  terrainAmslAt(lat: number, lon: number): number {
    if (this.anchorAmslM !== null && lat === this.anchorLat && lon === this.anchorLon) {
      return this.anchorAmslM;
    }
    throw new Error("Call prepareEstimateAnchor() before terrainAmslAt() in desktop DEM mode");
  }

  async getElevationAtEnu(eastM: number, northM: number): Promise<TerrainElevationSample | null> {
    const sample = await this.invokeFn<TerrainElevationSampleResponse | null>("get_elevation_at_enu", {
      anchorLat: this.anchorLat,
      anchorLon: this.anchorLon,
      eastM,
      northM
    });
    if (!sample) return null;
    return { elevationM: sample.elevationM, nodata: sample.nodata };
  }

  async getElevationsAlongRay(
    originEnu: EnuTuple,
    directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<(TerrainRaySample | null)[]> {
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

    const samples = await this.invokeFn<(TerrainRaySampleResponse | null)[]>("get_elevations_along_ray", {
      anchorLat: this.anchorLat,
      anchorLon: this.anchorLon,
      origin,
      direction,
      distancesM: [...distancesM]
    });

    return samples.map((sample) =>
      sample
        ? {
            distanceM: sample.distanceM,
            enu: sample.enu,
            elevationM: sample.elevationM,
            nodata: sample.nodata
          }
        : null
    );
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
