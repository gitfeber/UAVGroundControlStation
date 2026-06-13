import { describe, expect, it } from "vitest";
import { applyMavlinkFrame } from "./mavlinkDispatch.js";
import { TelemetryStore } from "./telemetryStore.js";
import {
  assertTelemetryPatch,
  frameFromWire,
  loadMavlinkTelemetryPatches,
  messageFixture
} from "../fixtures/mavlinkFixtures.js";

describe("applyMavlinkFrame golden fixtures", () => {
  const patches = loadMavlinkTelemetryPatches().messages;

  for (const [name, patch] of Object.entries(patches)) {
    it(`${name} (v2 wire) → expected TelemetryState patch`, () => {
      const fixture = messageFixture(name);
      const store = new TelemetryStore();
      applyMavlinkFrame(store, frameFromWire(fixture.wire_v2_hex, fixture.full_payload_len, "v2"));
      assertTelemetryPatch(store.getState(), patch);

      if (name === "nav_controller_output") {
        expect(store.getState().system.statusText[0]).toMatch(/^NAV:/);
      }
    });

    if (messageFixture(name).wire_v1_hex) {
      it(`${name} (v1 wire) → expected TelemetryState patch`, () => {
        const fixture = messageFixture(name);
        const store = new TelemetryStore();
        applyMavlinkFrame(store, frameFromWire(fixture.wire_v1_hex!, fixture.full_payload_len, "v1"));
        assertTelemetryPatch(store.getState(), patch);

        if (name === "nav_controller_output") {
          expect(store.getState().system.statusText[0]).toMatch(/^NAV:/);
        }
      });
    }
  }
});
