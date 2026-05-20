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

export function validCoordinate(lat: number | null, lon: number | null): Coordinate | null {
  if (lat === null || lon === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
