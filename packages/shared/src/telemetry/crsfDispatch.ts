import type { TelemetryStore } from "./telemetryStore.js";
import { applyCrsfPassthroughPayload, isArduPilotCustomTelemFrame } from "./crsfPassthrough.js";

export interface CrsfFrame {
  frameType: number;
  payload: Uint8Array;
}

/** CRSF stat IDs are offset above MAVLink IDs in the activity log (matches desktop). */
export const CRSF_STAT_BASE = 0x4000;

export function crsfMessageId(frameType: number): number {
  return CRSF_STAT_BASE | frameType;
}

export function crsfMessageLabel(frameType: number): string {
  switch (frameType) {
    case 0x02:
      return "CRSF GPS";
    case 0x07:
      return "CRSF Vario";
    case 0x08:
      return "CRSF Battery";
    case 0x09:
      return "CRSF Baro Alt";
    case 0x0b:
      return "CRSF Heartbeat";
    case 0x14:
      return "CRSF Link RX";
    case 0x1d:
      return "CRSF Link TX";
    case 0x1e:
      return "CRSF Attitude";
    case 0x1f:
      return "CRSF MAVLink FC";
    case 0x21:
      return "CRSF Flight Mode";
    case 0x3a:
      return "CRSF Handset";
    case 0x7f:
      return "CRSF ArduPilot Telem (legacy)";
    case 0x7a:
      return "CRSF MSP Req";
    case 0x80:
      return "CRSF ArduPilot Telem";
    default:
      return `CRSF 0x${frameType.toString(16).padStart(2, "0").toUpperCase()}`;
  }
}

export function applyCrsfFrame(store: TelemetryStore, frame: CrsfFrame): void {
  store.markCrsfPacket();

  const payload = frame.payload;
  // Passthrough: ArduPilot telem (0x7F/0x80) and sometimes byte-0 wrapped in handset (0x3A).
  // Only decode at payload offset 0 — never scan the full handset stream.
  if (isArduPilotCustomTelemFrame(frame.frameType) || frame.frameType === 0x3a) {
    applyCrsfPassthroughPayload(store, payload);
  }

  switch (frame.frameType) {
    case 0x02:
      store.updateCrsfGps(payload);
      break;
    case 0x07:
      store.updateCrsfVario(payload);
      break;
    case 0x08:
      store.updateCrsfBattery(payload);
      break;
    case 0x09:
      store.updateCrsfBaroAltitude(payload);
      break;
    case 0x14:
      store.updateCrsfLinkRx(payload);
      break;
    case 0x1e:
      store.updateCrsfAttitude(payload);
      break;
    case 0x1f:
      store.updateCrsfMavlinkFc(payload);
      break;
    case 0x21:
      store.updateCrsfFlightMode(payload);
      break;
    default:
      break;
  }
}
