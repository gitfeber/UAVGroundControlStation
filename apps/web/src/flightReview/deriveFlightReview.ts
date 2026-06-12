import type { NormalizedReplayEvent, ReplayLogMetadata, TelemetryState } from "@uav-ground-control-station/shared";
import { DEFAULT_PREFLIGHT_THRESHOLDS } from "../lib/preflightThresholds";
import { haversineDistanceM, validCoordinate } from "../lib/geo";
import { normalizeTelemetryState } from "../lib/initialTelemetry";
import { applyEvent, createEmptyReplayState } from "../replay/reconstruct";
import { downsamplePreserveExtrema, downsampleUniform } from "./downsample";
import { PATH_COLOR_MODES } from "./pathColoring";
import {
  MAX_GRAPH_POINTS,
  MAX_PATH_VERTICES,
  type FlightReviewFinding,
  type FlightReviewFullStats,
  type FlightReviewInput,
  type FlightReviewMetadata,
  type FlightReviewPathVertex,
  type FlightReviewRenderSeries,
  type FlightReviewResult,
  type FlightReviewSample,
  type FlightReviewSummary,
  type FlightReviewThresholds,
  type GraphPoint,
  type GpsGraphPoint,
  type SessionHome
} from "./flightReviewTypes";

export const DEFAULT_FLIGHT_REVIEW_THRESHOLDS: FlightReviewThresholds = {
  telemetryMaxAgeMs: DEFAULT_PREFLIGHT_THRESHOLDS.telemetryMaxAgeMs,
  minGpsSatellites: DEFAULT_PREFLIGHT_THRESHOLDS.minGpsSatellitesCaution,
  minBatteryPercent: DEFAULT_PREFLIGHT_THRESHOLDS.minBatteryPercentCaution,
  minLinkQuality: DEFAULT_PREFLIGHT_THRESHOLDS.minLinkQualityCaution,
  maxEphReady: DEFAULT_PREFLIGHT_THRESHOLDS.maxEphReady,
  minBatteryVoltage: 10.5,
  batterySagDeltaVoltage: 1.0,
  batterySagWindowMs: 30_000
};

export function deriveFlightReview(
  records: FlightReviewInput,
  thresholds: Partial<FlightReviewThresholds> = {},
  replayMetadata?: ReplayLogMetadata
): FlightReviewResult {
  const t: FlightReviewThresholds = { ...DEFAULT_FLIGHT_REVIEW_THRESHOLDS, ...thresholds };
  const samples = buildSamples(records, t);
  const sessionHome = findSessionHome(samples);
  attachDistanceFromHome(samples, sessionHome);

  const findings = detectFindings(samples, t, sessionHome);
  const summary = buildSummary(samples, findings, t, sessionHome);
  const fullStats: FlightReviewFullStats = { samples };
  const renderSeries = buildRenderSeries(samples);
  const renderPath = buildRenderPath(samples);

  const timelineMarkerCount = findings.filter((f) => f.showOnTimeline).length;

  return {
    summary,
    findings,
    fullStats,
    renderSeries,
    renderPath,
    pathColorModes: [...PATH_COLOR_MODES],
    metadata: {
      thresholds: t,
      fullSampleCount: samples.length,
      renderSeriesCap: MAX_GRAPH_POINTS,
      renderPathCap: MAX_PATH_VERTICES,
      timelineMarkerCount,
      ...(replayMetadata !== undefined ? { replayMetadata } : {})
    }
  };
}

function buildSamples(records: FlightReviewInput, t: FlightReviewThresholds): FlightReviewSample[] {
  const samples: FlightReviewSample[] = [];
  let state = createEmptyReplayState();
  let prevTimeMs: number | null = null;

  for (const event of records) {
    if (event.type !== "telemetry" && event.type !== "partialTelemetry") continue;

    state = normalizeTelemetryState(applyEvent(state, event));
    const logGapMs =
      prevTimeMs === null ? 0 : Math.max(0, event.timeMs - prevTimeMs);
    prevTimeMs = event.timeMs;

    samples.push({
      timeMs: event.timeMs,
      eventIndex: event.index,
      state,
      distanceFromHomeM: null,
      gpsQualityScore: computeGpsQualityScore(state, t),
      logGapMs: logGapMs > t.telemetryMaxAgeMs ? logGapMs : 0
    });
  }

  return samples;
}

function findSessionHome(samples: FlightReviewSample[]): SessionHome | null {
  for (const sample of samples) {
    const coord = validCoordinate(sample.state.position.lat, sample.state.position.lon);
    if (coord) {
      return { lat: coord.lat, lon: coord.lon, timeMs: sample.timeMs };
    }
  }
  return null;
}

function attachDistanceFromHome(samples: FlightReviewSample[], home: SessionHome | null): void {
  if (!home) return;
  for (const sample of samples) {
    const coord = validCoordinate(sample.state.position.lat, sample.state.position.lon);
    if (!coord) continue;
    sample.distanceFromHomeM = haversineDistanceM(home, coord);
  }
}

/** Preflight-style composite GPS quality 0–100 for path coloring and graphs. */
export function computeGpsQualityScore(state: TelemetryState, t: FlightReviewThresholds): number {
  const { fixType, satellites, eph } = state.gps;

  if (fixType == null || fixType < 2) return 0;
  if (fixType === 2) return 35;

  // 3D fix or better.
  let score = 55;
  if (satellites != null) {
    if (satellites >= DEFAULT_PREFLIGHT_THRESHOLDS.minGpsSatellitesReady) score = 90;
    else if (satellites >= t.minGpsSatellites) score = 70;
    else score = 25;
  }

  if (eph != null && eph > t.maxEphReady) {
    score = Math.min(score, 45);
  }

  return score;
}

function isGpsDegraded(state: TelemetryState, t: FlightReviewThresholds): boolean {
  const { fixType, satellites, eph } = state.gps;
  if (fixType == null || fixType < 3) return true;
  if (satellites != null && satellites < t.minGpsSatellites) return true;
  if (eph != null && eph > t.maxEphReady) return true;
  return false;
}

function isRadioDegraded(state: TelemetryState, t: FlightReviewThresholds): boolean {
  const lq = state.radio.linkQuality;
  return lq != null && lq < t.minLinkQuality;
}

function isBatteryLow(state: TelemetryState, t: FlightReviewThresholds): boolean {
  const voltage = state.battery.voltage;
  if (voltage != null) return voltage < t.minBatteryVoltage;
  const pct = state.battery.remainingPercent;
  return pct != null && pct < t.minBatteryPercent;
}

function detectFindings(
  samples: FlightReviewSample[],
  t: FlightReviewThresholds,
  sessionHome: SessionHome | null
): FlightReviewFinding[] {
  const findings: FlightReviewFinding[] = [];
  let findingSeq = 0;
  const nextId = (prefix: string) => `${prefix}-${findingSeq++}`;

  // Stale telemetry gaps.
  for (const sample of samples) {
    if (sample.logGapMs <= t.telemetryMaxAgeMs) continue;
    findings.push({
      id: nextId("telemetry-gap"),
      timeMs: sample.timeMs,
      severity: "warn",
      category: "telemetry",
      title: "Telemetry gap",
      detail: `No telemetry log entry for ${sample.logGapMs} ms`,
      durationMs: sample.logGapMs,
      showOnTimeline: true
    });
  }

  // Battery floor spans.
  let lowBatteryStart: FlightReviewSample | null = null;
  const flushLowBattery = (end: FlightReviewSample) => {
    if (!lowBatteryStart) return;
    const durationMs = end.timeMs - lowBatteryStart.timeMs;
    findings.push({
      id: nextId("battery-low"),
      timeMs: lowBatteryStart.timeMs,
      severity: "warn",
      category: "battery",
      title: "Low battery voltage",
      detail: `Below ${t.minBatteryVoltage} V`,
      durationMs: durationMs > 0 ? durationMs : undefined,
      showOnTimeline: true
    });
    lowBatteryStart = null;
  };

  for (const sample of samples) {
    if (isBatteryLow(sample.state, t)) {
      if (!lowBatteryStart) lowBatteryStart = sample;
    } else if (lowBatteryStart) {
      flushLowBattery(sample);
    }
  }
  if (lowBatteryStart && samples.length > 0) {
    flushLowBattery(samples[samples.length - 1]!);
  }

  // Battery sag within rolling window (peak-to-current drop).
  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i]!;
    const voltage = current.state.battery.voltage;
    if (voltage == null) continue;

    let windowPeak = voltage;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = samples[j]!;
      if (current.timeMs - prev.timeMs > t.batterySagWindowMs) break;
      const v = prev.state.battery.voltage;
      if (v != null) windowPeak = Math.max(windowPeak, v);
    }

    if (windowPeak - voltage >= t.batterySagDeltaVoltage) {
      findings.push({
        id: nextId("battery-sag"),
        timeMs: current.timeMs,
        severity: "warn",
        category: "battery",
        title: "Battery voltage sag",
        detail: `Dropped ${(windowPeak - voltage).toFixed(1)} V within ${t.batterySagWindowMs / 1000}s`,
        showOnTimeline: true
      });
    }
  }

  // GPS / radio edge transitions.
  let prevGpsDegraded: boolean | null = null;
  let prevRadioDegraded: boolean | null = null;
  let prevArmed: boolean | null = null;
  let prevFlightMode: string | null = null;
  let prevFixType: number | null = null;
  let maxAltReported = false;
  let sessionMaxAlt: number | null = null;

  for (const sample of samples) {
    const { state } = sample;
    const gpsBad = isGpsDegraded(state, t);
    if (prevGpsDegraded !== null && gpsBad !== prevGpsDegraded) {
      findings.push({
        id: nextId("gps"),
        timeMs: sample.timeMs,
        severity: gpsBad ? "warn" : "info",
        category: "gps",
        title: gpsBad ? "GPS degraded" : "GPS recovered",
        detail: formatGpsDetail(state),
        showOnTimeline: true
      });
    }
    prevGpsDegraded = gpsBad;

    const radioBad = isRadioDegraded(state, t);
    if (prevRadioDegraded !== null && radioBad !== prevRadioDegraded) {
      findings.push({
        id: nextId("radio"),
        timeMs: sample.timeMs,
        severity: radioBad ? "warn" : "info",
        category: "radio",
        title: radioBad ? "Link quality degraded" : "Link quality recovered",
        detail:
          state.radio.linkQuality != null ? `Link quality ${state.radio.linkQuality}%` : undefined,
        showOnTimeline: true
      });
    }
    prevRadioDegraded = radioBad;

    const armed = state.vehicle.armed;
    if (prevArmed !== null && armed !== prevArmed) {
      findings.push({
        id: nextId("armed"),
        timeMs: sample.timeMs,
        severity: "info",
        category: "flight",
        title: armed ? "Armed" : "Disarmed",
        showOnTimeline: true
      });
    }
    prevArmed = armed;

    const mode = state.vehicle.flightMode;
    if (prevFlightMode !== null && mode !== prevFlightMode) {
      findings.push({
        id: nextId("flight-mode"),
        timeMs: sample.timeMs,
        severity: "info",
        category: "flight",
        title: "Flight mode changed",
        detail: `${prevFlightMode} → ${mode}`,
        showOnTimeline: true
      });
    }
    prevFlightMode = mode;

    const fixType = state.gps.fixType;
    if (prevFixType !== null && fixType !== prevFixType) {
      findings.push({
        id: nextId("fix-type"),
        timeMs: sample.timeMs,
        severity: "info",
        category: "gps",
        title: "GPS fix type changed",
        detail: `${prevFixType ?? "--"} → ${fixType ?? "--"}`,
        showOnTimeline: true
      });
    }
    prevFixType = fixType;

    const alt = sampleAltitudeM(sample);
    if (alt != null) {
      sessionMaxAlt = sessionMaxAlt === null ? alt : Math.max(sessionMaxAlt, alt);
      if (!maxAltReported && sessionMaxAlt === alt && alt > 0) {
        maxAltReported = true;
        findings.push({
          id: nextId("max-altitude"),
          timeMs: sample.timeMs,
          severity: "info",
          category: "flight",
          title: "Session max altitude",
          detail: `${alt.toFixed(1)} m`,
          showOnTimeline: true
        });
      }
    }
  }

  if (t.maxAltitude != null && sessionMaxAlt != null && sessionMaxAlt > t.maxAltitude) {
    findings.push({
      id: nextId("summary-altitude"),
      timeMs: samples[samples.length - 1]?.timeMs ?? 0,
      severity: "warn",
      category: "summary",
      title: "Exceeded max altitude threshold",
      detail: `${sessionMaxAlt.toFixed(1)} m > ${t.maxAltitude} m`,
      showOnTimeline: false
    });
  }

  if (t.maxDistanceFromHome != null && sessionHome) {
    let maxDist = 0;
    for (const sample of samples) {
      if (sample.distanceFromHomeM != null) maxDist = Math.max(maxDist, sample.distanceFromHomeM);
    }
    if (maxDist > t.maxDistanceFromHome) {
      findings.push({
        id: nextId("summary-distance"),
        timeMs: samples[samples.length - 1]?.timeMs ?? 0,
        severity: "warn",
        category: "summary",
        title: "Exceeded max distance from session home",
        detail: `${maxDist.toFixed(0)} m > ${t.maxDistanceFromHome} m`,
        showOnTimeline: false
      });
    }
  }

  findings.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
  return findings;
}

function formatGpsDetail(state: TelemetryState): string {
  const { fixLabel, satellites, eph } = state.gps;
  const parts = [fixLabel || "Unknown fix"];
  if (satellites != null) parts.push(`${satellites} sats`);
  if (eph != null) parts.push(`EPH ${eph}`);
  return parts.join(", ");
}

function sampleAltitudeM(sample: FlightReviewSample): number | null {
  const rel = sample.state.position?.relativeAlt;
  if (rel != null && Number.isFinite(rel)) return rel;
  const msl = sample.state.position?.altMsl;
  return msl != null && Number.isFinite(msl) ? msl : null;
}

function buildSummary(
  samples: FlightReviewSample[],
  findings: FlightReviewFinding[],
  t: FlightReviewThresholds,
  sessionHome: SessionHome | null
): FlightReviewSummary {
  if (samples.length === 0) {
    return {
      durationMs: 0,
      telemetrySampleCount: 0,
      sessionHome,
      maxAltitudeM: null,
      maxSpeedMps: null,
      maxDistanceFromHomeM: null,
      minVoltageV: null,
      minBatteryPercent: null,
      armedDurationMs: 0,
      flightModeChanges: 0,
      telemetryGapCount: 0
    };
  }

  let maxAltitudeM: number | null = null;
  let maxSpeedMps: number | null = null;
  let maxDistanceFromHomeM: number | null = null;
  let minVoltageV: number | null = null;
  let minBatteryPercent: number | null = null;
  let armedDurationMs = 0;
  let flightModeChanges = 0;
  let prevMode: string | null = null;
  let prevArmed = false;
  let prevTimeMs = samples[0]!.timeMs;

  for (const sample of samples) {
    const dt = Math.max(0, sample.timeMs - prevTimeMs);
    if (sample.state.vehicle.armed) armedDurationMs += dt;

    const alt = sampleAltitudeM(sample);
    if (alt != null) maxAltitudeM = maxAltitudeM === null ? alt : Math.max(maxAltitudeM, alt);

    const speed = sample.state.motion.groundSpeed;
    if (speed != null) maxSpeedMps = maxSpeedMps === null ? speed : Math.max(maxSpeedMps, speed);

    if (sample.distanceFromHomeM != null) {
      maxDistanceFromHomeM =
        maxDistanceFromHomeM === null
          ? sample.distanceFromHomeM
          : Math.max(maxDistanceFromHomeM, sample.distanceFromHomeM);
    }

    const voltage = sample.state.battery.voltage;
    if (voltage != null) minVoltageV = minVoltageV === null ? voltage : Math.min(minVoltageV, voltage);

    const pct = sample.state.battery.remainingPercent;
    if (pct != null) minBatteryPercent = minBatteryPercent === null ? pct : Math.min(minBatteryPercent, pct);

    const mode = sample.state.vehicle.flightMode;
    if (prevMode !== null && mode !== prevMode) flightModeChanges += 1;
    prevMode = mode;
    prevArmed = sample.state.vehicle.armed;
    prevTimeMs = sample.timeMs;
  }

  const telemetryGapCount = findings.filter((f) => f.category === "telemetry").length;
  const durationMs = samples[samples.length - 1]!.timeMs - samples[0]!.timeMs;

  const summary: FlightReviewSummary = {
    durationMs,
    telemetrySampleCount: samples.length,
    sessionHome,
    maxAltitudeM,
    maxSpeedMps,
    maxDistanceFromHomeM,
    minVoltageV,
    minBatteryPercent,
    armedDurationMs,
    flightModeChanges,
    telemetryGapCount
  };

  if (t.maxAltitude != null && maxAltitudeM != null) {
    summary.exceededMaxAltitude = maxAltitudeM > t.maxAltitude;
  }
  if (t.maxDistanceFromHome != null && maxDistanceFromHomeM != null) {
    summary.exceededMaxDistanceFromHome = maxDistanceFromHomeM > t.maxDistanceFromHome;
  }

  return summary;
}

function buildRenderSeries(samples: FlightReviewSample[]): FlightReviewRenderSeries {
  const altitude: GraphPoint[] = [];
  const speed: GraphPoint[] = [];
  const batteryVoltage: GraphPoint[] = [];
  const linkQuality: GraphPoint[] = [];
  const rssi: GraphPoint[] = [];
  const gps: GpsGraphPoint[] = [];

  for (const sample of samples) {
    const { timeMs, state, gpsQualityScore } = sample;
    const alt = sampleAltitudeM(sample);
    if (alt != null) altitude.push({ timeMs, value: alt });
    if (state.motion.groundSpeed != null) speed.push({ timeMs, value: state.motion.groundSpeed });
    if (state.battery.voltage != null) batteryVoltage.push({ timeMs, value: state.battery.voltage });
    if (state.radio.linkQuality != null) linkQuality.push({ timeMs, value: state.radio.linkQuality });
    if (state.radio.rssi != null) rssi.push({ timeMs, value: state.radio.rssi });
    gps.push({
      timeMs,
      satellites: state.gps.satellites,
      eph: state.gps.eph,
      gpsQualityScore
    });
  }

  return {
    altitude: downsamplePreserveExtrema(altitude, MAX_GRAPH_POINTS),
    speed: downsamplePreserveExtrema(speed, MAX_GRAPH_POINTS),
    batteryVoltage: downsamplePreserveExtrema(batteryVoltage, MAX_GRAPH_POINTS),
    linkQuality: downsamplePreserveExtrema(linkQuality, MAX_GRAPH_POINTS),
    rssi: downsamplePreserveExtrema(rssi, MAX_GRAPH_POINTS),
    gps: downsampleUniform(gps, MAX_GRAPH_POINTS)
  };
}

function buildRenderPath(samples: FlightReviewSample[]): FlightReviewPathVertex[] {
  const vertices: FlightReviewPathVertex[] = [];

  for (const sample of samples) {
    const coord = validCoordinate(sample.state.position.lat, sample.state.position.lon);
    if (!coord) continue;

    vertices.push({
      lat: coord.lat,
      lon: coord.lon,
      timeMs: sample.timeMs,
      logGapMs: sample.logGapMs,
      altitudeM: sampleAltitudeM(sample),
      speedMps: sample.state.motion.groundSpeed,
      batteryVoltageV: sample.state.battery.voltage,
      gpsQualityScore: sample.gpsQualityScore
    });
  }

  return downsampleUniform(vertices, MAX_PATH_VERTICES);
}

export type { FlightReviewThresholds, FlightReviewResult } from "./flightReviewTypes";
