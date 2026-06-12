import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { TelemetryState, TargetEstimate } from "@uav-ground-control-station/shared";
import type { Coordinate } from "../lib/geo";
import { isValidLngLat, toMapLngLat } from "../lib/geo";
import {
  buildMapStyle,
  isMapBasemapSwitcherEnabled,
  loadMapBasemapId,
  saveMapBasemapId,
  type MapBasemapId
} from "../lib/mapBasemaps";
import { resolveHeadingDeg } from "../lib/resolveHeadingDeg";
import type { TrackPoint } from "../replay/reconstruct";
import { HudOverlay } from "./HudOverlay";
import { MapBasemapSwitcher } from "./MapBasemapSwitcher";

interface MapPanelProps {
  telemetry: TelemetryState;
  coordinate: Coordinate | null;
  home: Coordinate | null;
  groundTarget?: TargetEstimate | null;
  telemetryStale?: boolean;
  /**
   * Replay/simulation controlled track. When `trackMode` is "controlled" the
   * map renders exactly this array and never appends internally (ADR 0003 §5).
   */
  controlledTrack?: TrackPoint[];
  trackMode?: "internal" | "controlled";
}

type TrackFeature = Feature<LineString, Record<string, never>>;
type PointCollection = FeatureCollection<Point, Record<string, never>>;
type MapInstance = import("maplibre-gl").Map;

const fallbackCenter: [number, number] = [10.4515, 51.1657];

export function MapPanel({ telemetry, coordinate, home, groundTarget, telemetryStale = false, controlledTrack, trackMode = "internal" }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const centeredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [track, setTrack] = useState<[number, number][]>([]);
  const [basemapId, setBasemapId] = useState<MapBasemapId>(() => loadMapBasemapId());
  const basemapSwitcherEnabled = isMapBasemapSwitcherEnabled();

  const isControlled = trackMode === "controlled";
  const droneLngLat = useMemo(() => toMapLngLat(coordinate), [coordinate]);
  const homeLngLat = useMemo(() => toMapLngLat(home), [home]);

  // In controlled mode the replay/sim controller owns the track; render exactly
  // what it provides. In internal mode the live append-on-change track is used.
  const displayTrack = useMemo<[number, number][]>(() => {
    if (!isControlled) return track;
    return (controlledTrack ?? [])
      .map((point) => [point.lon, point.lat] as [number, number])
      .filter((point) => isValidLngLat(point[0], point[1]));
  }, [isControlled, controlledTrack, track]);

  const heading = resolveHeadingDeg(telemetry) ?? 0;

  const handleBasemapChange = useCallback((nextBasemapId: MapBasemapId) => {
    setBasemapId(nextBasemapId);
    saveMapBasemapId(nextBasemapId);

    const map = mapRef.current;
    if (!map || !mapReady) return;

    map.setStyle(buildMapStyle(nextBasemapId));
    map.once("style.load", () => {
      addMapOverlays(map);
      setStyleEpoch((epoch) => epoch + 1);
    });
  }, [mapReady]);

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
        center: fallbackCenter,
        zoom: 5,
        attributionControl: { compact: true }
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;
        addMapOverlays(map);
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
      centeredRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isControlled || !droneLngLat) return;

    setTrack((current) => {
      const last = current[current.length - 1];
      if (last && Math.abs(last[0] - droneLngLat[0]) < 0.000001 && Math.abs(last[1] - droneLngLat[1]) < 0.000001) {
        return current;
      }

      return [...current, droneLngLat].slice(-5000);
    });
  }, [droneLngLat, isControlled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("track") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(trackFeature(sanitizeTrack(displayTrack)));
  }, [mapReady, styleEpoch, displayTrack]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !droneLngLat) return;

    const source = map.getSource("drone") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(pointCollection(droneLngLat));

    if (!centeredRef.current) {
      centeredRef.current = true;
      map.jumpTo({ center: droneLngLat, zoom: 15 });
    }
  }, [droneLngLat, heading, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !homeLngLat) return;

    const source = map.getSource("home") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(pointCollection(homeLngLat));
  }, [homeLngLat, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const showTarget =
      groundTarget &&
      (groundTarget.valid || groundTarget.quality === "warn") &&
      groundTarget.lat !== null &&
      groundTarget.lon !== null;

    const targetSource = map.getSource("ground-target") as import("maplibre-gl").GeoJSONSource | undefined;
    const losSource = map.getSource("ground-target-los") as import("maplibre-gl").GeoJSONSource | undefined;

    if (!showTarget || !droneLngLat) {
      targetSource?.setData(emptyPointCollection());
      losSource?.setData(emptyLineFeature());
      return;
    }

    const targetLngLat = toMapLngLat({ lat: groundTarget.lat!, lon: groundTarget.lon! });
    if (!targetLngLat) {
      targetSource?.setData(emptyPointCollection());
      losSource?.setData(emptyLineFeature());
      return;
    }

    targetSource?.setData(pointCollection(targetLngLat));
    losSource?.setData(lineFeature(droneLngLat, targetLngLat));
  }, [groundTarget, droneLngLat, mapReady, styleEpoch]);

  return (
    <main className="relative min-w-0 flex-1">
      <div ref={containerRef} className="h-full w-full bg-slate-950" />

      {basemapSwitcherEnabled && <MapBasemapSwitcher value={basemapId} onChange={handleBasemapChange} />}

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        <HudOverlay telemetry={telemetry} stale={telemetryStale} />
      </div>

      {!isControlled && (
        <button className="btn-secondary absolute bottom-4 left-4" onClick={() => setTrack([])}>
          Clear Track
        </button>
      )}
    </main>
  );
}

function addMapOverlays(map: MapInstance): void {
  if (!map.getSource("track")) {
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
  }

  if (!map.getSource("drone")) {
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
  }

  if (!map.getSource("home")) {
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
  }

  if (!map.getSource("ground-target-los")) {
    map.addSource("ground-target-los", { type: "geojson", data: emptyLineFeature() });
    map.addLayer({
      id: "ground-target-los-line",
      type: "line",
      source: "ground-target-los",
      paint: {
        "line-color": "#f97316",
        "line-width": 2,
        "line-opacity": 0.85,
        "line-dasharray": [2, 2]
      }
    });
  }

  if (!map.getSource("ground-target")) {
    map.addSource("ground-target", { type: "geojson", data: emptyPointCollection() });
    map.addLayer({
      id: "ground-target-point",
      type: "circle",
      source: "ground-target",
      paint: {
        "circle-radius": 8,
        "circle-color": "#f97316",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0f172a"
      }
    });
  }
}

function sanitizeTrack(track: [number, number][]): [number, number][] {
  return track.filter((point) => isValidLngLat(point[0], point[1]));
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

type LineFeature = Feature<LineString, Record<string, never>>;

function emptyLineFeature(): LineFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: []
    }
  };
}

function lineFeature(from: [number, number], to: [number, number]): LineFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [from, to]
    }
  };
}
