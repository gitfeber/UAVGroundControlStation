import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { FlightReviewPathVertex, PathColoringMode } from "../../flightReview/flightReviewTypes";
import {
  normalizePathMetric,
  pathColorHex,
  pathColorRange,
  PATH_COLOR_MODES
} from "../../flightReview/pathColoring";
import { isValidLngLat } from "../../lib/geo";
import { buildMapStyle, loadMapBasemapId } from "../../lib/mapBasemaps";
import { Panel } from "../Panel";

type MapInstance = import("maplibre-gl").Map;
type SegmentCollection = FeatureCollection<LineString, { color: string }>;

interface FlightReviewMapPanelProps {
  path: FlightReviewPathVertex[];
  sessionHome: { lat: number; lon: number } | null;
  currentPosition: { lat: number; lon: number } | null;
}

export function FlightReviewMapPanel({ path, sessionHome, currentPosition }: FlightReviewMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [colorMode, setColorMode] = useState<PathColoringMode>("logGap");

  const range = useMemo(() => pathColorRange(path, colorMode), [path, colorMode]);

  const segments = useMemo(
    () => buildColoredSegments(path, colorMode, range),
    [path, colorMode, range]
  );

  const fitBounds = useMemo(() => {
    const coords = path
      .map((v) => [v.lon, v.lat] as [number, number])
      .filter((c) => isValidLngLat(c[0], c[1]));
    return coords;
  }, [path]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;
    let map: MapInstance | null = null;

    const setup = async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(loadMapBasemapId()),
        center: [8, 47],
        zoom: 5,
        attributionControl: { compact: true }
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;
        addSources(map);
        setMapReady(true);
      });
    };

    setup().catch((error: unknown) => console.error("Flight review map init failed", error));

    return () => {
      disposed = true;
      setMapReady(false);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("review-path") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(segments);
  }, [mapReady, segments]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const homeSource = map.getSource("review-home") as import("maplibre-gl").GeoJSONSource | undefined;
    if (sessionHome && isValidLngLat(sessionHome.lon, sessionHome.lat)) {
      homeSource?.setData(pointFeature(sessionHome.lon, sessionHome.lat));
    } else {
      homeSource?.setData(emptyCollection());
    }
  }, [mapReady, sessionHome]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const droneSource = map.getSource("review-drone") as import("maplibre-gl").GeoJSONSource | undefined;
    if (currentPosition && isValidLngLat(currentPosition.lon, currentPosition.lat)) {
      droneSource?.setData(pointFeature(currentPosition.lon, currentPosition.lat));
    } else {
      droneSource?.setData(emptyCollection());
    }
  }, [mapReady, currentPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || fitBounds.length < 2) return;

    const lngs = fitBounds.map((c) => c[0]);
    const lats = fitBounds.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      ],
      { padding: 48, maxZoom: 16, duration: 0 }
    );
  }, [mapReady, fitBounds]);

  return (
    <Panel
      title="Flight path"
      className="flex min-h-0 flex-1 flex-col"
      action={
        <select
          className="h-7 rounded border border-cyan-300/20 bg-slate-900 px-2 text-[10px] uppercase tracking-wider text-slate-200"
          value={colorMode}
          onChange={(event) => setColorMode(event.target.value as PathColoringMode)}
        >
          {PATH_COLOR_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      }
    >
      <div ref={containerRef} className="min-h-[16rem] flex-1 rounded-lg bg-slate-950" />
    </Panel>
  );
}

function buildColoredSegments(
  path: FlightReviewPathVertex[],
  mode: PathColoringMode,
  range: { min: number; max: number }
): SegmentCollection {
  const features: SegmentCollection["features"] = [];

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1]!;
    const curr = path[i]!;
    if (!isValidLngLat(prev.lon, prev.lat) || !isValidLngLat(curr.lon, curr.lat)) continue;

    const normalized = normalizePathMetric(curr, mode, range);
    features.push({
      type: "Feature",
      properties: { color: pathColorHex(normalized, mode) },
      geometry: {
        type: "LineString",
        coordinates: [
          [prev.lon, prev.lat],
          [curr.lon, curr.lat]
        ]
      }
    });
  }

  return { type: "FeatureCollection", features };
}

function addSources(map: MapInstance): void {
  if (!map.getSource("review-path")) {
    map.addSource("review-path", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "review-path-line",
      type: "line",
      source: "review-path",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 4,
        "line-opacity": 0.95
      }
    });
  }

  if (!map.getSource("review-home")) {
    map.addSource("review-home", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "review-home-point",
      type: "circle",
      source: "review-home",
      paint: {
        "circle-radius": 7,
        "circle-color": "#fbbf24",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0f172a"
      }
    });
  }

  if (!map.getSource("review-drone")) {
    map.addSource("review-drone", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "review-drone-point",
      type: "circle",
      source: "review-drone",
      paint: {
        "circle-radius": 9,
        "circle-color": "#22d3ee",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0f172a"
      }
    });
  }
}

function pointFeature(lon: number, lat: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [lon, lat] }
      }
    ]
  };
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
