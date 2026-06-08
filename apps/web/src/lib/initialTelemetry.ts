import type { TelemetryState } from "@uav-ground-control-station/shared";

export function createEmptyTelemetryState(): TelemetryState {
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

export function normalizeTelemetryState(input: TelemetryState | null | undefined): TelemetryState {
  const fallback = createEmptyTelemetryState();
  const candidate = input ?? fallback;
  const position =
    candidate.position && typeof candidate.position === "object"
      ? { ...fallback.position, ...candidate.position }
      : fallback.position;

  return {
    ...fallback,
    ...candidate,
    vehicle: { ...fallback.vehicle, ...candidate.vehicle },
    position,
    gps: { ...fallback.gps, ...candidate.gps },
    motion: { ...fallback.motion, ...candidate.motion },
    battery: { ...fallback.battery, ...candidate.battery },
    radio: { ...fallback.radio, ...candidate.radio },
    system: {
      ...fallback.system,
      ...candidate.system,
      statusText: Array.isArray(candidate.system?.statusText) ? candidate.system.statusText : []
    },
    stats: { ...fallback.stats, ...candidate.stats },
    gimbal: candidate.gimbal ?? null
  };
}
