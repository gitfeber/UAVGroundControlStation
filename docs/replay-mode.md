# Replay & Simulation Mode

Replay and Simulation are **frontend-only, read-only** telemetry sources that drive
the existing dashboard (map, HUD, sidebar, activity log) without any hardware.
See [ADR 0003](adr/0003-frontend-only-replay-simulation.md) for the architecture
decision and constraints.

> **Safety:** Replay and Simulation never open serial ports, never send MAVLink/CRSF
> commands, wake-up bytes, or stream requests, and never control the aircraft. They
> are display-only. Live telemetry keeps running untouched in the background.

## Source modes

The Topbar has a **Live / Replay / Simulation** segmented control and a persistent
colored badge. Only one source drives the visible dashboard at a time.

| Mode | Badge | Data source | Banner |
|------|-------|-------------|--------|
| **Live** | green `LIVE` | Real serial telemetry (desktop/Node) | none |
| **Replay** | amber `REPLAY` | A recorded `.jsonl` / `.json` log | "REPLAY MODE — displaying recorded telemetry, not live vehicle data" |
| **Simulation** | purple `SIMULATION` | Deterministic synthetic telemetry | "SIMULATION MODE — displaying synthetic telemetry, not live vehicle data" |

When a non-live mode is active:

- The dashboard shows a loud banner and a tinted inset border.
- Live serial controls (port/baud, Refresh, Connect, Disconnect, Reset, Start/Stop
  Log) are **disabled and guarded** — they cannot mutate the live session.
- If a live serial link is open, a **"Live connected in background"** notice appears;
  the link stays open and untouched. Switching back to **Live** immediately shows the
  latest live telemetry again.

Nothing persists across a page/app reload: on boot the app resets to **Live**, idle,
with no loaded file. If playback was interrupted by a reload, the activity log shows
a one-time "Previous playback was reset due to app reload." notice.

## Replay

1. Switch the Topbar to **Replay**.
2. In the **Replay controls** panel, pick a `.jsonl` or `.json` telemetry log.
3. Review the metadata summary (event counts, duration, GPS/Battery/Radio/Attitude),
   then use the transport controls.

File size guards (in-memory parsing, no streaming in v1):

- **> ~25 MB** — a warning is shown but the file still loads.
- **> ~100 MB** — the file is refused.

### Transport controls

- **Start / Pause / Resume / Stop / Restart / Step**
- **Seek bar** with current time / duration.
- **Speed:** `0.25× … 10×` and `Max`.
- **Timing mode:**
  - `Original` — apply events at their recorded timestamps.
  - `Fixed rate` — ignore recorded gaps; emit at the selected Hz (5/10/20/50).
  - `Manual` — no auto-advance; only **Step** moves forward.
  - `Max` — process as fast as possible in capped chunks per frame.

Seeking and Restart rebuild telemetry and the map track **deterministically** from
the start of the log, so the same log always produces the same displayed state and
the track never duplicates.

## Simulation

1. Switch the Topbar to **Simulation**.
2. Choose a scenario, optional seed/duration/rate, then **Generate & play**.

Simulation pre-generates a bounded, **seeded deterministic** `ReplayEvent[]` and feeds
it through the same replay engine — the same seed and options always produce the same
flight. Scenarios:

| Scenario | Behavior |
|----------|----------|
| **Nominal flight** | Stable link, steady battery drain, good GPS. |
| **Weak radio link** | Degrading RSSI, link-quality dropouts, rising RX errors. |
| **GPS degradation** | Satellites/fix decline; emits a "GPS fix degraded" event. |
| **Low battery approach** | Fast drain; emits a "Battery low" warning. |

Defaults: ~4 minutes, 20 Hz, fixed default seed. PRNG is an inline `mulberry32`
(no dependency, no wall-clock reads).

## Log format

Live log writers (Rust desktop + Node) emit **JSONL schema v1** so newly recorded
logs replay without conversion. One JSON event per line:

```json
{"schemaVersion":1,"ts":1710000000000,"relativeMs":0,"source":"live","type":"telemetry","state":{ /* TelemetryState */ }}
```

- `ts` — wall-clock ms. `relativeMs = ts - sessionStartMs`.
- `type` — `telemetry` | `partialTelemetry` | `activity` | `diagnostic` | `marker`.
- `state` — full `TelemetryState`; `partialTelemetry` carries a deep-merge `patch`.

A **JSON manifest** form is also accepted:

```json
{ "schemaVersion": 1, "events": [ { "relativeMs": 0, "type": "telemetry", "state": {} } ] }
```

### Parser tolerance (untrusted input)

The parser treats every file as untrusted and never crashes on bad input:

- Ignores empty lines and `#` comments; accepts `ts`, `timestamp`, or `relativeMs`.
- Preserves event order; does **not** sort non-monotonic timestamps.
- Assigns a synthetic 20 Hz timeline when no timestamps are present.
- Skips malformed lines (warning counter) and unknown event types (skipped counter).
- Reads **legacy** `{ "time": …, "type": "telemetry", "data": {} }` logs and bare
  `TelemetryState` lines best-effort.
- Drops `NaN`/`Infinity` and out-of-range GPS (lat ∉ [-90, 90], lon ∉ [-180, 180])
  without wiping existing fields.
- Loads if at least one usable event exists; otherwise shows a helpful error.

## Privacy & security

- Replay logs may contain **GPS / location data**. Treat them as sensitive.
- Logs are read and parsed **entirely in the browser**; nothing is uploaded and log
  contents are never executed.
- Raw file text is read into a local only and released after parsing — it is never
  stored in React state. The UI shows only the file name, not the full local path.

## Diagnostics

Replay/Simulation diagnostics (event index, emitted/skipped counts, parse warnings,
average emit rate) are shown only in the Replay/Simulation panel and are kept
**separate** from live `BackendStatus`. Replay/simulation activity log lines are tagged
`[REPLAY]` / `[SIM]` and merged into the shared Activity Log.

## Testing

Replay/simulation logic is pure TypeScript and tested with Vitest (no DOM, no Tauri,
no hardware):

```bash
pnpm --filter @uav-ground-control-station/web test
```

Coverage spans the parser, scheduler core, state reconstruction, controlled-track
rebuild, and the simulation generator.
