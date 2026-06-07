import type {
  NormalizedReplayEvent,
  ReplayLogMetadata,
  SimulationOptions,
  SimulationScenario,
  TelemetryState
} from "@uav-ground-control-station/shared";
import { createEmptyTelemetryState } from "../lib/initialTelemetry";

/**
 * Deterministic simulation generator (ADR 0003, handoff §6).
 *
 * Pure and seedable: the same {@link SimulationOptions} always yields the same
 * `NormalizedReplayEvent[]`. There is NO realtime scheduler here — simulation
 * pre-generates a bounded event list that is fed into the same replay
 * controller used for log replay. No Date.now / Math.random / wall-clock reads.
 */

const DEFAULT_START_LAT = 47.0;
const DEFAULT_START_LON = 8.0;
const METERS_PER_DEG_LAT = 111_320;

export const SIMULATION_SCENARIO_LABELS: Record<SimulationScenario, string> = {
  nominalFlight: "Nominal flight",
  weakRadioLink: "Weak radio link",
  gpsDegradation: "GPS degradation",
  lowBatteryApproach: "Low battery approach"
};

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  scenario: "nominalFlight",
  seed: 1337,
  durationMs: 4 * 60 * 1000, // 4 minutes (handoff default 3–5 min)
  rateHz: 20
};

/** Inline mulberry32 PRNG — no dependency, fully deterministic from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScenarioParams {
  startVoltage: number;
  drainVPerMin: number;
  baseRssi: number;
  rssiDegradePerMin: number;
  startSatellites: number;
  satDegradePerMin: number;
  noiseM: number;
}

function scenarioParams(scenario: SimulationScenario): ScenarioParams {
  switch (scenario) {
    case "weakRadioLink":
      return { startVoltage: 16.8, drainVPerMin: 0.4, baseRssi: -78, rssiDegradePerMin: 8, startSatellites: 13, satDegradePerMin: 0, noiseM: 1.5 };
    case "gpsDegradation":
      return { startVoltage: 16.8, drainVPerMin: 0.4, baseRssi: -62, rssiDegradePerMin: 0, startSatellites: 12, satDegradePerMin: 3, noiseM: 4 };
    case "lowBatteryApproach":
      return { startVoltage: 14.4, drainVPerMin: 1.2, baseRssi: -64, rssiDegradePerMin: 1, startSatellites: 13, satDegradePerMin: 0, noiseM: 1 };
    case "nominalFlight":
    default:
      return { startVoltage: 16.8, drainVPerMin: 0.4, baseRssi: -60, rssiDegradePerMin: 0, startSatellites: 14, satDegradePerMin: 0, noiseM: 1 };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function initialState(options: SimulationOptions, params: ScenarioParams): TelemetryState {
  const state = createEmptyTelemetryState();
  state.stats.sessionStartedAt = 0; // keep deterministic (no Date.now)
  state.connected = true;
  state.packetCount = 1;
  state.lastPacketAt = 0;
  state.vehicle = { systemId: 1, componentId: 1, type: "Quadrotor", armed: false, flightMode: "Stabilize" };
  state.position = {
    lat: options.startLat ?? DEFAULT_START_LAT,
    lon: options.startLon ?? DEFAULT_START_LON,
    altMsl: 500,
    relativeAlt: 0,
    headingDeg: 90,
    groundCourseDeg: 90
  };
  state.gps = {
    fixType: 3,
    fixLabel: "3D Fix",
    satellites: params.startSatellites,
    eph: 80,
    epv: 120
  };
  state.motion = { groundSpeed: 0, airSpeed: 0, climbRate: 0, rollDeg: 0, pitchDeg: 0, yawDeg: 90 };
  state.battery = {
    voltage: params.startVoltage,
    current: 2,
    remainingPercent: 100,
    consumedMah: 0,
    cellVoltageEstimate: round(params.startVoltage / 4, 2)
  };
  state.radio = { rssi: params.baseRssi, remRssi: params.baseRssi - 2, rxErrors: 0, fixed: 0, txBuffer: 0, linkQuality: 100 };
  state.system = { loadPercent: 20, statusText: [] };
  state.stats = {
    minVoltage: params.startVoltage,
    maxAltitude: 0,
    maxSpeed: 0,
    maxDistance: 0,
    maxCurrent: 2,
    minRssi: params.baseRssi,
    warningCount: 0,
    sessionStartedAt: 0
  };
  return state;
}

export function generateSimulationEvents(options: SimulationOptions): NormalizedReplayEvent[] {
  const params = scenarioParams(options.scenario);
  const rng = mulberry32(options.seed);
  const intervalMs = 1000 / options.rateHz;
  const tickCount = Math.max(1, Math.floor(options.durationMs / intervalMs) + 1);
  const dtSec = intervalMs / 1000;

  const events: NormalizedReplayEvent[] = [];
  events.push({ index: 0, timeMs: 0, type: "telemetry", absoluteTsMs: null, telemetry: initialState(options, params) });

  let lat = options.startLat ?? DEFAULT_START_LAT;
  let lon = options.startLon ?? DEFAULT_START_LON;
  let headingDeg = 90;
  let lowBatteryWarned = false;
  let gpsLostWarned = false;

  for (let i = 1; i < tickCount; i += 1) {
    const timeMs = Math.round(i * intervalMs);
    const minutes = timeMs / 60000;
    const progress = i / tickCount;

    // Gentle curving flight at ~12 m/s with a small amount of seeded noise.
    const speed = 12 + (rng() - 0.5) * 2;
    headingDeg = (headingDeg + 0.6 + (rng() - 0.5)) % 360;
    const headingRad = (headingDeg * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const noiseLat = ((rng() - 0.5) * params.noiseM) / METERS_PER_DEG_LAT;
    const noiseLon = ((rng() - 0.5) * params.noiseM) / (METERS_PER_DEG_LAT * Math.cos(latRad));
    lat += (speed * dtSec * Math.cos(headingRad)) / METERS_PER_DEG_LAT + noiseLat;
    lon += (speed * dtSec * Math.sin(headingRad)) / (METERS_PER_DEG_LAT * Math.cos(latRad)) + noiseLon;

    const relativeAlt = round(clamp(progress < 0.2 ? progress * 5 * 60 : 60, 0, 60), 1);
    const climbRate = progress < 0.2 ? round(2 + (rng() - 0.5), 2) : round((rng() - 0.5) * 1.5, 2);

    const voltage = round(Math.max(11.5, params.startVoltage - params.drainVPerMin * minutes), 2);
    const remainingPercent = round(clamp(100 - (params.drainVPerMin * minutes) / (params.startVoltage - 11.5) * 100, 0, 100), 0);
    const current = round(18 + (rng() - 0.5) * 6, 1);

    const rssi = Math.round(clamp(params.baseRssi - params.rssiDegradePerMin * minutes - (rng() < 0.05 ? 15 : 0), -120, -30));
    const linkQuality = Math.round(clamp(100 + (params.baseRssi - rssi) * -1.2, 0, 100));
    const rxErrors = params.rssiDegradePerMin > 0 ? Math.round(minutes * 5 * rng()) : 0;

    const satellites = Math.max(3, Math.round(params.startSatellites - params.satDegradePerMin * minutes));
    const fixType = satellites >= 6 ? 3 : satellites >= 4 ? 2 : 1;
    const eph = Math.round(80 + params.satDegradePerMin * minutes * 40);

    events.push({
      index: events.length,
      timeMs,
      type: "partialTelemetry",
      absoluteTsMs: null,
      patch: {
        connected: true,
        lastPacketAt: timeMs,
        packetCount: i + 1,
        vehicle: { armed: true, flightMode: "Auto" },
        position: {
          lat: round(lat, 7),
          lon: round(lon, 7),
          relativeAlt,
          altMsl: round(500 + relativeAlt, 1),
          headingDeg: Math.round(headingDeg),
          groundCourseDeg: Math.round(headingDeg)
        },
        motion: { groundSpeed: round(speed, 1), airSpeed: round(speed + 1, 1), climbRate, rollDeg: round((rng() - 0.5) * 12, 1), pitchDeg: round((rng() - 0.5) * 8, 1), yawDeg: Math.round(headingDeg) },
        battery: { voltage, current, remainingPercent, cellVoltageEstimate: round(voltage / 4, 2) },
        radio: { rssi, remRssi: rssi - 2, rxErrors, linkQuality },
        gps: { fixType, fixLabel: fixType === 3 ? "3D Fix" : fixType === 2 ? "2D Fix" : "No Fix", satellites, eph }
      }
    });

    // Deterministic lifecycle markers / warnings.
    if (i === 1) {
      events.push({ index: events.length, timeMs, type: "activity", absoluteTsMs: null, activity: { level: "info", message: "Armed — entering AUTO" } });
    }
    if (!lowBatteryWarned && remainingPercent <= 25) {
      lowBatteryWarned = true;
      events.push({ index: events.length, timeMs, type: "activity", absoluteTsMs: null, activity: { level: "warn", message: "Battery low — initiate approach" } });
    }
    if (!gpsLostWarned && fixType < 3) {
      gpsLostWarned = true;
      events.push({ index: events.length, timeMs, type: "activity", absoluteTsMs: null, activity: { level: "warn", message: "GPS fix degraded" } });
    }
  }

  return events;
}

export function generateSimulationMetadata(
  options: SimulationOptions,
  events: NormalizedReplayEvent[]
): ReplayLogMetadata {
  let telemetryEventCount = 0;
  let partialTelemetryEventCount = 0;
  let activityEventCount = 0;
  for (const event of events) {
    if (event.type === "telemetry") telemetryEventCount += 1;
    else if (event.type === "partialTelemetry") partialTelemetryEventCount += 1;
    else if (event.type === "activity") activityEventCount += 1;
  }
  const durationMs = events.length > 0 ? (events[events.length - 1] as NormalizedReplayEvent).timeMs : 0;

  return {
    fileName: `Simulation: ${SIMULATION_SCENARIO_LABELS[options.scenario]}`,
    fileSizeBytes: 0,
    schemaVersion: 1,
    eventCount: events.length,
    telemetryEventCount,
    partialTelemetryEventCount,
    activityEventCount,
    diagnosticEventCount: 0,
    skippedEventCount: 0,
    parseWarningCount: 0,
    firstTimestampMs: null,
    lastTimestampMs: null,
    durationMs,
    hasGps: true,
    hasBattery: true,
    hasRadio: true,
    hasAttitude: true
  };
}
