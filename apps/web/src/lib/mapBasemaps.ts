import type { StyleSpecification } from "maplibre-gl";
import { sanitizeHttpUrl, sanitizeTileTemplateUrl } from "./safeHttpUrl";

export type MapBasemapId = "tactical" | "satellite" | "topo";

export const MAP_BASEMAP_STORAGE_KEY = "uav-gcs.map.basemap";

export interface MapBasemapOption {
  id: MapBasemapId;
  label: string;
}

export const MAP_BASEMAP_OPTIONS: MapBasemapOption[] = [
  { id: "tactical", label: "Tactical" },
  { id: "satellite", label: "Satellite" },
  { id: "topo", label: "Topo" }
];

const DEFAULT_BASEMAP_ID: MapBasemapId = "tactical";

export function isMapBasemapId(value: string): value is MapBasemapId {
  return value === "tactical" || value === "satellite" || value === "topo";
}

export function loadMapBasemapId(): MapBasemapId {
  const raw = localStorage.getItem(MAP_BASEMAP_STORAGE_KEY);
  if (raw && isMapBasemapId(raw)) return raw;
  return DEFAULT_BASEMAP_ID;
}

export function saveMapBasemapId(id: MapBasemapId): void {
  localStorage.setItem(MAP_BASEMAP_STORAGE_KEY, id);
}

/** When set, the operator chose a fixed MapLibre style at build time — hide the in-app switcher. */
export function isMapBasemapSwitcherEnabled(): boolean {
  return !import.meta.env.VITE_MAP_STYLE_URL;
}

export function buildMapStyle(basemapId: MapBasemapId): StyleSpecification | string {
  const customStyleUrl = sanitizeHttpUrl(import.meta.env.VITE_MAP_STYLE_URL ?? "");
  if (customStyleUrl) return customStyleUrl;

  const { tiles, attribution } = basemapTileConfig(basemapId);

  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution
      }
    },
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap"
      }
    ]
  };
}

export function basemapTileConfig(basemapId: MapBasemapId): { tiles: string[]; attribution: string } {
  switch (basemapId) {
    case "satellite": {
      const customSatelliteUrl = sanitizeTileTemplateUrl(import.meta.env.VITE_SATELLITE_TILE_URL ?? "");
      if (customSatelliteUrl) {
        return {
          tiles: [customSatelliteUrl],
          attribution: "Satellite tiles"
        };
      }

      return {
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        attribution: "Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, AeroGRID, IGN, IGP, and the GIS user community"
      };
    }
    case "topo":
      return {
        tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        attribution: "OpenTopoMap (CC-BY-SA), OpenStreetMap contributors"
      };
    default:
      return {
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        attribution: "OpenStreetMap contributors"
      };
  }
}
