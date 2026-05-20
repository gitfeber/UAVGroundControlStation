import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import type { Coordinate } from "../lib/geo";
import { formatInteger, formatNumber } from "../lib/format";

interface MapPanelProps {
  telemetry: TelemetryState;
  coordinate: Coordinate | null;
  home: Coordinate | null;
}

type TrackFeature = Feature<LineString, Record<string, never>>;

const fallbackCenter: [number, number] = [10.4515, 51.1657];

export function MapPanel({ telemetry, coordinate, home }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const droneMarkerRef = useRef<maplibregl.Marker | null>(null);
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const centeredRef = useRef(false);
  const [track, setTrack] = useState<[number, number][]>([]);

  const heading = telemetry.position.headingDeg ?? telemetry.position.groundCourseDeg ?? telemetry.motion.yawDeg ?? 0;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: fallbackCenter,
      zoom: 5,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: trackFeature([])
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#22d3ee",
          "line-width": 3,
          "line-opacity": 0.9
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!coordinate) return;
    const next: [number, number] = [coordinate.lon, coordinate.lat];

    setTrack((current) => {
      const last = current[current.length - 1];
      if (last && Math.abs(last[0] - next[0]) < 0.000001 && Math.abs(last[1] - next[1]) < 0.000001) {
        return current;
      }

      return [...current, next].slice(-5000);
    });
  }, [coordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource("track") as GeoJSONSource | undefined;
    source?.setData(trackFeature(track));
  }, [track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coordinate) return;

    if (!droneMarkerRef.current) {
      droneMarkerRef.current = new maplibregl.Marker({
        element: droneElement(),
        rotationAlignment: "map"
      }).addTo(map);
    }

    droneMarkerRef.current.setLngLat([coordinate.lon, coordinate.lat]).setRotation(heading);

    if (!centeredRef.current) {
      centeredRef.current = true;
      map.easeTo({ center: [coordinate.lon, coordinate.lat], zoom: 15, duration: 900 });
    }
  }, [coordinate, heading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !home) return;

    if (!homeMarkerRef.current) {
      homeMarkerRef.current = new maplibregl.Marker({ element: homeElement() }).addTo(map);
    }

    homeMarkerRef.current.setLngLat([home.lon, home.lat]);
  }, [home]);

  const overlay = useMemo(
    () => ({
      altitude: telemetry.position.relativeAlt ?? telemetry.position.altMsl,
      speed: telemetry.motion.groundSpeed,
      mode: telemetry.vehicle.flightMode,
      battery: telemetry.battery.remainingPercent
    }),
    [telemetry]
  );

  return (
    <main className="relative min-w-0 flex-1">
      <div ref={containerRef} className="h-full w-full bg-slate-950" />

      <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-cyan-300/20 bg-black/55 px-4 py-3 font-mono text-xs text-slate-200 shadow-glow backdrop-blur">
        <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-cyan-200">Drone Overlay</div>
        <div>ALT {formatNumber(overlay.altitude, 1, "m")}</div>
        <div>SPD {formatNumber(overlay.speed, 1, "m/s")}</div>
        <div>MODE {overlay.mode}</div>
        <div>BAT {formatInteger(overlay.battery, "%")}</div>
      </div>

      <button className="btn-secondary absolute bottom-4 left-4" onClick={() => setTrack([])}>
        Clear Track
      </button>
    </main>
  );
}

function mapStyle(): maplibregl.StyleSpecification | string {
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL;
  if (styleUrl) return styleUrl;

  const satelliteTileUrl = import.meta.env.VITE_SATELLITE_TILE_URL;
  const tiles = satelliteTileUrl ? [satelliteTileUrl] : ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
  const attribution = satelliteTileUrl ? "Satellite tiles" : "OpenStreetMap contributors";

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

function trackFeature(track: [number, number][]): TrackFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: track
    }
  };
}

function droneElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "drone-marker";
  element.innerHTML = "<div></div>";
  return element;
}

function homeElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "home-marker";
  element.textContent = "H";
  return element;
}
