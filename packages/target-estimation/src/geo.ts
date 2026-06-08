const WGS84_A = 6_378_137;
const WGS84_E2 = 0.006_694_379_990_14;

export function metersPerDegreeLat(latDeg: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  const sinLat = Math.sin(latRad);
  const denom = Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const m1 = (WGS84_A * (1 - WGS84_E2)) / (denom * denom * denom);
  const m2 = WGS84_A / denom;
  return Math.sqrt(m1 * m2);
}

export function metersPerDegreeLon(latDeg: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  return metersPerDegreeLat(latDeg) * Math.cos(latRad);
}

/** Convert an ENU offset in meters to a WGS84 delta from an anchor point. */
export function enuDeltaToGeodetic(
  anchorLat: number,
  anchorLon: number,
  eastM: number,
  northM: number
): { lat: number; lon: number } {
  return {
    lat: anchorLat + northM / metersPerDegreeLat(anchorLat),
    lon: anchorLon + eastM / metersPerDegreeLon(anchorLat)
  };
}

export function normalizeVector(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length === 0) return [0, 0, 0];
  return [x / length, y / length, z / length];
}

export function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}
