import { Readable } from "node:stream";
import type { MavLinkPacket } from "node-mavlink";
import mavlink from "node-mavlink";
import { describe, expect, it } from "vitest";
import { applyMavlinkFrame, TelemetryStore } from "@uav-ground-control-station/shared";
import {
  assertTelemetryPatch,
  hexToBytes,
  loadMavlinkTelemetryPatches,
  messageFixture
} from "@uav-ground-control-station/shared/fixtures/mavlink";

const { createMavLinkStream } = mavlink as typeof import("node-mavlink");

async function parseWireHex(hex: string): Promise<MavLinkPacket[]> {
  return new Promise((resolve, reject) => {
    const input = Readable.from([Buffer.from(hexToBytes(hex))]);
    const stream = createMavLinkStream(input);
    const packets: MavLinkPacket[] = [];
    stream.on("data", (packet) => packets.push(packet));
    stream.on("error", reject);
    input.on("end", () => {
      setTimeout(() => resolve(packets), 0);
    });
  });
}

function dataViewFromBuffer(buffer: Buffer): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("node-mavlink golden fixture parity", () => {
  const patches = loadMavlinkTelemetryPatches().messages;

  for (const [name, patch] of Object.entries(patches)) {
    it(`${name} (v2) node-mavlink → same TelemetryState as shared dispatch`, async () => {
      const fixture = messageFixture(name);
      const packets = await parseWireHex(fixture.wire_v2_hex);
      expect(packets).toHaveLength(1);

      const packet = packets[0]!;
      expect(packet.header.msgid).toBe(fixture.id);

      const store = new TelemetryStore();
      applyMavlinkFrame(store, {
        sysid: packet.header.sysid,
        compid: packet.header.compid,
        msgid: packet.header.msgid,
        payload: dataViewFromBuffer(packet.payload)
      });
      assertTelemetryPatch(store.getState(), patch);

      if (name === "nav_controller_output") {
        expect(store.getState().system.statusText[0]).toMatch(/^NAV:/);
      }
    });
  }
});
