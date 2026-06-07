import { describe, expect, it, vi } from "vitest";
import { TauriDemTerrainProvider } from "./tauriDemTerrain";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

describe("TauriDemTerrainProvider", () => {
  it("loads terrain metadata from the desktop bridge", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "load_terrain_model") {
        return {
          verticalDatum: "geotiff-band-0",
          horizontalCrs: "EPSG:25832",
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

  it("prepares estimate anchor from structured IPC lookup", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_terrain_metadata") {
        return {
          verticalDatum: "geotiff-band-0",
          horizontalCrs: "EPSG:25832",
          resolutionM: 1,
          loaded: true,
          sourcePath: "/tmp/dem.tif"
        };
      }
      if (command === "sample_terrain_amsl_at") {
        expect(args?.anchorLat).toBe(50.1);
        expect(args?.lat).toBe(50.1);
        return { elevationM: 412.5 };
      }
      throw new Error(`unexpected command ${command}`);
    }) as InvokeFn;

    const provider = await TauriDemTerrainProvider.fromMetadata(invoke);
    const result = await provider!.prepareEstimateAnchor(50.1, 10.2);
    expect(result).toEqual({ ok: true, elevationAmslM: 412.5 });
    expect(provider!.terrainAmslAt(50.1, 10.2)).toBe(412.5);
  });

  it("maps batched ray failures with distinct reasons", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_terrain_metadata") {
        return {
          verticalDatum: "geotiff-band-0",
          horizontalCrs: "EPSG:25832",
          resolutionM: 1,
          loaded: true,
          sourcePath: "/tmp/dem.tif"
        };
      }
      if (command === "sample_terrain_amsl_at") {
        return { elevationM: 400 };
      }
      if (command === "get_elevations_along_ray") {
        expect(args?.anchorLat).toBe(50);
        expect(args?.distancesM).toEqual([10, 20, 30]);
        return [
          {
            sample: { distanceM: 10, enu: [0, 10, 95], elevationM: 0.5, nodata: false }
          },
          { failure: "dem_nodata" },
          { failure: "dem_out_of_coverage" }
        ];
      }
      throw new Error(`unexpected command ${command}`);
    }) as InvokeFn;

    const provider = await TauriDemTerrainProvider.fromMetadata(invoke);
    await provider!.prepareEstimateAnchor(50, 10);

    const samples = await provider!.getElevationsAlongRay([0, 0, 100], [0, 0.707, -0.707], [10, 20, 30]);
    expect(samples[0]).toEqual({
      ok: true,
      distanceM: 10,
      enu: [0, 10, 95],
      elevationM: 0.5
    });
    expect(samples[1]).toEqual({ ok: false, reason: "dem_nodata" });
    expect(samples[2]).toEqual({ ok: false, reason: "dem_out_of_coverage" });
  });
});
