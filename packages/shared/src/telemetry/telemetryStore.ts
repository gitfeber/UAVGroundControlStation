import type { TelemetryState } from "../index.js";
import { flightModeLabel, mavTypeLabel } from "./flightModes.js";
import { haversineDistanceM, type Coordinate } from "./geo.js";

const statusRingLimit = 20;

export function createInitialTelemetryState(): TelemetryState {
  return {
    connected: false,
    lastPacketAt: null,
    sampledAtMs: null,
    packetCount: 0,
    vehicle: {
      systemId: null,
      componentId: null,
      type: "Unknown",
      armed: false,
      flightMode: "Unknown"
    },
    position: {
      lat: null,
      lon: null,
      altMsl: null,
      relativeAlt: null,
      headingDeg: null,
      groundCourseDeg: null
    },
    gps: {
      fixType: null,
      fixLabel: "No GPS",
      satellites: null,
      eph: null,
      epv: null
    },
    motion: {
      groundSpeed: null,
      airSpeed: null,
      climbRate: null,
      rollDeg: null,
      pitchDeg: null,
      yawDeg: null
    },
    battery: {
      voltage: null,
      current: null,
      remainingPercent: null,
      consumedMah: null,
      cellVoltageEstimate: null
    },
    radio: {
      rssi: null,
      remRssi: null,
      rxErrors: null,
      fixed: null,
      txBuffer: null,
      linkQuality: null
    },
    system: {
      loadPercent: null,
      statusText: []
    },
    stats: {
      minVoltage: null,
      maxAltitude: null,
      maxSpeed: null,
      maxDistance: null,
      maxCurrent: null,
      minRssi: null,
      warningCount: 0,
      sessionStartedAt: Date.now()
    },
    gimbal: null
  };
}

export class TelemetryStore {
  private state = createInitialTelemetryState();
  private home: Coordinate | null = null;

  getState(): TelemetryState {
    return structuredClone(this.state);
  }

  reset(): TelemetryState {
    this.state = createInitialTelemetryState();
    this.home = null;
    return this.getState();
  }

  setConnected(connected: boolean): void {
    this.state.connected = connected;
  }

  markPacket(systemId: number, componentId: number): void {
    this.state.connected = true;
    this.state.lastPacketAt = Date.now();
    this.state.packetCount += 1;
    this.state.vehicle.systemId = systemId;
    this.state.vehicle.componentId = componentId;
  }

  updateHeartbeat(payload: DataView): void {
    if (payload.byteLength < 9) return;

    const customMode = payload.getUint32(0, true);
    const vehicleType = payload.getUint8(4);
    const baseMode = payload.getUint8(6);

    this.state.vehicle.type = mavTypeLabel(vehicleType);
    this.state.vehicle.armed = (baseMode & 0x80) !== 0;
    this.state.vehicle.baseMode = baseMode;
    this.state.vehicle.customMode = customMode;
    this.state.vehicle.flightMode = flightModeLabel(vehicleType, customMode);
  }

  updateSysStatus(payload: DataView): void {
    if (payload.byteLength < 31) return;

    const voltage = nullablePositive(payload.getUint16(14, true), 0) / 1000;
    const currentRaw = payload.getInt16(16, true);
    const batteryRemaining = payload.getInt8(30);
    const loadRaw = payload.getUint16(12, true);

    this.state.system.sensorsPresent = payload.getUint32(0, true);
    this.state.system.sensorsEnabled = payload.getUint32(4, true);
    this.state.system.sensorsHealth = payload.getUint32(8, true);
    this.state.system.loadPercent = loadRaw / 10;
    if (Number.isFinite(voltage) && voltage > 0) {
      this.setVoltage(voltage);
    }
    if (currentRaw !== -1) {
      this.setCurrent(currentRaw / 100);
    }
    if (batteryRemaining >= 0) {
      this.state.battery.remainingPercent = batteryRemaining;
    }
  }

  updateBatteryStatus(payload: DataView): void {
    if (payload.byteLength < 36) return;

    const voltages: number[] = [];
    for (let offset = 10; offset < 30; offset += 2) {
      const mv = payload.getUint16(offset, true);
      if (mv > 0 && mv !== 65535) {
        voltages.push(mv / 1000);
      }
    }

    const totalVoltage = voltages.length > 0 ? voltages.reduce((sum, value) => sum + value, 0) : null;
    const currentRaw = payload.getInt16(30, true);
    const consumed = payload.getInt32(0, true);
    const remaining = payload.getInt8(35);

    if (totalVoltage !== null) {
      this.setVoltage(totalVoltage);
    }
    if (currentRaw !== -1) {
      this.setCurrent(currentRaw / 100);
    }
    if (consumed >= 0) {
      this.state.battery.consumedMah = consumed;
    }
    if (remaining >= 0) {
      this.state.battery.remainingPercent = remaining;
    }
  }

  updateGpsRawInt(payload: DataView): void {
    if (payload.byteLength < 30) return;

    const fixType = payload.getUint8(28);
    const lat = scaledCoordinate(payload.getInt32(8, true));
    const lon = scaledCoordinate(payload.getInt32(12, true));
    const alt = payload.getInt32(16, true) / 1000;
    const eph = payload.getUint16(20, true);
    const epv = payload.getUint16(22, true);
    const velocity = payload.getUint16(24, true);
    const cog = payload.getUint16(26, true);

    this.state.gps.fixType = fixType;
    this.state.gps.fixLabel = gpsFixLabel(fixType);
    this.state.gps.eph = eph === 65535 ? null : eph / 100;
    this.state.gps.epv = epv === 65535 ? null : epv / 100;
    this.state.gps.satellites = payload.getUint8(29) === 255 ? null : payload.getUint8(29);

    if (lat !== null && lon !== null) {
      this.updatePosition(lat, lon);
    }

    this.state.position.altMsl = alt;
    this.state.motion.groundSpeed = velocity === 65535 ? this.state.motion.groundSpeed : velocity / 100;
    this.state.position.groundCourseDeg = cog === 65535 ? null : cog / 100;
    this.updateStats();
  }

  updateGlobalPositionInt(payload: DataView): void {
    if (payload.byteLength < 28) return;

    const lat = scaledCoordinate(payload.getInt32(4, true));
    const lon = scaledCoordinate(payload.getInt32(8, true));
    const alt = payload.getInt32(12, true) / 1000;
    const relativeAlt = payload.getInt32(16, true) / 1000;
    const heading = payload.getUint16(26, true);

    if (lat !== null && lon !== null) {
      this.updatePosition(lat, lon);
    }

    this.state.position.altMsl = alt;
    this.state.position.relativeAlt = relativeAlt;
    this.state.position.headingDeg = heading === 65535 ? null : heading / 100;
    this.updateStats();
  }

  updateVfrHud(payload: DataView): void {
    if (payload.byteLength < 20) return;

    this.state.motion.airSpeed = payload.getFloat32(0, true);
    this.state.motion.groundSpeed = payload.getFloat32(4, true);
    this.state.position.altMsl = payload.getFloat32(8, true);
    this.state.motion.climbRate = payload.getFloat32(12, true);
    this.state.position.headingDeg = normalizeHeading(payload.getInt16(16, true));
    this.updateStats();
  }

  updateAttitude(payload: DataView): void {
    if (payload.byteLength < 16) return;

    this.state.motion.rollDeg = radiansToDegrees(payload.getFloat32(4, true));
    this.state.motion.pitchDeg = radiansToDegrees(payload.getFloat32(8, true));
    this.state.motion.yawDeg = normalizeHeading(radiansToDegrees(payload.getFloat32(12, true)));
  }

  updateRadioStatus(payload: DataView): void {
    if (payload.byteLength < 9) return;

    this.state.radio.rxErrors = payload.getUint16(0, true);
    this.state.radio.fixed = payload.getUint16(2, true);
    this.state.radio.rssi = payload.getUint8(4);
    this.state.radio.remRssi = payload.getUint8(5);
    this.state.radio.txBuffer = payload.getUint8(6);
    this.state.radio.linkQuality = this.state.radio.rssi;
    this.updateStats();
  }

  updateRcChannels(payload: DataView): void {
    if (payload.byteLength < 42) return;

    const rssi = payload.getUint8(41);
    this.state.radio.rssi = rssi === 255 ? null : rssi;
    this.state.radio.linkQuality = this.state.radio.rssi;
    this.updateStats();
  }

  updateStatusText(payload: DataView): void {
    if (payload.byteLength < 2) return;

    const severity = payload.getUint8(0);
    const textBytes = new Uint8Array(payload.buffer, payload.byteOffset + 1, Math.min(50, payload.byteLength - 1));
    const text = new TextDecoder().decode(textBytes).replace(/\0+$/g, "").trim();
    if (!text) return;

    const label = severityLabel(severity);
    this.state.system.statusText = [`${label}: ${text}`, ...this.state.system.statusText].slice(0, statusRingLimit);
    if (severity <= 4) {
      this.state.stats.warningCount += 1;
    }
  }

  updateNavControllerOutput(payload: DataView): void {
    if (payload.byteLength < 26) return;

    const wpDistance = payload.getUint16(12, true);
    const altError = payload.getFloat32(14, true);
    const navBearing = payload.getInt16(8, true);
    const message = `NAV: wp ${wpDistance}m, alt error ${altError.toFixed(1)}m, bearing ${navBearing}deg`;

    if (this.state.system.statusText[0] !== message) {
      this.state.system.statusText = [message, ...this.state.system.statusText].slice(0, statusRingLimit);
    }
  }

  markCrsfPacket(): void {
    this.markPacket(255, 191);
    this.state.vehicle.type = "TX16S CRSF";
  }

  updateCrsfGps(payload: Uint8Array): void {
    if (payload.byteLength < 15) return;

    const lat = scaledCrsfCoordinate(readI32Be(payload, 0));
    const lon = scaledCrsfCoordinate(readI32Be(payload, 4));
    const speedKmh = readU16Be(payload, 8);
    const heading = readU16Be(payload, 10);
    const altM = readU16Be(payload, 12);
    const satellites = payload[14];
    const sats = satellites === undefined || satellites === 255 ? null : satellites;
    const hasPositionFix = sats !== null && sats >= 3;

    if (sats !== null) {
      this.state.gps.satellites = sats;
      this.state.gps.fixType = sats >= 6 ? 3 : sats >= 3 ? 2 : sats > 0 ? 1 : 0;
      this.state.gps.fixLabel =
        sats >= 6 ? "3D Fix" : sats >= 3 ? "2D Fix" : sats > 0 ? "No Fix" : "No GPS";
    }

    // ArduPilot still emits CRSF GPS frames without a GNSS module; ignore lat/lon until sats >= 3.
    if (hasPositionFix && lat !== null && lon !== null) {
      this.updatePosition(lat, lon);
      if (heading !== null && heading !== 65535) {
        const headingDeg = heading / 100;
        this.state.position.headingDeg = headingDeg;
        this.state.position.groundCourseDeg = headingDeg;
        this.state.motion.yawDeg = headingDeg;
      }
      if (altM !== null && altM !== 65535) {
        const altitude = altM - 1000;
        this.state.position.relativeAlt = altitude;
        this.state.position.altMsl = altitude;
      }
      if (speedKmh !== null && speedKmh !== 65535) {
        this.state.motion.groundSpeed = speedKmh / 10 / 3.6;
      }
      this.updateStats();
    }
  }

  updateCrsfVario(payload: Uint8Array): void {
    if (payload.byteLength < 2) return;
    const cmPerS = readI16Be(payload, 0);
    if (cmPerS !== null) {
      this.state.motion.climbRate = cmPerS / 100;
    }
  }

  updateCrsfBattery(payload: Uint8Array): void {
    if (payload.byteLength < 8) return;

    const voltageRaw = readU16Be(payload, 0);
    const currentRaw = readU16Be(payload, 2);
    const consumed = normalizeCrsfConsumedMah(readU24Be(payload, 4));
    const remaining = normalizeCrsfBatteryRemaining(payload[7]);

    if (isValidCrsfBatteryU16(voltageRaw)) {
      this.setVoltage(voltageRaw / 10);
    }
    if (isValidCrsfBatteryU16(currentRaw)) {
      this.setCurrent(currentRaw / 10);
    }
    if (consumed !== null) {
      this.state.battery.consumedMah = consumed;
    }
    if (remaining !== null) {
      this.state.battery.remainingPercent = remaining;
    }
  }

  updateCrsfBaroAltitude(payload: Uint8Array): void {
    if (payload.byteLength < 3) return;
    const altitudeDm = readI16Be(payload, 0);
    if (altitudeDm !== null) {
      this.state.position.relativeAlt = altitudeDm / 10;
    }
  }

  updateCrsfLinkRx(payload: Uint8Array): void {
    if (payload.byteLength < 10) return;
    this.state.radio.rssi = payload[0]!;
    this.state.radio.linkQuality = payload[2]!;
    this.state.radio.fixed = payload[4]!;
    this.state.radio.remRssi = payload[7]!;
    this.updateStats();
  }

  updateCrsfAttitude(payload: Uint8Array): void {
    if (payload.byteLength < 2) return;
    const pitch = attitudeAxisDeg(payload, 0);
    const roll = payload.byteLength >= 4 ? attitudeAxisDeg(payload, 2) : null;
    const yaw = payload.byteLength >= 6 ? attitudeAxisDeg(payload, 4) : null;
    if (pitch !== null) this.state.motion.pitchDeg = pitch;
    if (roll !== null) this.state.motion.rollDeg = roll;
    if (yaw !== null) this.state.motion.yawDeg = yaw;
  }

  updateCrsfMavlinkFc(payload: Uint8Array): void {
    if (payload.byteLength < 9) return;
    const customMode = readU32Be(payload, 3) ?? 0;
    const firmwareType = payload[8] ?? 1;
    this.state.vehicle.flightMode = flightModeLabel(firmwareType, customMode);
    this.state.vehicle.type = mavTypeLabel(firmwareType);
  }

  updateCrsfFlightMode(payload: Uint8Array): void {
    const text = cleanAscii(payload);
    if (isPlausibleFlightMode(text)) {
      this.state.vehicle.flightMode = text;
    }
  }

  applyPassthroughVoltage(voltage: number): void {
    this.setVoltage(voltage);
  }

  applyPassthroughCurrent(current: number): void {
    this.setCurrent(current);
  }

  applyPassthroughConsumedMah(consumedMah: number): void {
    this.state.battery.consumedMah = consumedMah;
  }

  private updatePosition(lat: number, lon: number): void {
    this.state.position.lat = lat;
    this.state.position.lon = lon;

    const current = { lat, lon };
    this.home ??= current;
    this.state.stats.maxDistance = maxNullable(
      this.state.stats.maxDistance,
      haversineDistanceM(this.home, current)
    );
  }

  private setVoltage(voltage: number): void {
    this.state.battery.voltage = voltage;
    this.state.battery.cellVoltageEstimate = estimateCellVoltage(voltage);
    this.state.stats.minVoltage = minNullable(this.state.stats.minVoltage, voltage);
  }

  private setCurrent(current: number): void {
    this.state.battery.current = current;
    this.state.stats.maxCurrent = maxNullable(this.state.stats.maxCurrent, current);
  }

  private updateStats(): void {
    this.state.stats.maxAltitude = maxNullable(
      this.state.stats.maxAltitude,
      this.state.position.relativeAlt ?? this.state.position.altMsl
    );
    this.state.stats.maxSpeed = maxNullable(this.state.stats.maxSpeed, this.state.motion.groundSpeed);
    this.state.stats.minRssi = minNullable(this.state.stats.minRssi, this.state.radio.rssi);
  }
}

function gpsFixLabel(fixType: number): string {
  const labels: Record<number, string> = {
    0: "No GPS",
    1: "No Fix",
    2: "2D Fix",
    3: "3D Fix",
    4: "DGPS",
    5: "RTK Float",
    6: "RTK Fixed"
  };
  return labels[fixType] ?? `Fix ${fixType}`;
}

function severityLabel(severity: number): string {
  const labels: Record<number, string> = {
    0: "EMERGENCY",
    1: "ALERT",
    2: "CRITICAL",
    3: "ERROR",
    4: "WARNING",
    5: "NOTICE",
    6: "INFO",
    7: "DEBUG"
  };
  return labels[severity] ?? `SEV_${severity}`;
}

function scaledCoordinate(raw: number): number | null {
  if (raw === 0 || raw === 2147483647) return null;
  return raw / 1e7;
}

const CRSF_BATTERY_UNKNOWN_U16 = 0x7fff;
const CRSF_BATTERY_CONSUMED_UNKNOWN = 0x7fff;

function isValidCrsfBatteryU16(raw: number | null): raw is number {
  return raw !== null && raw > 0 && raw !== CRSF_BATTERY_UNKNOWN_U16;
}

/** CRSF 0x08 remaining is int8 percent; -1 (0xFF) and values >100 mean unknown. */
function normalizeCrsfBatteryRemaining(raw: number | undefined): number | null {
  if (raw === undefined) return null;
  const signed = raw > 127 ? raw - 256 : raw;
  if (signed < 0 || signed > 100) return null;
  return signed;
}

function normalizeCrsfConsumedMah(raw: number | null): number | null {
  if (raw === null || raw < 0 || raw >= CRSF_BATTERY_CONSUMED_UNKNOWN) return null;
  return raw;
}

/** CRSF GPS lat/lon are signed i32 degrees * 1e7 (big-endian on the wire). */
function scaledCrsfCoordinate(raw: number | null): number | null {
  if (raw === null || raw === 0 || raw === 0x7fffffff || raw === -0x80000000) return null;
  const deg = raw / 10_000_000;
  return Number.isFinite(deg) ? deg : null;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function nullablePositive(value: number, nullValue: number): number {
  return value === nullValue ? Number.NaN : value;
}

function maxNullable(current: number | null, next: number | null): number | null {
  if (next === null || !Number.isFinite(next)) return current;
  return current === null ? next : Math.max(current, next);
}

function minNullable(current: number | null, next: number | null): number | null {
  if (next === null || !Number.isFinite(next)) return current;
  return current === null ? next : Math.min(current, next);
}

/** Infer per-cell voltage from pack voltage (~3.8 V nominal per LiPo cell). */
function estimateCellVoltage(packVoltage: number): number | null {
  if (!Number.isFinite(packVoltage) || packVoltage <= 0) return null;
  const cells = Math.min(14, Math.max(1, Math.round(packVoltage / 3.8)));
  return packVoltage / cells;
}

function readI16Be(data: Uint8Array, offset: number): number | null {
  if (offset + 2 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, 2);
  return view.getInt16(0, false);
}

function readI32Be(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return view.getInt32(0, false);
}

function readU16Be(data: Uint8Array, offset: number): number | null {
  if (offset + 2 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, 2);
  return view.getUint16(0, false);
}

function readU24Be(data: Uint8Array, offset: number): number | null {
  if (offset + 3 > data.byteLength) return null;
  return (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!;
}

function readU32Be(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return view.getUint32(0, false);
}

function attitudeAxisDeg(payload: Uint8Array, offset: number): number | null {
  const rawBe = readI16Be(payload, offset);
  if (rawBe !== null) {
    const degrees = radians10000ToDeg(rawBe);
    if (degrees !== null) return degrees;
  }
  if (offset + 2 > payload.byteLength) return null;
  const view = new DataView(payload.buffer, payload.byteOffset + offset, 2);
  return radians10000ToDeg(view.getInt16(0, true));
}

function radians10000ToDeg(raw: number): number | null {
  const radians = raw / 10_000;
  if (!Number.isFinite(radians)) return null;
  let degrees = (radians * 180) / Math.PI;
  if (!Number.isFinite(degrees)) return null;
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return degrees;
}

function cleanAscii(payload: Uint8Array): string {
  const bytes: number[] = [];
  for (let i = 0; i < payload.byteLength; i += 1) {
    const byte = payload[i]!;
    if (byte === 0) break;
    if (byte >= 32 && byte <= 126) bytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}

function isPlausibleFlightMode(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 16) return false;
  let letters = 0;
  for (const ch of trimmed) {
    if (/[A-Za-z]/.test(ch)) {
      letters += 1;
      continue;
    }
    if (/[0-9 _+-]/.test(ch)) continue;
    return false;
  }
  return letters >= 2;
}
