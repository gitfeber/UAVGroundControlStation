import type { TelemetryState } from "@uav-ground-control-station/shared";

export function createEmptyTelemetryState(): TelemetryState {
  return {
    connected: false,
    lastPacketAt: null,
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
    }
  };
}
