/** Match `getAlerts` — HUD/map treat telemetry older than this as stale (ms). */
export const TELEMETRY_STALE_MS = 3000;

export function isTelemetryStale(
  lastPacketAt: number | null | undefined,
  now: number = Date.now(),
  thresholdMs: number = TELEMETRY_STALE_MS
): boolean {
  if (lastPacketAt == null || !Number.isFinite(lastPacketAt)) {
    return true;
  }
  return now - lastPacketAt > thresholdMs;
}
