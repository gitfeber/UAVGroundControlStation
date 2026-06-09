# ADR 0006: Browser Web Serial Cloud Runtime

**Status:** Accepted
**Date:** 2026-06-09

## Context

ADR 0001 established two runtime modes: `desktop` (Tauri/Rust, canonical for CRSF + MAVLink) and `web` (browser UI backed by a Node server, `apps/server`, MAVLink-only for development and fallback). Both read the serial radio from a host process — Rust in desktop, Node in web.

We want a third, hosted offering: a "use it in your browser, no install, no self-host" version of the app. The hard constraint is physical: the operator's USB telemetry radio is attached to the **operator's** machine. A server in a datacenter cannot see that device, so the classic `web` shape (browser UI + server that owns the serial port) cannot work for a hosted product — the server has nothing to read.

Browsers can read local serial devices directly through the **Web Serial API** (`navigator.serial`), which is Chromium-only and requires a secure context (HTTPS or localhost). This makes a serverless, pure-SPA runtime possible: the browser opens the port, frames MAVLink itself, and renders telemetry — no backend in the data path.

This is a genuine application capability, not a hosting trick: any self-hoster can serve the static build and use it without running the Node server. It therefore belongs upstream in the public project, gated behind a build flag, rather than in a private fork.

Two findings shaped the design:

* **Payload decoding is already transport-agnostic.** `TelemetryStore` decodes MAVLink payloads purely from `DataView` byte offsets with no Node dependencies. Only the *framing* (finding frame boundaries, CRC validation, extracting `{sysid, compid, msgid, payload}`) was bound to Node, via `node-mavlink` over a `serialport` stream.
* **A full MAVLink library is not needed in the browser.** The store consumes a small, fixed set of message IDs. The browser only needs a framer that produces validated frames for those messages.

## Decision

Add a third runtime mode, `cloud`, selected at build time by `VITE_LINK=webserial`. `runtimeMode()` resolves to `desktop` under Tauri, else `cloud` when the flag is set, else `web`. The existing `desktop` and `web` paths are unchanged.

**Link layer.** A new `apps/web/src/link/` provides:

* `mavlinkFramer.ts` — a hand-rolled, dependency-free MAVLink v1/v2 framer. It validates the MAVLink X25 checksum (CRC-16/MCRF4XX) with the per-message CRC_EXTRA, zero-pads v2-truncated payloads back to the message's full length, skips the 13-byte v2 signature when present, length-skips message IDs it does not decode, and resyncs byte-by-byte after a bad CRC or false start byte.
* `webSerialLink.ts` — opens a user-selected port via `navigator.serial.requestPort()` (fired only from a user gesture), reads `port.readable`, feeds the framer, and dispatches frames into a `TelemetryStore`. Teardown is handled for explicit disconnect, stream end, mid-read errors (physical unplug), the port `disconnect` event, and tab close, awaiting the read loop so the reader lock is released before the port is closed.
* `webSerialSupport.ts` — detects Web Serial availability and secure context, surfacing a clear fallback notice on Firefox/Safari or plain HTTP.

**Hand-rolled framer over `node-mavlink` + polyfills.** We chose a small pure-TypeScript framer rather than running `node-mavlink` in the browser via Buffer/stream polyfills, or adopting a third-party browser MAVLink library. Rationale: zero new runtime dependencies, no Vite Node-shim configuration, no third-party supply-chain surface in a public project, and full control of the parsing logic. The cost — bundling CRC_EXTRA and full-payload-length tables for the consumed message IDs — is bounded and small. Those tables are generated from pymavlink's authoritative `common` dialect (not hand-asserted) and the framer is tested against real captured frames, so a wrong table value fails the test suite rather than silently dropping a message.

**Shared decode.** `TelemetryStore`, its helpers, and a new `applyMavlinkFrame(store, frame)` dispatcher move from `apps/server` into `packages/shared/src/telemetry/`. The Node server and the browser link now share one decode implementation; the server builds a normalized frame from its `node-mavlink` packet and calls the same dispatcher.

**Scope.** `cloud` is MAVLink-only (CRSF is desktop/Rust-only and out of scope), sends no wake-up bytes, defaults to 115200 baud (MAVLink-direct USB FC; 420000 is CRSF/desktop), stores nothing server-side, and offers no persistent logging in v1. The connect UI hides the port list and logging controls and relies on the browser's own device picker.

## Consequences

Positive consequences:

* A hosted, zero-install browser app becomes possible without a server in the data path.
* Self-hosters can run the static build without the Node server.
* One MAVLink decode implementation is shared by server and browser.
* No new runtime dependencies and no Vite polyfills; the bundle stays clean.
* The framer is validated against real pymavlink-encoded frames.

Tradeoffs:

* `cloud` works only in Chromium-based browsers over HTTPS; Firefox and Safari get a fallback notice, not telemetry.
* Two MAVLink framers now exist — `node-mavlink` on the server, the hand-rolled framer in the browser — which can drift (see Future implications).
* The framer's CRC_EXTRA / length tables cover only the consumed message IDs; other messages are length-skipped without CRC validation.
* No persistent telemetry logging in the browser runtime in v1.

Future implications:

* The hand-rolled framer could also consume the server's `serialport` byte stream, retiring `node-mavlink` for one framer and one fewer dependency. Deferred; recorded here so the two paths do not silently diverge.
* Accounts and telemetry persistence (a private backend the SPA uploads to) are a later, separate decision. The link layer and telemetry store are decoupled so an upload "sink" can be added without touching decode.
* For commercial scale, map tiles must move from the OSM raster fallback to a keyed provider (`VITE_MAP_STYLE_URL`).

## Constraints

The `cloud` runtime must remain client-side and serverless in v1. It must never:

* send telemetry, GPS, or any captured data off the browser
* require a backend in the telemetry data path
* send CRSF, claim CRSF support, or send wake-up bytes
* read serial outside a user-granted Web Serial port
* leave a serial reader lock or open port behind on disconnect, unplug, or tab close

Serial input must be treated as untrusted: malformed or hostile bytes must not crash the framer, and unknown or corrupt frames must be dropped without desynchronising the stream beyond the next valid frame.
