import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DeepPartial, TelemetryState } from "../index.js";
import type { MavlinkFrame } from "../telemetry/mavlinkDispatch.js";

export interface MavlinkFixtureMessage {
  id: number;
  crc_extra: number;
  full_payload_len: number;
  wire_v2_hex: string;
  wire_v1_hex: string | null;
  known: Record<string, number | string>;
}

export interface MavlinkFixtures {
  messages: Record<string, MavlinkFixtureMessage>;
  tables: { crc_extra: Record<string, number>; max_payload_len: Record<string, number> };
  truncated_statustext_v2_hex: string;
  stream_v2: { names: string[]; hex: string };
}

export interface MavlinkTelemetryPatches {
  messages: Record<string, DeepPartial<TelemetryState>>;
}

const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/mavlink", import.meta.url));

let cachedFrames: MavlinkFixtures | null = null;
let cachedPatches: MavlinkTelemetryPatches | null = null;

export function loadMavlinkFixtures(): MavlinkFixtures {
  if (!cachedFrames) {
    cachedFrames = JSON.parse(readFileSync(`${FIXTURE_DIR}/frames.json`, "utf8")) as MavlinkFixtures;
  }
  return cachedFrames;
}

export function loadMavlinkTelemetryPatches(): MavlinkTelemetryPatches {
  if (!cachedPatches) {
    cachedPatches = JSON.parse(readFileSync(`${FIXTURE_DIR}/telemetry-patches.json`, "utf8")) as MavlinkTelemetryPatches;
  }
  return cachedPatches;
}

export function messageFixture(name: string): MavlinkFixtureMessage {
  const entry = loadMavlinkFixtures().messages[name];
  if (!entry) throw new Error(`mavlink fixture missing: ${name}`);
  return entry;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Build a normalized {@link MavlinkFrame} from on-wire v1/v2 hex (zero-pads v2 truncation). */
export function frameFromWire(hex: string, fullPayloadLen: number, version: "v1" | "v2" = "v2"): MavlinkFrame {
  const buf = hexToBytes(hex);
  if (version === "v2") {
    if (buf[0] !== 0xfd) throw new Error("expected MAVLink v2 frame");
    const payloadLen = buf[1]!;
    const sysid = buf[5]!;
    const compid = buf[6]!;
    const msgid = buf[7]! | (buf[8]! << 8) | (buf[9]! << 16);
    const padded = new Uint8Array(fullPayloadLen);
    padded.set(buf.subarray(10, 10 + payloadLen));
    return { sysid, compid, msgid, payload: new DataView(padded.buffer) };
  }

  if (buf[0] !== 0xfe) throw new Error("expected MAVLink v1 frame");
  const payloadLen = buf[1]!;
  const sysid = buf[3]!;
  const compid = buf[4]!;
  const msgid = buf[5]!;
  const padded = new Uint8Array(fullPayloadLen);
  padded.set(buf.subarray(6, 6 + payloadLen));
  return { sysid, compid, msgid, payload: new DataView(padded.buffer) };
}

export interface AssertTelemetryPatchOptions {
  /** Absolute tolerance for numeric comparisons (default 1e-3). */
  numberEpsilon?: number;
}

/** Deep-partial compare of decoded telemetry against a golden patch. */
export function assertTelemetryPatch(
  actual: TelemetryState,
  expected: DeepPartial<TelemetryState>,
  options: AssertTelemetryPatchOptions = {}
): void {
  const epsilon = options.numberEpsilon ?? 1e-3;
  comparePartial(actual, expected, "", epsilon);
}

function comparePartial(actual: unknown, expected: unknown, path: string, epsilon: number): void {
  if (expected === null || expected === undefined) {
    if (actual !== expected) {
      throw new Error(`patch mismatch at ${path || "(root)"}: expected ${String(expected)}, got ${String(actual)}`);
    }
    return;
  }

  if (typeof expected === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) {
      throw new Error(`patch mismatch at ${path}: expected number ${expected}, got ${String(actual)}`);
    }
    if (Math.abs(actual - expected) > epsilon) {
      throw new Error(`patch mismatch at ${path}: expected ${expected} ± ${epsilon}, got ${actual}`);
    }
    return;
  }

  if (typeof expected === "boolean" || typeof expected === "string") {
    if (actual !== expected) {
      throw new Error(`patch mismatch at ${path}: expected ${String(expected)}, got ${String(actual)}`);
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new Error(`patch mismatch at ${path}: expected array, got ${typeof actual}`);
    }
    if (actual.length < expected.length) {
      throw new Error(`patch mismatch at ${path}: expected at least ${expected.length} items, got ${actual.length}`);
    }
    expected.forEach((item, index) => comparePartial(actual[index], item, `${path}[${index}]`, epsilon));
    return;
  }

  if (typeof expected === "object") {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      throw new Error(`patch mismatch at ${path}: expected object, got ${String(actual)}`);
    }
    for (const [key, value] of Object.entries(expected)) {
      comparePartial((actual as Record<string, unknown>)[key], value, path ? `${path}.${key}` : key, epsilon);
    }
  }
}
