import type { TelemetryStore } from "./telemetryStore.js";

/** ArduPilot CRSF custom-telemetry sub-types (AP_CRSF_Protocol::CustomTelemSubTypeID). */
const SUBTYPE_SINGLE_PASSTHROUGH = 0xf0;
const SUBTYPE_MULTI_PASSTHROUGH = 0xf2;

/** FrSky passthrough app IDs used by ArduPilot (DIY_FIRST_ID = 0x5000). */
const APPID_BATT_1 = 0x5003;
const APPID_BATT_2 = 0x5008;

export function isArduPilotCustomTelemFrame(frameType: number): boolean {
  return frameType === 0x7f || frameType === 0x80;
}

/** Decode ArduPilot FrSky passthrough packets inside CRSF custom-telemetry frames (0x7F/0x80). */
export function applyCrsfPassthroughPayload(store: TelemetryStore, payload: Uint8Array): boolean {
  let applied = false;
  for (const packet of extractPassthroughPackets(payload)) {
    if (applyPassthroughPacket(store, packet.appid, packet.data)) {
      applied = true;
    }
  }
  return applied;
}

function extractPassthroughPackets(payload: Uint8Array): Array<{ appid: number; data: number }> {
  return extractPassthroughAt(payload, 0);
}

function extractPassthroughAt(payload: Uint8Array, offset: number): Array<{ appid: number; data: number }> {
  if (offset >= payload.byteLength) {
    return [];
  }

  const subType = payload[offset]!;
  if (subType === SUBTYPE_SINGLE_PASSTHROUGH && offset + 7 <= payload.byteLength) {
    return [{ appid: readU16Le(payload, offset + 1), data: readU32Le(payload, offset + 3) }];
  }

  if (subType === SUBTYPE_MULTI_PASSTHROUGH && offset + 2 <= payload.byteLength) {
    const count = payload[offset + 1]!;
    const packets: Array<{ appid: number; data: number }> = [];
    let pos = offset + 2;
    for (let i = 0; i < count && pos + 6 <= payload.byteLength; i += 1) {
      packets.push({ appid: readU16Le(payload, pos), data: readU32Le(payload, pos + 2) });
      pos += 6;
    }
    return packets;
  }

  return [];
}

function applyPassthroughPacket(store: TelemetryStore, appid: number, data: number): boolean {
  switch (appid) {
    case APPID_BATT_1:
    case APPID_BATT_2:
      return applyPassthroughBattery(store, data);
    default:
      return false;
  }
}

/** Reverse of AP_Frsky_SPort_Passthrough::calc_batt encoding. */
function applyPassthroughBattery(store: TelemetryStore, data: number): boolean {
  const voltageRaw = data & 0x1ff;
  const currentRaw = (data >> 9) & 0x7f;
  const consumedMah = (data >> 17) & 0x7fff;

  if (voltageRaw > 0) {
    store.applyPassthroughVoltage(voltageRaw / 10);
  }
  if (currentRaw > 0) {
    store.applyPassthroughCurrent(currentRaw / 10);
  }
  // 0x7FFF in the 15-bit consumed field means "unknown" in ArduPilot passthrough.
  if (consumedMah > 0 && consumedMah < 0x7fff) {
    store.applyPassthroughConsumedMah(consumedMah);
  }

  return voltageRaw > 0 || currentRaw > 0 || consumedMah > 0;
}

function readU16Le(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readU32Le(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}
