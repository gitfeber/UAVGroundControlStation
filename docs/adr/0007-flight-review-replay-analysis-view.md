# ADR 0007: Flight Review as Replay Analysis View

**Status:** Accepted
**Date:** 2026-06-13

## Context

Operators want post-flight analysis over recorded telemetry — summary stats, detected issues, a colored path, synchronized graphs, and click-to-seek findings — not just dashboard replay scrubbing.

The obvious shape is a fourth topbar **source mode** (`Live / Replay / Simulation / Debrief`). That mixes **what produces telemetry** with **how it is presented**, duplicates replay runtime concerns, and invites simulation logs to be treated as operational flight records.

The app already has frontend-only replay (ADR 0003): parser, replay engine, seek/scrub, controlled track, and JSONL logs that today record mostly `telemetry` events. Preflight thresholds (ADR 0004) cover live advisory checks but are not a post-flight analysis contract. Target-estimation and link-layer events (parser errors, serial reconnects, DEM rejections) are not written to live replay logs in v1.

## Decision

**Flight review** is an **active view** over a loaded **replay log**, not a new source mode.

- `sourceMode` stays `live | replay | simulation`.
- `activeView` is `dashboard | flightReview`.
- `flightReview` is available only when `sourceMode === "replay"` and a replay log is loaded. **Simulation is excluded in MVP.**
- Entry is manual via **Open Flight Review**; never auto-open on file load. Entry opens **paused** at the current replay position (or `t = 0`).
- Flight review **replaces** the main dashboard content (sidebar, camera, replay panel hidden). Topbar keeps the replay badge, filename, and **Back to dashboard**.
- Flight review shares the **same replay controller clock** as dashboard replay (`currentReplayTimeMs`, play/pause, `seekTo`). Timeline, graphs, findings, and map markers all seek through that single engine. `deriveFlightReview()` runs once after load; seeking only moves the shared clock.

Analysis is **frontend-only** in `apps/web` for MVP (`apps/web/src/flightReview/`). One pure function:

`deriveFlightReview(records, thresholds) → { summary, findings, fullStats, renderSeries, renderPath, pathColorModes, metadata }`

**Findings (MVP):** derived from `telemetry` replay events only — never guessed. Use **session home (first fix)** (first valid lat/lon in the log) for distance stats; recompute summary stats from the stream; do not trust embedded `stats.*` or dashboard **home reference**. Stale gaps use consecutive log timestamps (`relativeMs` / `ts`), not `sampledAtMs`. Wording: "No telemetry log entry for X ms."

**Findings (v1.1):** consume logged `activity`, `diagnostic`, and `marker` replay events after live logging enrichment. Missing buckets show as **not recorded**.

**Thresholds:** dedicated `FlightReviewThresholds` with hardcoded defaults in MVP (overlap preflight numbers where sensible, including GPS EPH and battery sag window). No settings UI in MVP.

**Rendering:** full-fidelity pass for stats/findings; capped render outputs (`2000` graph points, `5000` path vertices). MVP **path coloring modes:** `logGap` (default), `altitude`, `speed`, `batteryVoltage`, `gpsQuality`.

**MVP UI:** summary cards, findings panel, colored map path, timeline with markers, five graph panels (altitude, speed, battery voltage, link quality/RSSI, GPS). Graph **click** seeks; hover-scrub deferred.

**Explicitly not MVP:** flight health score, exports, operator notes, configurable thresholds UI, simulation flight review, target-confidence graphs, enriched link/DEM/target findings.

## Consequences

- Future contributors must not add `debrief` as a fourth source mode or a separate replay runtime without revisiting this ADR.
- MVP flight review findings will be thinner than the full event wish-list; that is intentional until live logging writes non-telemetry replay events.
- Extracting analysis types to `packages/shared` or adding desktop/server report generation is deferred until an export/API/CLI need exists.
- Canonical glossary terms live in CONTEXT.md: **Flight review**, **Flight review finding**, **Active view**, **Session home (first fix)**, **Flight review thresholds**, **Path coloring mode**.
