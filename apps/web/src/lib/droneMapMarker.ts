import type { FeatureCollection, Point } from "geojson";

type DroneMarkerCollection = FeatureCollection<Point, { heading?: number }>;

export const DRONE_CHEVRON_ICON_ID = "drone-chevron";

type MapInstance = import("maplibre-gl").Map;

/** Register a white SDF chevron (nose up) for heading rotation via symbol layer. */
export function ensureDroneChevronIcon(map: MapInstance): void {
  if (map.hasImage(DRONE_CHEVRON_ICON_ID)) return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18);
  ctx.lineTo(cx + 12, cy + 14);
  ctx.lineTo(cx, cy + 6);
  ctx.lineTo(cx - 12, cy + 14);
  ctx.closePath();
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, size, size);
  map.addImage(DRONE_CHEVRON_ICON_ID, imageData, { sdf: true, pixelRatio: 2 });
}

export function droneMarkerCollection(lngLat: [number, number], heading: number | null): DroneMarkerCollection {
  const properties: { heading?: number } = {};
  if (heading !== null && Number.isFinite(heading)) {
    properties.heading = heading;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties,
        geometry: {
          type: "Point",
          coordinates: lngLat
        }
      }
    ]
  };
}

export function emptyDroneMarkerCollection(): DroneMarkerCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}
