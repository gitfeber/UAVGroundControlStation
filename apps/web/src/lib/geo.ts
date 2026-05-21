export interface Coordinate {
  lat: number;
  lon: number;
}

const earthRadiusM = 6371000;

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceM(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

export function isValidLngLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function validCoordinate(
  lat: number | null | undefined,
  lon: number | null | undefined
): Coordinate | null {
  if (lat == null || lon == null) return null;

  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!isValidLngLat(lonNum, latNum)) return null;
  return { lat: latNum, lon: lonNum };
}

export function toMapLngLat(coordinate: Coordinate | null): [number, number] | null {
  if (!coordinate) return null;

  const lon = Number(coordinate.lon);
  const lat = Number(coordinate.lat);
  if (!isValidLngLat(lon, lat)) return null;
  return [lon, lat];
}
