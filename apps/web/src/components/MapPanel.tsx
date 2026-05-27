import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import type { Coordinate } from "../lib/geo";
import { isValidLngLat, toMapLngLat } from "../lib/geo";
import { resolveHeadingDeg } from "../lib/resolveHeadingDeg";
import { HudOverlay } from "./HudOverlay";

interface MapPanelProps {
  telemetry: TelemetryState;
  coordinate: Coordinate | null;
  home: Coordinate | null;
}

type TrackFeature = Feature<LineString, Record<string, never>>;
type PointCollection = FeatureCollection<Point, Record<string, never>>;

const fallbackCenter: [number, number] = [10.4515, 51.1657];

export function MapPanel({ telemetry, coordinate, home }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const centeredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [track, setTrack] = useState<[number, number][]>([]);

  const droneLngLat = useMemo(() => toMapLngLat(coordinate), [coordinate]);
  const homeLngLat = useMemo(() => toMapLngLat(home), [home]);

  const heading = resolveHeadingDeg(telemetry) ?? 0;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;

    const setup = async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      maplibreRef.current = maplibregl;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(),
        center: fallbackCenter,
        zoom: 5,
        attributionControl: false
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;

        map.addSource("track", { type: "geojson", data: trackFeature([]) });
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

        map.addSource("drone", { type: "geojson", data: emptyPointCollection() });
        map.addLayer({
          id: "drone-point",
          type: "circle",
          source: "drone",
          paint: {
            "circle-radius": 9,
            "circle-color": "#22d3ee",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#0f172a"
          }
        });

        map.addSource("home", { type: "geojson", data: emptyPointCollection() });
        map.addLayer({
          id: "home-point",
          type: "circle",
          source: "home",
          paint: {
            "circle-radius": 7,
            "circle-color": "#fbbf24",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#0f172a"
          }
        });

        setMapReady(true);
      });
    };

    setup().catch((error: unknown) => {
      console.error("Unable to initialize map", error);
    });

    return () => {
      disposed = true;
      setMapReady(false);
      map?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      centeredRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!droneLngLat) return;

    setTrack((current) => {
      const last = current[current.length - 1];
      if (last && Math.abs(last[0] - droneLngLat[0]) < 0.000001 && Math.abs(last[1] - droneLngLat[1]) < 0.000001) {
        return current;
      }

      return [...current, droneLngLat].slice(-5000);
    });
  }, [droneLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("track") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(trackFeature(sanitizeTrack(track)));
  }, [mapReady, track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !droneLngLat) return;

    const source = map.getSource("drone") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(pointCollection(droneLngLat));

    if (!centeredRef.current) {
      centeredRef.current = true;
      map.jumpTo({ center: droneLngLat, zoom: 15 });
    }
  }, [droneLngLat, heading, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !homeLngLat) return;

    const source = map.getSource("home") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(pointCollection(homeLngLat));
  }, [homeLngLat, mapReady]);

  return (
    <main className="relative min-w-0 flex-1">
      <div ref={containerRef} className="h-full w-full bg-slate-950" />

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        <HudOverlay telemetry={telemetry} />
      </div>

      <button className="btn-secondary absolute bottom-4 left-4" onClick={() => setTrack([])}>
        Clear Track
      </button>
    </main>
  );
}

function sanitizeTrack(track: [number, number][]): [number, number][] {
  return track.filter((point) => isValidLngLat(point[0], point[1]));
}

function mapStyle(): import("maplibre-gl").StyleSpecification | string {
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

function pointCollection(lngLat: [number, number]): PointCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: lngLat
        }
      }
    ]
  };
}

function emptyPointCollection(): PointCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}
