import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMavlinkFrame, TelemetryStore } from "@uav-ground-control-station/shared";
import { MavlinkFramer } from "./mavlinkFramer";
import { CRC_EXTRA, MAX_PAYLOAD_LEN } from "./mavlinkTables";

/**
 * Fixtures are REAL frames encoded by pymavlink's authoritative `common`
 * dialect (see __fixtures__/generate-mavlink-fixtures.py). The framer is tested
 * against bytes a real vehicle would send, not against hand-built frames that
 * would just echo our own CRC assumptions.
 */
interface FixtureMessage {
  id: number;
  crc_extra: number;
  full_payload_len: number;
  wire_v2_hex: string;
  wire_v1_hex: string | null;
  known: Record<string, number | string>;
}
interface Fixtures {
  messages: Record<string, FixtureMessage>;
  tables: { crc_extra: Record<string, number>; max_payload_len: Record<string, number> };
  truncated_statustext_v2_hex: string;
  stream_v2: { names: string[]; hex: string };
}

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/mavlink-fixtures.json", import.meta.url)), "utf8")
) as Fixtures;

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function message(name: string): FixtureMessage {
  const entry = fixtures.messages[name];
  if (!entry) throw new Error(`fixture missing: ${name}`);
  return entry;
}

describe("framer tables match the authoritative pymavlink fixtures", () => {
  // A wrong CRC_EXTRA/length byte silently drops a message; pin both tables to
  // the values the generator pulled straight from pymavlink.
  it("CRC_EXTRA equals the fixture table", () => {
    const asStringKeyed = Object.fromEntries(Object.entries(CRC_EXTRA).map(([k, v]) => [k, v]));
    expect(asStringKeyed).toEqual(fixtures.tables.crc_extra);
  });

  it("MAX_PAYLOAD_LEN equals the fixture table", () => {
    const asStringKeyed = Object.fromEntries(Object.entries(MAX_PAYLOAD_LEN).map(([k, v]) => [k, v]));
    expect(asStringKeyed).toEqual(fixtures.tables.max_payload_len);
  });
});

describe("MavlinkFramer decodes real v1 and v2 frames", () => {
  for (const [name, msg] of Object.entries(fixtures.messages)) {
    for (const version of ["wire_v2_hex", "wire_v1_hex"] as const) {
      const hex = msg[version];
      if (!hex) continue;
      it(`${name} (${version === "wire_v2_hex" ? "v2" : "v1"}) → one frame, correct ids, padded payload`, () => {
        const frames = new MavlinkFramer().push(bytes(hex));
        expect(frames).toHaveLength(1);
        const frame = frames[0]!;
        expect(frame.msgid).toBe(msg.id);
        expect(frame.sysid).toBe(1);
        expect(frame.compid).toBe(1);
        // Payload is always zero-padded to the message's full length.
        expect(frame.payload.byteLength).toBe(msg.full_payload_len);
      });
    }
  }
});

describe("MavlinkFramer edge cases", () => {
  it("rejects a frame with a corrupted CRC and counts the error", () => {
    const buf = bytes(message("heartbeat").wire_v2_hex);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const corruptAt = buf.byteLength - 3;
    view.setUint8(corruptAt, view.getUint8(corruptAt) ^ 0xff); // flip a payload byte → CRC no longer matches
    const framer = new MavlinkFramer();
    const frames = framer.push(buf);
    expect(frames).toHaveLength(0);
    expect(framer.crcErrors).toBeGreaterThanOrEqual(1);
  });

  it("zero-pads a truncated v2 STATUSTEXT back to full length", () => {
    const frames = new MavlinkFramer().push(bytes(fixtures.truncated_statustext_v2_hex));
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame.msgid).toBe(253);
    expect(frame.payload.byteLength).toBe(54); // full STATUSTEXT length despite on-wire truncation
    expect(frame.payload.getUint8(0)).toBe(4); // severity survives the round trip
  });

  it("emits every frame from a concatenated multi-message stream in order", () => {
    const frames = new MavlinkFramer().push(bytes(fixtures.stream_v2.hex));
    const expected = fixtures.stream_v2.names.map((n) => message(n).id);
    expect(frames.map((f) => f.msgid)).toEqual(expected);
  });

  it("reassembles a frame split across two chunks", () => {
    const buf = bytes(message("heartbeat").wire_v2_hex);
    const framer = new MavlinkFramer();
    expect(framer.push(buf.subarray(0, 4))).toHaveLength(0);
    const frames = framer.push(buf.subarray(4));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.msgid).toBe(0);
  });

  it("resyncs past a garbage prefix to the next valid frame", () => {
    const real = bytes(message("attitude").wire_v2_hex);
    const junk = new Uint8Array([0x00, 0x11, 0xfe, 0x02, 0xab]); // includes a false v1 start byte
    const merged = new Uint8Array(junk.length + real.length);
    merged.set(junk, 0);
    merged.set(real, junk.length);
    const frames = new MavlinkFramer().push(merged);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.msgid).toBe(30);
  });
});

describe("end-to-end: real frames decode into TelemetryState via the shared store", () => {
  it("decodes global_position_int position fields with correct scaling", () => {
    const store = new TelemetryStore();
    const frame = new MavlinkFramer().push(bytes(message("global_position_int").wire_v2_hex))[0]!;
    applyMavlinkFrame(store, frame);
    const state = store.getState();
    expect(state.position.lat).toBeCloseTo(47.3977418, 6);
    expect(state.position.lon).toBeCloseTo(8.5451704, 6);
    expect(state.position.altMsl).toBeCloseTo(500, 3);
    expect(state.position.relativeAlt).toBeCloseTo(120, 3);
    expect(state.position.headingDeg).toBeCloseTo(270, 3);
    expect(state.packetCount).toBe(1);
    expect(state.vehicle.systemId).toBe(1);
  });

  it("decodes a heartbeat as an armed copter", () => {
    const store = new TelemetryStore();
    const frame = new MavlinkFramer().push(bytes(message("heartbeat").wire_v2_hex))[0]!;
    applyMavlinkFrame(store, frame);
    const state = store.getState();
    expect(state.vehicle.armed).toBe(true); // base_mode 0x80 bit
    expect(state.vehicle.type).toBe("Quadrotor");
  });

  it("decodes attitude angles (radians → degrees)", () => {
    const store = new TelemetryStore();
    const frame = new MavlinkFramer().push(bytes(message("attitude").wire_v2_hex))[0]!;
    applyMavlinkFrame(store, frame);
    const state = store.getState();
    expect(state.motion.rollDeg).toBeCloseTo((0.1 * 180) / Math.PI, 3);
    expect(state.motion.pitchDeg).toBeCloseTo((-0.05 * 180) / Math.PI, 3);
  });
});
