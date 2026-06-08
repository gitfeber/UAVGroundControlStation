import type { CameraConfig, GimbalAttitudeSource, TelemetryState } from "@uav-ground-control-station/shared";
import { degToRad } from "./geo.js";

export interface ResolvedGimbalAttitude {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  source: GimbalAttitudeSource;
}

export function resolveGimbalAttitude(
  telemetry: TelemetryState,
  camera: CameraConfig
): ResolvedGimbalAttitude | null {
  const resolved = telemetry.gimbal
    ? {
        rollDeg: telemetry.gimbal.rollDeg,
        pitchDeg: telemetry.gimbal.pitchDeg,
        yawDeg: telemetry.gimbal.yawDeg,
        source: telemetry.gimbal.source
      }
    : camera.allowBodyFixedWhenGimbalMissing &&
        telemetry.motion.rollDeg !== null &&
        telemetry.motion.pitchDeg !== null &&
        telemetry.motion.yawDeg !== null
      ? {
          rollDeg: telemetry.motion.rollDeg,
          pitchDeg: telemetry.motion.pitchDeg,
          yawDeg: telemetry.motion.yawDeg,
          source: "bodyFixed" as const
        }
      : null;

  if (!resolved) return null;

  const pitchSign = camera.pitchSign === "inverted" ? -1 : 1;
  let yawDeg = resolved.yawDeg + camera.calibrationDeg.yaw;
  const yawInEarthFrame = telemetry.gimbal?.yawInEarthFrame;
  const needsVehicleYaw =
    yawInEarthFrame === false ||
    (yawInEarthFrame == null && camera.yawReference === "vehicle");
  if (needsVehicleYaw) {
    const vehicleYaw = telemetry.motion.yawDeg ?? telemetry.position.headingDeg ?? 0;
    yawDeg += vehicleYaw;
  }

  if (camera.gimbalFrame === "body") {
    const bodyRoll = telemetry.motion.rollDeg ?? 0;
    const bodyPitch = telemetry.motion.pitchDeg ?? 0;
    const bodyYaw = telemetry.motion.yawDeg ?? telemetry.position.headingDeg ?? 0;
    return {
      source: resolved.source,
      rollDeg: bodyRoll + resolved.rollDeg + camera.calibrationDeg.roll,
      pitchDeg: bodyPitch + resolved.pitchDeg * pitchSign + camera.calibrationDeg.pitch,
      yawDeg: bodyYaw + yawDeg
    };
  }

  return {
    source: resolved.source,
    rollDeg: resolved.rollDeg + camera.calibrationDeg.roll,
    pitchDeg: resolved.pitchDeg * pitchSign + camera.calibrationDeg.pitch,
    yawDeg
  };
}

/**
 * Earth-frame yaw/pitch/roll to a unit optical-axis vector in ENU.
 * Pitch follows aviation convention: positive pitch raises the boresight.
 */
export function opticalAxisEnu(rollDeg: number, pitchDeg: number, yawDeg: number): [number, number, number] {
  void rollDeg;
  const pitchRad = degToRad(pitchDeg);
  const yawRad = degToRad(yawDeg);
  const cosPitch = Math.cos(pitchRad);
  return [Math.sin(yawRad) * cosPitch, Math.cos(yawRad) * cosPitch, Math.sin(pitchRad)];
}

/** Positive when the boresight is below the local horizontal plane. */
export function depressionAngleDeg(directionEnu: [number, number, number]): number {
  const [east, north, up] = directionEnu;
  const horizontal = Math.hypot(east, north);
  return (Math.atan2(-up, horizontal) * 180) / Math.PI;
}
