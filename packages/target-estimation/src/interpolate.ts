import type { GimbalState, TelemetryState } from "@uav-ground-control-station/shared";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpNullable(before: number | null, after: number | null, t: number): number | null {
  if (before === null && after === null) return null;
  if (before === null) return after;
  if (after === null) return before;
  return lerp(before, after, t);
}

/** Shortest-path linear interpolation for compass angles in degrees. */
export function lerpAngleDeg(before: number, after: number, t: number): number {
  const delta = ((((after - before) % 360) + 540) % 360) - 180;
  return ((before + delta * t) % 360 + 360) % 360;
}

function lerpAngleNullable(before: number | null, after: number | null, t: number): number | null {
  if (before === null && after === null) return null;
  if (before === null) return after;
  if (after === null) return before;
  return lerpAngleDeg(before, after, t);
}

function interpolateGimbal(
  before: GimbalState | null,
  after: GimbalState | null,
  t: number,
  sampledAtMs: number
): GimbalState | null {
  if (before === null && after === null) return null;
  if (before === null) return after;
  if (after === null) return before;
  if (before.source !== after.source) {
    return t < 0.5 ? before : after;
  }

  return {
    source: before.source,
    sampledAtMs,
    rollDeg: lerp(before.rollDeg, after.rollDeg, t),
    pitchDeg: lerp(before.pitchDeg, after.pitchDeg, t),
    yawDeg: lerpAngleDeg(before.yawDeg, after.yawDeg, t)
  };
}

/**
 * Linearly interpolate pose fields needed for target estimation between two
 * telemetry snapshots. Discrete/session fields come from the newer sample.
 */
export function interpolateTelemetryState(
  before: TelemetryState,
  after: TelemetryState,
  t: number
): TelemetryState {
  const sampledAtMs = Math.round(lerp(before.sampledAtMs ?? after.sampledAtMs ?? 0, after.sampledAtMs ?? before.sampledAtMs ?? 0, t));

  return {
    ...after,
    sampledAtMs,
    lastPacketAt: after.lastPacketAt,
    position: {
      ...after.position,
      lat: lerpNullable(before.position.lat, after.position.lat, t),
      lon: lerpNullable(before.position.lon, after.position.lon, t),
      altMsl: lerpNullable(before.position.altMsl, after.position.altMsl, t),
      relativeAlt: lerpNullable(before.position.relativeAlt, after.position.relativeAlt, t),
      headingDeg: lerpAngleNullable(before.position.headingDeg, after.position.headingDeg, t),
      groundCourseDeg: lerpAngleNullable(before.position.groundCourseDeg, after.position.groundCourseDeg, t)
    },
    motion: {
      ...after.motion,
      groundSpeed: lerpNullable(before.motion.groundSpeed, after.motion.groundSpeed, t),
      airSpeed: lerpNullable(before.motion.airSpeed, after.motion.airSpeed, t),
      climbRate: lerpNullable(before.motion.climbRate, after.motion.climbRate, t),
      rollDeg: lerpNullable(before.motion.rollDeg, after.motion.rollDeg, t),
      pitchDeg: lerpNullable(before.motion.pitchDeg, after.motion.pitchDeg, t),
      yawDeg: lerpAngleNullable(before.motion.yawDeg, after.motion.yawDeg, t)
    },
    gimbal: interpolateGimbal(before.gimbal, after.gimbal, t, sampledAtMs)
  };
}
