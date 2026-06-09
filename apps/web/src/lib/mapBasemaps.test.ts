import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAP_BASEMAP_STORAGE_KEY,
  basemapTileConfig,
  buildMapStyle,
  isMapBasemapId,
  loadMapBasemapId,
  saveMapBasemapId
} from "./mapBasemaps";

function stubLocalStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    }
  });
}

describe("mapBasemaps", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes valid basemap ids", () => {
    expect(isMapBasemapId("tactical")).toBe(true);
    expect(isMapBasemapId("satellite")).toBe(true);
    expect(isMapBasemapId("topo")).toBe(true);
    expect(isMapBasemapId("terrain3d")).toBe(false);
  });

  it("loads and persists basemap preference", () => {
    expect(loadMapBasemapId()).toBe("tactical");

    saveMapBasemapId("satellite");
    expect(localStorage.getItem(MAP_BASEMAP_STORAGE_KEY)).toBe("satellite");
    expect(loadMapBasemapId()).toBe("satellite");
  });

  it("falls back when stored value is invalid", () => {
    localStorage.setItem(MAP_BASEMAP_STORAGE_KEY, "invalid");
    expect(loadMapBasemapId()).toBe("tactical");
  });

  it("builds raster styles for each preset", () => {
    const tactical = buildMapStyle("tactical");
    expect(typeof tactical).toBe("object");
    if (typeof tactical === "string") return;

    expect(tactical.sources?.basemap).toMatchObject({
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]
    });

    const satellite = buildMapStyle("satellite");
    if (typeof satellite === "string") return;
    expect(satellite.sources?.basemap).toMatchObject({
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ]
    });

    const topo = buildMapStyle("topo");
    if (typeof topo === "string") return;
    expect(topo.sources?.basemap).toMatchObject({
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"]
    });
  });

  it("uses custom satellite tiles when configured", () => {
    vi.stubEnv("VITE_SATELLITE_TILE_URL", "https://example.test/{z}/{x}/{y}.png");

    const config = basemapTileConfig("satellite");
    expect(config.tiles).toEqual(["https://example.test/{z}/{x}/{y}.png"]);
    expect(config.attribution).toBe("Satellite tiles");
  });
});
