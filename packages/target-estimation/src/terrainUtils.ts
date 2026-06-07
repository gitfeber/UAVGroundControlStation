import type { TerrainProvider } from "@uav-ground-control-station/shared";

/** Providers that expose AMSL elevation at the estimate anchor. */
export interface AnchorTerrainProvider extends TerrainProvider {
  terrainAmslAt(lat: number, lon: number): number;
}

export function terrainAmslAt(terrain: TerrainProvider, lat: number, lon: number): number {
  if ("terrainAmslAt" in terrain && typeof terrain.terrainAmslAt === "function") {
    return (terrain as AnchorTerrainProvider).terrainAmslAt(lat, lon);
  }
  return 0;
}
