export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
  locationId?: string;
  friendlyName?: string;
  transport: "usb" | "windows-com" | "serial" | "unknown";
  displayName: string;
}

export interface BackendStatus {
  serialConnected: boolean;
  mavlinkPackets: number;
  lastPacketMs: number | null;
  rawBytes?: number;
  txBytes?: number;
  parserErrors?: number;
  lastSerialError?: string | null;
  mavlinkMessages?: MavlinkMessageStat[];
}

export interface MavlinkMessageStat {
  id: number;
  label: string;
  count: number;
  lastSeenAt: number;
}

export interface LoggingStatus {
  active: boolean;
  filePath: string | null;
}

export interface ConnectRequest {
  path: string;
  baudRate?: number;
}

export interface TelemetryState {
  connected: boolean;
  lastPacketAt: number | null;
  packetCount: number;

  vehicle: {
    systemId: number | null;
    componentId: number | null;
    type: string;
    armed: boolean;
    flightMode: string;
    baseMode?: number;
    customMode?: number;
  };

  position: {
    lat: number | null;
    lon: number | null;
    altMsl: number | null;
    relativeAlt: number | null;
    headingDeg: number | null;
    groundCourseDeg: number | null;
  };

  gps: {
    fixType: number | null;
    fixLabel: string;
    satellites: number | null;
    eph: number | null;
    epv: number | null;
  };

  motion: {
    groundSpeed: number | null;
    airSpeed: number | null;
    climbRate: number | null;
    rollDeg: number | null;
    pitchDeg: number | null;
    yawDeg: number | null;
  };

  battery: {
    voltage: number | null;
    current: number | null;
    remainingPercent: number | null;
    consumedMah: number | null;
    cellVoltageEstimate: number | null;
  };

  radio: {
    rssi: number | null;
    remRssi: number | null;
    rxErrors: number | null;
    fixed: number | null;
    txBuffer: number | null;
    linkQuality: number | null;
  };

  system: {
    loadPercent: number | null;
    sensorsPresent?: number;
    sensorsEnabled?: number;
    sensorsHealth?: number;
    statusText: string[];
  };

  stats: {
    minVoltage: number | null;
    maxAltitude: number | null;
    maxSpeed: number | null;
    maxDistance: number | null;
    maxCurrent: number | null;
    minRssi: number | null;
    warningCount: number;
    sessionStartedAt: number;
  };
}

export interface TelemetryEnvelope {
  type: "telemetry";
  data: TelemetryState;
}

export interface StatusEnvelope {
  type: "status";
  data: BackendStatus;
}
