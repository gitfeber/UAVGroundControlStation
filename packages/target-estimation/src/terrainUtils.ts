import type { TerrainProvider, TerrainSampleFailureReason } from "@uav-ground-control-station/shared";

export type TerrainAnchorPrepareResult =
  | { ok: true; elevationAmslM: number }
  | { ok: false; reason: TerrainSampleFailureReason };

/** Providers that bind DEM sampling to a per-estimate WGS84 anchor. */
export interface AnchorCapableTerrainProvider extends TerrainProvider {
  prepareEstimateAnchor(lat: number, lon: number): Promise<TerrainAnchorPrepareResult>;
  getAnchorElevationAmsl(): number | null;
}

function hasTerrainAmslAt(terrain: TerrainProvider): terrain is TerrainProvider & {
  terrainAmslAt(lat: number, lon: number): number;
} {
  return "terrainAmslAt" in terrain && typeof terrain.terrainAmslAt === "function";
}

export async function prepareTerrainAnchor(
  terrain: TerrainProvider,
  lat: number,
  lon: number
): Promise<TerrainAnchorPrepareResult> {
  if ("prepareEstimateAnchor" in terrain && typeof terrain.prepareEstimateAnchor === "function") {
    return (terrain as AnchorCapableTerrainProvider).prepareEstimateAnchor(lat, lon);
  }

  if (hasTerrainAmslAt(terrain)) {
    return { ok: true, elevationAmslM: terrain.terrainAmslAt(lat, lon) };
  }

  return { ok: true, elevationAmslM: 0 };
}

/** AMSL elevation at the prepared estimate anchor; never throws. */
export function terrainAmslAt(terrain: TerrainProvider, lat: number, lon: number): number | null {
  if ("getAnchorElevationAmsl" in terrain && typeof terrain.getAnchorElevationAmsl === "function") {
    const cached = (terrain as AnchorCapableTerrainProvider).getAnchorElevationAmsl();
    if (cached !== null) {
      return cached;
    }
  }

  if (hasTerrainAmslAt(terrain)) {
    return terrain.terrainAmslAt(lat, lon);
  }

  return 0;
}
