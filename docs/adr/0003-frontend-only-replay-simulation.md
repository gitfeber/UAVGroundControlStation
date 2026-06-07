# ADR 0003: Frontend-only Replay and Simulation Mode

**Status:** Accepted
**Date:** 2026-06-07

## Context

Live telemetry is owned by the runtime-specific path: `apps/desktop` is canonical for CRSF + MAVLink through Tauri/Rust, with `apps/server` as the Node-based MAVLink-only development and fallback runtime. This is documented in ADR 0001.

Replay and Simulation are different from live telemetry. They are pure data sources:

* Replay loads a previously recorded telemetry log.
* Simulation generates deterministic synthetic telemetry.
* Neither mode must ever open, write to, or request anything from a serial port.
* Neither mode must send MAVLink, CRSF, wake-up bytes, stream requests, commands, or any other hardware-facing output.

The feature must work identically in the Tauri desktop webview and in the browser development stack. Maintaining duplicate Rust and Node replay implementations would increase complexity and create runtime divergence for a feature that does not need native access in v1.

This development environment also lacks an MSVC linker, so Rust/Desktop changes cannot be fully built or verified locally. Frontend TypeScript changes can be implemented and tested here.

## Decision

Implement Replay and Simulation playback entirely in `apps/web` TypeScript.

Replay logs are imported with the browser File API:

```html
<input type="file" accept=".jsonl,.json" />
```

Files are read via `File.text()` and guarded by size caps instead of native streaming in v1:

* warn for files larger than approximately 25 MB
* hard-refuse files larger than approximately 100 MB

A new wrapper hook, `useTelemetrySource()`, owns:

* `activeSourceMode`
* replay controller state
* simulation controller state
* replay/simulation activity entries
* replay/simulation diagnostics

The wrapper calls the existing live `useTelemetry()` hook internally and derives the displayed `activeTelemetry` from the currently selected source mode.

The existing live telemetry path remains unchanged except for strictly necessary integration points. Live telemetry continues to be produced by the current runtime-specific implementation.

Replay and simulation diagnostics are kept separate from live `BackendStatus`.

Simulation reuses the replay engine by pre-generating a deterministic, seeded `ReplayEvent[]`. The generated event list is fed into the same replay controller used for log replay.

Shared replay/source-mode types and `REPLAY_LOG_SCHEMA_VERSION` live in `packages/shared`.

Replay and simulation playback remain frontend-only. The only backend-adjacent change is that existing live log writers in Rust and Node should emit the new replay-compatible JSONL schema so future live recordings can be replayed without conversion. This does not make backend runtimes responsible for replay playback.

## Consequences

Positive consequences:

* One replay/simulation implementation works in both Tauri desktop and browser dev mode.
* No Rust or Node replay engine is required.
* No Rust rebuild is required for replay/simulation playback logic.
* The existing live telemetry path remains stable.
* Replay/simulation can iterate quickly in frontend TypeScript.
* Simulation and replay share one deterministic engine.
* Replay/simulation can be tested with Vitest without hardware, Tauri, serial ports, or native runtime setup.

Tradeoffs:

* Replay deliberately bypasses the canonical Rust/Node live telemetry path.
* The backend never observes replayed or simulated telemetry.
* Replay/simulation and live telemetry diverge by design.
* Large-file handling is bounded by in-memory frontend parsing instead of native streaming.
* The file picker is web-style, not a native OS dialog.
* `File.text()` temporarily holds the raw file text in memory. The implementation must release raw file text references as early as possible and must not store the original file text in React state.

Future implications:

* If huge logs become a real requirement, a future ADR may move file reading, indexing, or streaming into Rust.
* If native OS file dialogs become important, a future ADR may add a Tauri dialog plugin.
* If replayed telemetry must be observable by backend tooling, a future ADR may define an explicit backend replay transport. That is out of scope for v1.

## Constraints

Replay and Simulation must remain read-only.

They must never:

* open serial ports
* disconnect live serial automatically
* write to serial ports
* emit MAVLink commands
* emit CRSF commands
* send wake-up bytes
* request telemetry streams
* trigger reconnect logic
* control the aircraft
* upload logs
* execute log contents

Replay files must be treated as untrusted input. Logs may contain sensitive GPS/location data.
