import { describe, expect, it } from "vitest";
import { applyMavlinkFrame, TelemetryStore } from "@uav-ground-control-station/shared";
import {
  assertTelemetryPatch,
  hexToBytes,
  loadMavlinkFixtures,
  loadMavlinkTelemetryPatches,
  messageFixture
} from "@uav-ground-control-station/shared/fixtures/mavlink";
import { MavlinkFramer } from "./mavlinkFramer";
import { CRC_EXTRA, MAX_PAYLOAD_LEN } from "./mavlinkTables";

/**
 * Golden fixtures live in `packages/shared/fixtures/mavlink/` (pymavlink-encoded
 * wire bytes + expected TelemetryState patches). The browser framer must decode
 * the same bytes the Node server and shared dispatch layer consume.
 */
const fixtures = loadMavlinkFixtures();
const patches = loadMavlinkTelemetryPatches().messages;

describe("framer tables match the authoritative pymavlink fixtures", () => {
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
        const frames = new MavlinkFramer().push(hexToBytes(hex));
        expect(frames).toHaveLength(1);
        const frame = frames[0]!;
        expect(frame.msgid).toBe(msg.id);
        expect(frame.sysid).toBe(1);
        expect(frame.compid).toBe(1);
        expect(frame.payload.byteLength).toBe(msg.full_payload_len);
      });
    }
  }
});

describe("MavlinkFramer edge cases", () => {
  it("rejects a frame with a corrupted CRC and counts the error", () => {
    const buf = hexToBytes(messageFixture("heartbeat").wire_v2_hex);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const corruptAt = buf.byteLength - 3;
    view.setUint8(corruptAt, view.getUint8(corruptAt) ^ 0xff);
    const framer = new MavlinkFramer();
    const frames = framer.push(buf);
    expect(frames).toHaveLength(0);
    expect(framer.crcErrors).toBeGreaterThanOrEqual(1);
  });

  it("zero-pads a truncated v2 STATUSTEXT back to full length", () => {
    const frames = new MavlinkFramer().push(hexToBytes(fixtures.truncated_statustext_v2_hex));
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame.msgid).toBe(253);
    expect(frame.payload.byteLength).toBe(54);
    expect(frame.payload.getUint8(0)).toBe(4);
  });

  it("emits every frame from a concatenated multi-message stream in order", () => {
    const frames = new MavlinkFramer().push(hexToBytes(fixtures.stream_v2.hex));
    const expected = fixtures.stream_v2.names.map((n) => messageFixture(n).id);
    expect(frames.map((f) => f.msgid)).toEqual(expected);
  });

  it("reassembles a frame split across two chunks", () => {
    const buf = hexToBytes(messageFixture("heartbeat").wire_v2_hex);
    const framer = new MavlinkFramer();
    expect(framer.push(buf.subarray(0, 4))).toHaveLength(0);
    const frames = framer.push(buf.subarray(4));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.msgid).toBe(0);
  });

  it("resyncs past a garbage prefix to the next valid frame", () => {
    const real = hexToBytes(messageFixture("attitude").wire_v2_hex);
    const junk = new Uint8Array([0x00, 0x11, 0xfe, 0x02, 0xab]);
    const merged = new Uint8Array(junk.length + real.length);
    merged.set(junk, 0);
    merged.set(real, junk.length);
    const frames = new MavlinkFramer().push(merged);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.msgid).toBe(30);
  });
});

describe("end-to-end: browser framer matches golden TelemetryState patches", () => {
  for (const [name, patch] of Object.entries(patches)) {
    it(`${name} (v2) framer + dispatch → golden patch`, () => {
      const fixture = messageFixture(name);
      const store = new TelemetryStore();
      const frame = new MavlinkFramer().push(hexToBytes(fixture.wire_v2_hex))[0]!;
      applyMavlinkFrame(store, frame);
      assertTelemetryPatch(store.getState(), patch);
    });
  }
});
