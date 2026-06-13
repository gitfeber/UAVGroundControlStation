import { isValidLngLat } from "./geo";

export const MAP_FOLLOW_KEY = "uav-gcs.map.follow";
export const MAP_HEADING_UP_KEY = "uav-gcs.map.headingUp";

export interface MapFollowPreferences {
  follow: boolean;
  headingUp: boolean;
  /** True when the operator has never saved a follow preference. */
  neverConfigured: boolean;
}

export function loadMapFollowPreferences(): MapFollowPreferences {
  const rawFollow = localStorage.getItem(MAP_FOLLOW_KEY);
  const rawHeading = localStorage.getItem(MAP_HEADING_UP_KEY);

  return {
    follow: rawFollow === "true",
    headingUp: rawHeading === "true",
    neverConfigured: rawFollow === null
  };
}

export function saveMapFollowPreferences(follow: boolean, headingUp: boolean): void {
  localStorage.setItem(MAP_FOLLOW_KEY, String(follow));
  localStorage.setItem(MAP_HEADING_UP_KEY, String(headingUp));
}

/** SW/NE corner pair for MapLibre `fitBounds`, or null when the track is empty. */
export function boundsForTrack(track: readonly [number, number][]): [[number, number], [number, number]] | null {
  if (track.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of track) {
    if (!isValidLngLat(lng, lat)) continue;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (!Number.isFinite(minLng)) return null;

  if (minLng === maxLng && minLat === maxLat) {
    const pad = 0.001;
    return [
      [minLng - pad, minLat - pad],
      [maxLng + pad, maxLat + pad]
    ];
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}
