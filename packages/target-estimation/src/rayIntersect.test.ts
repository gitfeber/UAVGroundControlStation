import type { EnuTuple, TerrainElevationLookup, TerrainProvider, TerrainRayLookup } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";
import { FlatTerrainProvider } from "./flatTerrain.js";
import { intersectRayWithTerrain } from "./rayIntersect.js";
import { SlopedPlaneTerrainProvider } from "./slopedTerrain.js";

class FailureTerrainProvider implements TerrainProvider {
  readonly metadata = {
    verticalDatum: "test",
    horizontalCrs: "test",
    resolutionM: 1
  };

  constructor(
    private readonly pointReason: "dem_nodata" | "dem_out_of_coverage",
    private readonly rayReason: "dem_nodata" | "dem_out_of_coverage"
  ) {}

  async getElevationAtEnu(): Promise<TerrainElevationLookup> {
    return { ok: false, reason: this.pointReason };
  }

  async getElevationsAlongRay(
    _originEnu: EnuTuple,
    _directionEnu: EnuTuple,
    distancesM: readonly number[]
  ): Promise<TerrainRayLookup[]> {
    return distancesM.map(() => ({ ok: false, reason: this.rayReason }));
  }
}

describe("intersectRayWithTerrain", () => {
  it("matches flat-plane nadir hit via terrain marching", async () => {
    const terrain = new FlatTerrainProvider({ elevationAmslM: 400 });
    const origin: EnuTuple = [0, 0, 100];
    const direction: EnuTuple = [0, 0, -1];

    const result = await intersectRayWithTerrain(origin, direction, terrain);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hit.slantRangeM).toBeCloseTo(100, 2);
    expect(result.hit.hitEnu[0]).toBeCloseTo(0, 2);
    expect(result.hit.hitEnu[1]).toBeCloseTo(0, 2);
    expect(result.hit.terrainElevationM).toBe(0);
  });

  it("finds intersection on a north-sloping plane", async () => {
    const terrain = new SlopedPlaneTerrainProvider({
      elevationAmslM: 400,
      slopeNorth: 0.1
    });
    const origin: EnuTuple = [0, 0, 100];
    const cos45 = Math.cos(Math.PI / 4);
    const direction: EnuTuple = [0, cos45, -cos45];

    const result = await intersectRayWithTerrain(origin, direction, terrain, { stepM: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hit.hitEnu[1]).toBeGreaterThan(80);
    expect(result.hit.hitEnu[1]).toBeLessThan(110);
    expect(result.hit.hitEnu[2]).toBeCloseTo(result.hit.hitEnu[1] * 0.1, 1);
  });

  it("rejects rays that do not point below the horizon", async () => {
    const terrain = new FlatTerrainProvider({ elevationAmslM: 400 });
    const origin: EnuTuple = [0, 0, 100];
    const direction: EnuTuple = [0, 0, 1];

    const result = await intersectRayWithTerrain(origin, direction, terrain);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_ray_intersection");
  });

  it("returns dem_nodata when the terrain provider reports nodata", async () => {
    const terrain = new FailureTerrainProvider("dem_nodata", "dem_nodata");
    const origin: EnuTuple = [0, 0, 100];
    const direction: EnuTuple = [0, 0, -1];

    const result = await intersectRayWithTerrain(origin, direction, terrain);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("dem_nodata");
  });

  it("returns dem_out_of_coverage when batched ray samples leave coverage", async () => {
    const flat = new FlatTerrainProvider({ elevationAmslM: 400 });
    const failingTerrain: TerrainProvider = {
      metadata: flat.metadata,
      getElevationAtEnu: (eastM, northM) => flat.getElevationAtEnu(eastM, northM),
      getElevationsAlongRay: (_originEnu, _directionEnu, distancesM) =>
        Promise.resolve(distancesM.map(() => ({ ok: false, reason: "dem_out_of_coverage" as const })))
    };
    const origin: EnuTuple = [0, 0, 100];
    const direction: EnuTuple = [0, 0, -1];

    const result = await intersectRayWithTerrain(origin, direction, failingTerrain, { stepM: 5, maxRangeM: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("dem_out_of_coverage");
  });

  it("returns dem_out_of_coverage when the ray leaves terrain bounds", async () => {
    const terrain = new SlopedPlaneTerrainProvider({
      elevationAmslM: 400,
      coverageRadiusM: 50
    });
    const origin: EnuTuple = [0, 0, 100];
    const direction: EnuTuple = [0, 0.707, -0.707];

    const result = await intersectRayWithTerrain(origin, direction, terrain, { stepM: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("dem_out_of_coverage");
  });
});
