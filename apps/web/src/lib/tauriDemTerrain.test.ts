import { describe, expect, it, vi } from "vitest";
import { TauriDemTerrainProvider } from "./tauriDemTerrain";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

describe("TauriDemTerrainProvider", () => {
  it("loads terrain metadata from the desktop bridge", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "load_terrain_model") {
        return {
          verticalDatum: "geotiff-band-0",
          horizontalCrs: "EPSG:4326",
          resolutionM: 1,
          loaded: true,
          sourcePath: "/tmp/dem.tif"
        };
      }
      throw new Error(`unexpected command ${command}`);
    }) as InvokeFn;

    const provider = await TauriDemTerrainProvider.load("/tmp/dem.tif", invoke);
    expect(provider.metadata.resolutionM).toBe(1);
    expect(invoke).toHaveBeenCalledWith("load_terrain_model", { path: "/tmp/dem.tif" });
  });

  it("maps batched ray samples from IPC into TerrainProvider shape", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_terrain_metadata") {
        return {
          verticalDatum: "geotiff-band-0",
          horizontalCrs: "EPSG:4326",
          resolutionM: 1,
          loaded: true,
          sourcePath: "/tmp/dem.tif"
        };
      }
      if (command === "sample_terrain_amsl_at") {
        return 400;
      }
      if (command === "get_elevations_along_ray") {
        expect(args?.anchorLat).toBe(50);
        expect(args?.distancesM).toEqual([10, 20]);
        return [
          { distanceM: 10, enu: [0, 10, 95], elevationM: 0.5, nodata: false },
          null
        ];
      }
      throw new Error(`unexpected command ${command}`);
    }) as InvokeFn;

    const provider = await TauriDemTerrainProvider.fromMetadata(invoke);
    expect(provider).not.toBeNull();
    await provider!.prepareEstimateAnchor(50, 10);

    const samples = await provider!.getElevationsAlongRay([0, 0, 100], [0, 0.707, -0.707], [10, 20]);
    expect(samples[0]?.distanceM).toBe(10);
    expect(samples[0]?.enu).toEqual([0, 10, 95]);
    expect(samples[1]).toBeNull();
    expect(provider!.terrainAmslAt(48, 11)).toBe(400);
  });
});
