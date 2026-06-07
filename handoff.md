# Handoff — Replay & Simulation Mode

**Date:** 2026-06-07
**Target branch:** `feature/replay-simulation-mode`
**Status:** Design locked, implementation not started

## Objective

Implement a **Replay & Simulation Mode** for this UAV Ground Control Station.

Replay Mode loads recorded telemetry logs and replays them through the existing dashboard as if they were live telemetry.

Simulation Mode generates deterministic synthetic telemetry and feeds it through the same replay engine.

The feature is strictly read-only:

* no serial writes
* no MAVLink commands
* no CRSF commands
* no stream requests
* no wake-up bytes
* no aircraft control
* no cloud upload
* no remote replay streaming

Primary goals:

* Reproduce telemetry/UI bugs without hardware.
* Demo the app without TX16S, ELRS, flight controller, or serial device.
* Validate map, HUD, sidebar, activity log, and telemetry-state behavior deterministically.
* Keep the live telemetry path stable and unchanged where possible.

Non-goals:

* no mission planning
* no parameter editor
* no cloud sync
* no fleet/multi-UAV support
* no video replay
* no command replay
* no backend replay engine

## Authoritative artifacts

Read these before implementation:

* `docs/adr/0003-frontend-only-replay-simulation.md`
* `docs/adr/0001-dual-runtime-desktop-canonical.md`
* `CONTEXT.md`
* this handoff file

ADR 0003 is the architecture decision for this feature. Do not re-argue the layer decision unless implementation proves it impossible.

## Codebase map

Repo structure:

* `apps/desktop` — Tauri/Rust, canonical live CRSF + MAVLink path
* `apps/server` — Node/Fastify MAVLink-only dev/fallback runtime
* `apps/web` — React + Vite + TypeScript + Tailwind + MapLibre UI
* `packages/shared` — shared telemetry contracts and API types

Important files:

* `packages/shared/src/index.ts`

  * owns `TelemetryState`
  * add replay/source-mode types here
  * add `REPLAY_LOG_SCHEMA_VERSION = 1` here

* `apps/web/src/hooks/useTelemetry.ts`

  * existing live telemetry hook
  * currently returns live `telemetry`, `status`, `loggingStatus`, `ports`, `logs`, `error`, `wsConnected`, `runtimeMode`, and actions
  * do not change live behavior unless strictly required

* `apps/web/src/App.tsx`

  * currently wires dashboard components
  * switch this from `useTelemetry()` to new wrapper `useTelemetrySource()`

* `apps/web/src/components/Topbar.tsx`

  * existing port/baud/connect/disconnect/reset/log controls
  * add source selector and mode badge here

* `apps/web/src/components/MapPanel.tsx`

  * owns internal appended track state today
  * add optional controlled track support for replay/simulation

* `apps/web/src/components/ActivityLogPanel.tsx`

  * keep component mostly unchanged
  * feed it merged live + replay/sim logs from wrapper

* `apps/desktop/src-tauri/src/lib.rs`

  * update existing Rust live log writer to new replay-compatible JSONL schema
  * Rust build may not be possible locally due to missing MSVC linker

* `apps/server/src/services/loggerService.ts`

  * update existing Node live log writer to new replay-compatible JSONL schema

Current test situation:

* Rust has inline `cargo test`
* frontend currently has no dedicated test runner
* add Vitest to `apps/web`

Validation commands expected to run locally:

```bash
pnpm typecheck
pnpm -r lint
pnpm --filter @uav-ground-control-station/web test
```

Rust validation is deferred to CI/user if local environment cannot link/build desktop.

## Locked implementation decisions

### 1. Layer

Replay and Simulation are implemented 100% in `apps/web` TypeScript.

Do not implement replay/simulation playback in Rust or Node.

Allowed backend-adjacent change:

* update Rust and Node live log writers to emit replay-compatible JSONL

Not allowed:

* Rust replay parser
* Node replay parser
* backend replay WebSocket
* Tauri file dialog plugin
* native file streaming
* serial involvement in replay/simulation

### 2. File IO

Use frontend browser File API only.

Required import control:

```html
<input type="file" accept=".jsonl,.json" />
```

Read files with:

```ts
await file.text()
```

Size guards:

* warn above approximately 25 MB
* hard-refuse above approximately 100 MB

Implementation requirements:

* do not keep raw file text in React state
* release raw file text references as soon as parsing is complete
* store only normalized events, metadata, parse warnings, and controller state
* do not expose full local file paths in UI
* treat replay files as untrusted input

No streaming parser in v1.

### 3. State wiring

Create a new wrapper hook:

```ts
useTelemetrySource()
```

The wrapper must:

* call existing `useTelemetry()` internally for live mode
* own `activeSourceMode`
* own replay controller state
* own simulation controller state
* own replay/simulation logs
* compute active/displayed telemetry from source mode
* return active telemetry under the existing `telemetry` name
* expose replay controls
* expose simulation controls
* expose source mode controls
* expose replay/simulation diagnostics

Do not introduce Redux, Zustand, or a new app-wide context unless already present and clearly necessary.

Required source mode type:

```ts
export type TelemetrySourceMode = "live" | "replay" | "simulation";
```

Displayed telemetry selector:

```ts
const activeTelemetry =
  activeSourceMode === "live"
    ? liveTelemetry
    : activeSourceMode === "replay"
      ? replayTelemetry
      : simulationTelemetry;
```

Keep live, replay, and simulation telemetry internally separate.

Only one source mode may drive the visible dashboard at a time.

### 4. Mode switch while live serial is connected

When switching from Live to Replay/Simulation while live serial is connected:

* do not auto-disconnect
* keep live telemetry hook running in the background
* live telemetry may continue updating hidden `liveTelemetry`
* displayed dashboard telemetry must come only from replay/simulation
* disable or guard live controls that mutate the live session:

  * connect
  * disconnect
  * reset
  * logging toggle
  * serial config changes
* show notice: `Live connected in background`
* never trigger serial writes, wake-up bytes, stream requests, reconnect logic, or hardware output
* switching back to Live must immediately show latest live telemetry again

### 5. Map track control

`MapPanel` currently owns internal track state by appending GPS positions on telemetry changes.

Add controlled track support.

Suggested props:

```ts
type TrackPoint = {
  lat: number;
  lon: number;
  timestampMs?: number;
};

controlledTrack?: TrackPoint[];
trackMode?: "internal" | "controlled";
```

Behavior:

* Live mode:

  * do not pass `controlledTrack`
  * `MapPanel` behaves exactly as today
  * internal append-on-change track remains unchanged

* Replay/Simulation mode:

  * wrapper/controller passes `controlledTrack`
  * `MapPanel` renders exactly the controlled array
  * `MapPanel` must not append to internal track when controlled
  * seek/restart rebuilds track deterministically from events up to selected event/time
  * invalid GPS points are skipped
  * consecutive duplicate timestamp/lat/lon points are deduplicated

Acceptance:

* seeking backward/forward does not duplicate track points
* restart produces the same track every time
* live track behavior remains unchanged

### 6. Simulation model

Simulation is implemented by pre-generating a bounded deterministic `ReplayEvent[]`.

Do not build a separate realtime simulation scheduler.

Simulation inputs:

* scenario
* seed
* durationMs
* rateHz
* optional startLat/startLon

Defaults:

* duration: 3–5 minutes
* rate: 20 Hz
* seed: deterministic default
* PRNG: inline `mulberry32` or `xorshift32`, no dependency

Simulation scenarios:

* `Nominal flight`
* `Weak radio link`
* `GPS degradation`
* `Low battery approach`

Simulation metadata:

```ts
{
  fileName: "Simulation: <scenario>",
  source: "simulation",
  schemaVersion: 1
}
```

Simulation must feed generated events into the same replay controller used for log replay.

Simulation mode UI:

* hide replay file picker
* show scenario selector
* show seed/duration/rate controls if simple
* show transport controls
* show diagnostics

### 7. Log schema

Define in shared:

```ts
export const REPLAY_LOG_SCHEMA_VERSION = 1;
```

Update both existing live log writers:

* Rust/Desktop writer
* Node writer

New JSONL telemetry event shape:

```json
{
  "schemaVersion": 1,
  "ts": 1710000000000,
  "relativeMs": 1234,
  "source": "live",
  "type": "telemetry",
  "state": {}
}
```

Rules:

* `relativeMs = ts - sessionStartMs`
* `source = "live"` for live recordings
* `type = "telemetry"` for telemetry entries
* do not change log file location
* do not change start/stop logging UX
* newly recorded logs must replay without conversion

Parser must also support legacy best-effort:

```json
{"time":1710000000000,"type":"telemetry","data":{}}
```

Plain `TelemetryState` JSONL lines should also be treated as telemetry if recognizable.

### 8. Frontend tests

Add Vitest to `apps/web`.

Requirements:

* add `vitest` as dev dependency
* add script in `apps/web/package.json`:

```json
{
  "test": "vitest run"
}
```

* tests live next to replay source files as `*.test.ts`
* fixtures live under:

```text
apps/web/src/replay/__fixtures__/
```

Test pure TypeScript only:

* parser
* controller/scheduler core
* state reconstruction
* simulation generator
* controlled-track reconstruction

Do not add:

* React Testing Library unless component tests are actually implemented
* Playwright
* Cypress
* DOM-heavy test setup
* Tauri runtime dependency
* hardware dependency

### 9. Scheduler architecture

Implement scheduler as:

* pure timer-free core
* thin `requestAnimationFrame` driver

Pure core must contain no:

* React state
* timers
* DOM APIs
* `requestAnimationFrame`
* real wall-clock reads

Suggested pure functions:

```ts
advanceTo(virtualMs)
stepOnce()
seekTo(targetMs)
reset()
```

These functions should return:

```ts
{
  nextState,
  eventsToApply,
  currentEventIndex,
  currentReplayTimeMs,
  ended
}
```

Driver behavior:

* use `requestAnimationFrame`
* compute virtual time from wall time and speed multiplier
* batch at most one React state commit per animation frame where practical
* cancel rAF on pause, stop, mode switch, unmount, reload, and file reload
* prevent duplicate rAF loops on rapid clicks

Timing modes:

* `original`

  * apply events with timestamp <= virtual time

* `fixedRate`

  * ignore original gaps
  * emit at selected Hz

* `manual`

  * no rAF auto-advance
  * only Step advances

* `Max`

  * process capped chunks per frame
  * default cap should be in the 500–2000 events/frame range
  * yield to UI between chunks
  * always apply final event when ending

Tests must call pure core directly with synthetic timestamps. Do not rely on fake timers.

### 10. UI layout

Topbar:

* add segmented control:

  * `Live`
  * `Replay`
  * `Simulation`

* add persistent badge:

  * `LIVE`
  * `REPLAY`
  * `SIMULATION`

Suggested colors:

* Live: green
* Replay: amber
* Simulation: purple

Replay/Simulation panel:

* new collapsible panel
* use existing `ActivityLogPanel` style
* visible when source mode is Replay or Simulation

Replay panel contents:

* file input
* metadata summary
* start/pause/resume/stop/restart/step controls
* seek bar
* current time / duration
* speed selector
* timing mode selector
* fixed-rate selector
* diagnostics

Simulation panel contents:

* scenario selector
* seed/duration/rate controls if simple
* start/pause/resume/stop/restart controls
* seek bar if applicable
* diagnostics

Loud non-live marking:

When source mode is Replay:

```text
REPLAY MODE — displaying recorded telemetry, not live vehicle data
```

When source mode is Simulation:

```text
SIMULATION MODE — displaying synthetic telemetry, not live vehicle data
```

Display this as a persistent banner or tinted border around/above the main dashboard area.

Live mode:

* no banner
* no tinted dashboard border
* existing layout should remain visually unchanged

### 11. Activity log and diagnostics

Do not change how `useTelemetry()` stores live logs unless strictly required.

Wrapper owns:

```ts
replaySimLogs: ActivityLogEntry[]
```

Replay/simulation lifecycle events are written only to `replaySimLogs`.

Expose merged logs to existing `ActivityLogPanel`:

```ts
mergedLogs = merge(liveLogs, replaySimLogs)
```

Rules:

* sort by timestamp/id
* cap to existing limit or 200 entries
* tag all replay/simulation entries:

  * `[REPLAY] File loaded`
  * `[REPLAY] Started`
  * `[REPLAY] Paused`
  * `[REPLAY] Resumed`
  * `[REPLAY] Seeked to 01:23`
  * `[REPLAY] Stopped`
  * `[REPLAY] Ended`
  * `[REPLAY] Error: ...`
  * `[SIM] Started: Nominal flight`
  * `[SIM] Paused`
  * `[SIM] Stopped`
  * `[SIM] Ended`

Clear behavior:

* if the existing live hook already exposes a clear-log action, wrapper clear should call it and also clear `replaySimLogs`
* if not, do not modify live internals only for this; clear only `replaySimLogs` and leave existing live log behavior unchanged

Diagnostics:

* `ReplayDiagnostics` is separate
* show it only in the replay/simulation panel
* never write replay/simulation diagnostics into live `BackendStatus`
* live parser/serial diagnostics remain unchanged

### 12. Reload behavior

Persist no replay/simulation state across reload.

On boot:

* reset source mode to Live
* replay controller is idle
* simulation controller is idle
* replay telemetry is cleared
* simulation telemetry is cleared
* controlled replay/simulation track is cleared
* loaded replay file is not restored
* file handles are not restored

Optional reload notice:

* while replay/simulation is actively playing, set a transient `sessionStorage` marker
* clear it on clean stop/end
* on boot, if marker exists, clear it and emit activity entry:

```text
[REPLAY/SIM] Previous playback was reset due to app reload.
```

Do not implement fragile rehydration.

## Required shared types

Add or adapt these in `packages/shared`.

```ts
export const REPLAY_LOG_SCHEMA_VERSION = 1;

export type TelemetrySourceMode = "live" | "replay" | "simulation";

export type ReplayStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type ReplayTimingMode = "original" | "fixedRate" | "manual";

export type ReplaySpeedMode =
  | 0.25
  | 0.5
  | 1
  | 2
  | 5
  | 10
  | "max";

export type ReplayEventType =
  | "telemetry"
  | "partialTelemetry"
  | "activity"
  | "diagnostic"
  | "marker"
  | "unknown";

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ReplayLogEventBase {
  schemaVersion?: number;
  ts?: number;
  timestamp?: number;
  relativeMs?: number;
  source?: string;
  type?: ReplayEventType | string;
}

export interface ReplayTelemetryEvent extends ReplayLogEventBase {
  type: "telemetry";
  state: TelemetryState;
}

export interface ReplayPartialTelemetryEvent extends ReplayLogEventBase {
  type: "partialTelemetry";
  patch: DeepPartial<TelemetryState>;
}

export interface ReplayActivityEvent extends ReplayLogEventBase {
  type: "activity";
  level?: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface ReplayDiagnosticEvent extends ReplayLogEventBase {
  type: "diagnostic";
  stats: Record<string, unknown>;
}

export interface ReplayMarkerEvent extends ReplayLogEventBase {
  type: "marker";
  label: string;
  description?: string;
}

export type ReplayLogEvent =
  | ReplayTelemetryEvent
  | ReplayPartialTelemetryEvent
  | ReplayActivityEvent
  | ReplayDiagnosticEvent
  | ReplayMarkerEvent;

export interface ReplayLogMetadata {
  fileName: string;
  fileSizeBytes: number;
  schemaVersion?: number;
  eventCount: number;
  telemetryEventCount: number;
  partialTelemetryEventCount: number;
  activityEventCount: number;
  diagnosticEventCount: number;
  skippedEventCount: number;
  parseWarningCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  durationMs: number;
  hasGps: boolean;
  hasBattery: boolean;
  hasRadio: boolean;
  hasAttitude: boolean;
}

export interface ReplayDiagnostics {
  status: ReplayStatus;
  sourceMode: TelemetrySourceMode;
  currentEventIndex: number;
  currentReplayTimeMs: number;
  durationMs: number;
  emittedTelemetryEvents: number;
  emittedActivityEvents: number;
  emittedDiagnosticEvents: number;
  skippedEvents: number;
  parseWarnings: number;
  lastError: string | null;
  averageEmitRateHz: number;
}

export interface ReplayControllerState {
  sourceMode: TelemetrySourceMode;
  status: ReplayStatus;
  timingMode: ReplayTimingMode;
  speedMultiplier: ReplaySpeedMode;
  fixedRateHz: 5 | 10 | 20 | 50;
  currentEventIndex: number;
  currentReplayTimeMs: number;
  durationMs: number;
  loadedFileName: string | null;
  metadata: ReplayLogMetadata | null;
  lastError: string | null;
  diagnostics: ReplayDiagnostics;
}

export type SimulationScenario =
  | "nominalFlight"
  | "weakRadioLink"
  | "gpsDegradation"
  | "lowBatteryApproach";

export interface SimulationOptions {
  scenario: SimulationScenario;
  seed: number;
  durationMs: number;
  rateHz: number;
  startLat?: number;
  startLon?: number;
}
```

Adjust exact field names if current repo conventions require it, but preserve the concepts.

## Replay parser requirements

Supported formats:

### JSONL

Each non-empty line is one event.

Supported examples:

```json
{"schemaVersion":1,"ts":1710000000000,"relativeMs":0,"type":"telemetry","state":{}}
{"schemaVersion":1,"ts":1710000000050,"relativeMs":50,"type":"partialTelemetry","patch":{}}
{"schemaVersion":1,"ts":1710000000100,"relativeMs":100,"type":"activity","level":"info","message":"Telemetry started"}
{"schemaVersion":1,"ts":1710000000150,"relativeMs":150,"type":"diagnostic","stats":{}}
```

### JSON manifest

```json
{
  "schemaVersion": 1,
  "events": [
    {"relativeMs":0,"type":"telemetry","state":{}}
  ]
}
```

Parser behavior:

* ignore empty lines
* ignore lines starting with `#`
* accept `ts`, `timestamp`, or `relativeMs`
* preserve event order
* do not sort non-monotonic timestamps
* if timestamps are missing, assign synthetic monotonic timestamps at default 20 Hz
* skip malformed lines and increment warning count
* skip unknown event types and increment skipped count
* support legacy `{time,type,data}`
* support plain `TelemetryState` lines best-effort
* do not crash on invalid fields
* load if at least one usable event exists
* show helpful error if no usable events exist

## State reconstruction requirements

Event handling:

* `telemetry`

  * replace replay telemetry state

* `partialTelemetry`

  * deep-merge patch into current replay telemetry state

* `activity`

  * append tagged replay/simulation activity entry

* `diagnostic`

  * update replay diagnostics only

* legacy plain telemetry

  * treat as full telemetry state

Validation:

* ignore `NaN`
* ignore `Infinity`
* ignore invalid GPS latitude outside `-90..90`
* ignore invalid GPS longitude outside `-180..180`
* missing fields must not wipe existing fields during patch application
* unknown fields must not crash the UI

Acceptance:

* same log produces same displayed state every time
* seek backward/forward reconstructs correct state
* seek/restart does not duplicate map track
* bad partial patches do not crash UI

## Error handling and edge cases

Handle explicitly:

* no file selected
* empty file
* unsupported extension
* malformed JSONL lines
* unknown event types
* no usable telemetry events
* missing timestamps
* huge timestamp gaps
* non-monotonic timestamps
* very large files
* invalid GPS coordinates
* missing GPS data
* missing battery data
* missing radio data
* invalid numeric fields
* pause when not playing
* resume when not paused
* seek before start
* seek after end
* step at end
* switching modes while playing
* live serial connected when entering replay/simulation
* app/window reload during playback
* repeated rapid button clicks

Required behavior:

* never crash the UI from bad replay input
* prefer graceful skip plus warning counter
* clamp seek positions
* make controller actions idempotent where practical
* clean up timers/rAF on stop, mode switch, unmount, file reload
* warn/refuse large files instead of freezing UI

Security/privacy:

* logs may contain GPS coordinates
* document privacy warning
* never upload logs
* never execute log contents
* do not expose full local paths unnecessarily
* treat all replay files as untrusted input

## Suggested implementation order

### 1. Shared types

* add replay/source-mode types
* export them from shared package
* add `REPLAY_LOG_SCHEMA_VERSION = 1`

### 2. Vitest setup

* add Vitest to `apps/web`
* add test script
* add replay fixture directory
* confirm basic test runs

### 3. Parser

* implement JSONL/JSON parser
* normalize events
* extract metadata
* support legacy logs
* add parser fixtures and tests

### 4. Scheduler core

* implement pure scheduler functions
* implement original/fixed/manual/max behavior
* add tests using synthetic timestamps

### 5. State reconstruction

* implement full state replacement
* implement deep merge for partial telemetry
* validate unsafe values
* implement deterministic controlled-track reconstruction
* add tests

### 6. Replay controller/hook internals

* create replay controller state
* implement load/start/pause/resume/stop/restart/seek/step
* add rAF driver
* ensure cleanup/idempotency

### 7. `useTelemetrySource`

* wrap existing `useTelemetry()`
* add source mode state
* keep live/replay/sim telemetry separate
* expose active telemetry as `telemetry`
* merge logs
* expose diagnostics and controls

### 8. Map controlled track

* add optional controlled track props
* keep live internal track unchanged
* use controlled track for replay/sim

### 9. Simulation

* implement deterministic event generator
* add scenarios
* feed generated events into replay controller
* add tests

### 10. UI

* add Topbar selector and badge
* add replay/simulation panel
* add non-live banner/border
* guard serial controls while replay/sim active
* show live-connected-in-background notice

### 11. Log writers

* update Rust writer schema
* update Node writer schema
* keep legacy parser support
* do not change log file locations or UX

### 12. Docs

* add `docs/replay-mode.md`
* update README feature list
* document log format
* document privacy warning
* document Live vs Replay vs Simulation behavior

### 13. Validation

Run:

```bash
pnpm typecheck
pnpm -r lint
pnpm --filter @uav-ground-control-station/web test
```

Rust/Desktop build may be deferred if local environment lacks linker.

## Acceptance checklist

Feature is complete when:

* Live mode still works as before.
* Replay mode loads `.jsonl` and `.json` logs.
* Newly recorded live logs can be replayed.
* Legacy logs are best-effort replayable.
* Invalid lines do not crash the app.
* Metadata appears before playback.
* Replay supports start, pause, resume, stop, restart, step, seek.
* Speed modes work.
* Original/fixed/manual/max timing modes work.
* Seeking does not duplicate map track.
* Simulation starts without hardware or file.
* Simulation is deterministic from seed.
* Replay and simulation are clearly marked as non-live.
* Serial controls are guarded in Replay/Simulation.
* Replay/Simulation never send serial output.
* Activity log shows tagged replay/simulation lifecycle entries.
* Replay diagnostics are separate from live `BackendStatus`.
* Reload resets to Live/idle.
* Tests cover parser, scheduler, reconstruction, simulation, and controlled track.
* Docs are updated.
