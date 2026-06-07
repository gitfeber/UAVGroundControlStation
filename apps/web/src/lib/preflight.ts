import type { TelemetrySourceMode, TelemetryState } from "@uav-ground-control-station/shared";
import { validCoordinate } from "./geo";
import { DEFAULT_PREFLIGHT_THRESHOLDS, type PreflightThresholds } from "./preflightThresholds";

/**
 * Read-only Preflight health advisory (ADR 0004).
 *
 * `evaluatePreflightHealth` is a pure function: it derives an operator-facing
 * readiness summary from active telemetry, the UI home reference, and the
 * current source mode. It is NOT the flight controller's pre-arm result, sends
 * no commands, and triggers no serial/connect behavior. It calls neither
 * `Date.now()` nor `Math.random()` internally — the caller supplies `now`.
 */

export type PreflightStatus = "READY" | "CAUTION" | "NOT_READY" | "UNKNOWN";

export type PreflightCheckId =
  | "telemetry-freshness"
  | "gps"
  | "battery"
  | "radio"
  | "home"
  | "armed"
  | "system-health";

export interface PreflightCheckResult {
  id: PreflightCheckId;
  label: string;
  status: PreflightStatus;
  message: string;
  details?: string;
  /** When true, an UNKNOWN verdict is excluded from global aggregation. */
  optional?: boolean;
  updatedAt?: number;
}

export interface PreflightHealth {
  status: PreflightStatus;
  checks: PreflightCheckResult[];
  summary: string;
  updatedAt: number;
}

export interface PreflightOptions {
  sourceMode?: TelemetrySourceMode;
  home?: { lat: number; lon: number } | null;
  thresholds?: Partial<PreflightThresholds>;
}

/** Fixed priority for choosing the dominant check that drives the summary line. */
const SUMMARY_PRIORITY: PreflightCheckId[] = [
  "battery",
  "gps",
  "radio",
  "telemetry-freshness",
  "system-health",
  "home",
  "armed"
];

const CHECK_LABELS: Record<PreflightCheckId, string> = {
  "telemetry-freshness": "Telemetry freshness",
  gps: "GPS",
  battery: "Battery",
  radio: "Radio / Link",
  home: "Home reference (first fix)",
  armed: "Armed state",
  "system-health": "System health"
};

export function evaluatePreflightHealth(
  telemetry: TelemetryState | null | undefined,
  now: number = Date.now(),
  opts: PreflightOptions = {}
): PreflightHealth {
  const sourceMode: TelemetrySourceMode = opts.sourceMode ?? "live";
  const home = opts.home ?? null;
  const t: PreflightThresholds = { ...DEFAULT_PREFLIGHT_THRESHOLDS, ...opts.thresholds };

  // No-telemetry gate: still emit every row (as UNKNOWN) so the UI is stable.
  if (!telemetry || telemetry.packetCount === 0 || telemetry.lastPacketAt == null) {
    const checks = (Object.keys(CHECK_LABELS) as PreflightCheckId[]).map<PreflightCheckResult>((id) => ({
      id,
      label: CHECK_LABELS[id],
      status: "UNKNOWN",
      message: "Waiting for telemetry",
      optional: true
    }));
    return { status: "UNKNOWN", checks, summary: "Waiting for telemetry", updatedAt: now };
  }

  const lastPacketAt = telemetry.lastPacketAt;
  const checks: PreflightCheckResult[] = [
    freshnessCheck(telemetry, now, sourceMode, t),
    gpsCheck(telemetry, t),
    batteryCheck(telemetry, t),
    radioCheck(telemetry, t),
    homeCheck(home),
    armedCheck(telemetry),
    systemHealthCheck(telemetry)
  ];

  const status = aggregate(checks);
  return { status, checks, summary: summarize(status, checks), updatedAt: lastPacketAt };
}

function freshnessCheck(
  telemetry: TelemetryState,
  now: number,
  sourceMode: TelemetrySourceMode,
  t: PreflightThresholds
): PreflightCheckResult {
  const base = { id: "telemetry-freshness" as const, label: CHECK_LABELS["telemetry-freshness"] };

  // Replay/simulation timestamps are virtual (ADR 0003) — wall-clock age is
  // meaningless, so the check is an optional UNKNOWN and excluded from aggregation.
  if (sourceMode !== "live") {
    return {
      ...base,
      status: "UNKNOWN",
      message: "Freshness check skipped outside live mode",
      optional: true
    };
  }

  const lastPacketAt = telemetry.lastPacketAt ?? 0;
  const ageMs = now - lastPacketAt;
  const ageSec = (ageMs / 1000).toFixed(1);
  if (ageMs > t.telemetryMaxAgeMs) {
    return { ...base, status: "NOT_READY", message: `No telemetry for ${ageSec}s`, details: `Age ${ageSec}s`, updatedAt: lastPacketAt };
  }
  return { ...base, status: "READY", message: "Telemetry fresh", details: `Age ${ageSec}s`, updatedAt: lastPacketAt };
}

function gpsCheck(telemetry: TelemetryState, t: PreflightThresholds): PreflightCheckResult {
  const base = { id: "gps" as const, label: CHECK_LABELS.gps };
  const { fixType, satellites, eph } = telemetry.gps;
  const details = `${telemetry.gps.fixLabel}, ${satellites ?? "--"} sats${eph != null ? `, EPH ${eph}` : ""}`;

  if (fixType == null || fixType < 2) {
    return { ...base, status: "NOT_READY", message: "No GPS fix", details };
  }
  if (fixType === 2) {
    return { ...base, status: "CAUTION", message: "2D fix only", details };
  }

  // 3D fix or better — judge on satellite count.
  if (satellites == null) {
    return { ...base, status: "CAUTION", message: "Satellite count unavailable", details };
  }

  let status: PreflightStatus;
  let message: string;
  if (satellites >= t.minGpsSatellitesReady) {
    status = "READY";
    message = "3D fix";
  } else if (satellites >= t.minGpsSatellitesCaution) {
    status = "CAUTION";
    message = `Low satellite count (${satellites})`;
  } else {
    status = "NOT_READY";
    message = `Too few satellites (${satellites})`;
  }

  // High EPH only downgrades a READY GPS to CAUTION — never to NOT_READY.
  if (status === "READY" && eph != null && eph > t.maxEphReady) {
    status = "CAUTION";
    message = `High EPH (${eph})`;
  }

  return { ...base, status, message, details };
}

function batteryCheck(telemetry: TelemetryState, t: PreflightThresholds): PreflightCheckResult {
  const pct = telemetry.battery.remainingPercent;
  const base = {
    id: "battery" as const,
    label: CHECK_LABELS.battery,
    ...(telemetry.battery.voltage != null ? { details: `${telemetry.battery.voltage} V` } : {})
  };

  // No remaining-% telemetry: block at CAUTION rather than inferring from voltage.
  if (pct == null) {
    return { ...base, status: "CAUTION", message: "Battery level unavailable" };
  }

  if (pct >= t.minBatteryPercentReady) {
    return { ...base, status: "READY", message: `Battery ${pct}%` };
  }
  if (pct >= t.minBatteryPercentCaution) {
    return { ...base, status: "CAUTION", message: `Battery low (${pct}%)` };
  }
  return { ...base, status: "NOT_READY", message: `Battery critical (${pct}%)` };
}

function radioCheck(telemetry: TelemetryState, t: PreflightThresholds): PreflightCheckResult {
  const lq = telemetry.radio.linkQuality;
  // Raw RSSI is shown for context only — it never drives the status.
  const base = {
    id: "radio" as const,
    label: CHECK_LABELS.radio,
    ...(telemetry.radio.rssi != null ? { details: `RSSI ${telemetry.radio.rssi}` } : {})
  };

  if (lq == null) {
    return { ...base, status: "CAUTION", message: "Link quality unavailable" };
  }

  if (lq >= t.minLinkQualityReady) {
    return { ...base, status: "READY", message: `Link ${lq}%` };
  }
  if (lq >= t.minLinkQualityCaution) {
    return { ...base, status: "CAUTION", message: `Link weak (${lq}%)` };
  }
  return { ...base, status: "NOT_READY", message: `Link critical (${lq}%)` };
}

function homeCheck(home: { lat: number; lon: number } | null): PreflightCheckResult {
  const base = { id: "home" as const, label: CHECK_LABELS.home };

  if (home == null) {
    return { ...base, status: "CAUTION", message: "No home reference yet" };
  }

  // Null island (0,0) and any out-of-range coordinate are invalid.
  const valid = validCoordinate(home.lat, home.lon);
  if (!valid || (home.lat === 0 && home.lon === 0)) {
    return { ...base, status: "NOT_READY", message: "Invalid home reference" };
  }
  return { ...base, status: "READY", message: "Home reference latched", details: `${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}` };
}

function armedCheck(telemetry: TelemetryState): PreflightCheckResult {
  const base = { id: "armed" as const, label: CHECK_LABELS.armed };
  const armed = telemetry.vehicle.armed;

  if (typeof armed !== "boolean") {
    return { ...base, status: "UNKNOWN", message: "Armed state unavailable", optional: true };
  }
  if (armed) {
    return { ...base, status: "CAUTION", message: "Vehicle armed" };
  }
  return { ...base, status: "READY", message: "Disarmed" };
}

function systemHealthCheck(telemetry: TelemetryState): PreflightCheckResult {
  const base = { id: "system-health" as const, label: CHECK_LABELS["system-health"] };
  const enabled = telemetry.system.sensorsEnabled;
  const health = telemetry.system.sensorsHealth;

  if (enabled === undefined || health === undefined) {
    return { ...base, status: "UNKNOWN", message: "Sensor health unavailable", optional: true };
  }
  // STATUSTEXT is informational only — no keyword scanning drives the status.
  if ((enabled & ~health) !== 0) {
    return { ...base, status: "NOT_READY", message: "Sensor fault reported" };
  }
  return { ...base, status: "READY", message: "Sensors healthy" };
}

function aggregate(checks: PreflightCheckResult[]): PreflightStatus {
  const relevant = checks.filter((c) => !c.optional);
  if (relevant.some((c) => c.status === "NOT_READY")) return "NOT_READY";
  if (relevant.some((c) => c.status === "CAUTION")) return "CAUTION";
  if (relevant.some((c) => c.status === "UNKNOWN")) return "UNKNOWN";
  return "READY";
}

function summarize(status: PreflightStatus, checks: PreflightCheckResult[]): string {
  if (status === "READY") return "Ready for flight";
  if (status === "UNKNOWN") return "Waiting for telemetry";

  const dominant = checks
    .filter((c) => !c.optional && c.status === status)
    .sort((a, b) => SUMMARY_PRIORITY.indexOf(a.id) - SUMMARY_PRIORITY.indexOf(b.id))[0];

  const prefix = status === "NOT_READY" ? "Not ready" : "Caution";
  return dominant ? `${prefix}: ${dominant.message}` : prefix;
}
