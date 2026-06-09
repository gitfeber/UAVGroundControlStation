# UAV Ground Control Station

Local ground control for UAVs. One React dashboard talks to a native desktop link (CRSF + MAVLink), a browser dev stack (MAVLink-only Node backend), or a hosted browser SPA reading the radio directly over Web Serial (MAVLink-only, no server).

## Language

### Link and runtime

**Telemetry link**:
The active serial connection between the GCS and the aircraft path (TX16S USB mirror, ELRS, or direct FC USB).
_Avoid_: Port, COM line (unless discussing OS device names)

**Runtime mode**:
Which host process owns the serial port and parsers: `desktop` (Tauri/Rust, canonical for TX16S/CRSF), `web` (browser UI + Node server, MAVLink dev/fallback), or `cloud` (browser SPA, MAVLink-only, no Node server — reads the radio directly via the Web Serial API; Chromium- and HTTPS-only). `cloud` is selected by the build flag `VITE_LINK=webserial`; see ADR 0006. Internal code and ADRs use the key `cloud`; operator-facing copy uses **Hosted Web App** instead.
_Avoid_: App mode, client type

**Hosted Web App**:
The operator-facing name for runtime mode `cloud` — a zero-install browser GCS served over HTTPS where the operator's machine owns the USB radio via Web Serial. Not a telemetry-upload service; the hosted site delivers only the static app shell.
_Avoid_: Cloud app, cloud GCS, SaaS (in operator-facing copy without the privacy line)

**Hosted privacy line**:
The canonical trust statement paired with every **Hosted Web App** mention in UI, docs, and the landing page: "Telemetry stays in your browser." Use it wherever operators might infer that flight data is sent to the host.
_Avoid_: Cloud privacy, data policy (too generic)

**CRSF-first port**:
A serial session where CRSF frames are detected first; MAVLink may arrive only inside CRSF passthrough frames (typical TX16S telem mirror at 420000 baud).
_Avoid_: CRSF mode toggle

### Target estimation

**Ground target**:
The point on the terrain surface where the camera optical axis meets the ground — for v1, always the center of the live video image.
_Avoid_: Detected object, pixel target, POI

**Target estimate**:
The computed ground-target position and supporting ranges/quality derived from UAV pose, gimbal attitude, and local terrain elevation — not a sensor measurement.
_Avoid_: GPS fix, waypoint, geotag

**Terrain model**:
The local elevation surface used for ray intersection (e.g. EPSG:25832 projected DEM or EPSG:4326 geographic GeoTIFF). Operator-configured; desktop loads real GeoTIFF; web dev uses synthetic terrain only in v1.
_Avoid_: Map tiles, basemap, orthophoto

**Gimbal attitude**:
The camera/gimbal orientation used for target-estimation ray construction, normalized from MAVLink with source priority `285 → 265 → body-fixed vehicle attitude`. Not shown as a separate operator instrument in v1.
_Avoid_: Mount status, gimbal manager state

**Camera configuration**:
Operator settings for ray construction — mount offsets, frame conventions (earth/body, pitch sign, yaw reference), calibration offsets, and whether a body-fixed camera is allowed when gimbal telemetry is absent.
_Avoid_: Video URL, stream settings

**Telemetry sample time**:
Monotonic `sampledAtMs` on each telemetry snapshot — the estimator's time base for latency-aware buffer lookup. Distinct from `lastPacketAt` (any packet on the link).
_Avoid_: Frame timestamp, video clock

**Video latency offset**:
Operator-configured milliseconds subtracted from the estimate tick time (`atPcTimeMs`) so telemetry aligns with delayed video. Tunable; not a measured stream property in v1.
_Avoid_: Buffer delay, sync offset

**Altitude mode**:
Which MAVLink altitude field defines the ray origin height — `amsl` (default) or `relative` (fallback when AMSL absent). Paired with an operator **altitude offset** to align UAV height with the terrain model's vertical datum.
_Avoid_: Ellipsoid height, geoid model

**Altitude offset**:
Operator-configured meters added to the ray-origin altitude so UAV height matches the terrain model vertical reference (e.g. DEM vs GPS AMSL). Default `0`; calibrate at a known hover point.
_Avoid_: Geoid correction, DEM bias slider

**ENU anchor**:
The WGS84 lat/lon origin for a single target estimate's local East-North-Up frame — the interpolated UAV position at the latency-corrected telemetry time. Recomputed each estimate, not the home reference.
_Avoid_: Home reference, session origin, DEM tile corner

**Terrain window**:
The locally loaded subset of the terrain model kept in memory around the UAV for elevation queries. Recenters as the aircraft moves; distinct from the full terrain model file extent.
_Avoid_: Map viewport, tile cache layer

**Target estimate quality**:
Operator-facing trust level for a ground-target estimate — `good`, `warn`, or `bad` — derived deterministically from telemetry, gimbal source, DEM, and geometry gates. A `bad` gate invalidates the estimate; `warn` still shows coordinates when math allows.
_Avoid_: Confidence score, accuracy percentage

**Estimate invalid reason**:
Short machine reason on a failed or degraded target estimate (e.g. `gimbal_unavailable`, `dem_not_loaded`, `dem_out_of_coverage`, `gps_few_satellites`) so the operator knows what to fix. Bad gates invalidate the estimate; warn gates (`using_relative_altitude_fallback`, `gimbal_body_fixed_fallback`, `gimbal_mount_orientation`, `telemetry_stale`, `gps_low_accuracy`) still show coordinates when math allows.
_Avoid_: Error code, status message

**Ground target panel**:
Sidebar operator surface for full ground-target readout, terrain-model configuration, and estimation settings. Complements the compact readout on the camera feed.
_Avoid_: Target tab, geolocation settings

**Target estimation session**:
The live-only estimation runtime that owns the telemetry buffer, latency lookup, and repeated ground-target computation. Active in `live` source mode only in v1.
_Avoid_: Estimator service, raycast engine

**Target sample log**:
Short in-memory history of recent ground-target estimates for operator export and offline validation — not the replay log and not continuous disk logging in v1.
_Avoid_: Flight log, estimation recording

### Protocol and data

**Frame**:
One delimited unit on the wire (CRSF frame with address/length/CRC, or MAVLink v1/v2 packet). The parsers emit frames; the UI never parses raw bytes.
_Avoid_: Packet (use only when referring to MAVLink documentation)

**TelemetryState**:
The normalized dashboard snapshot in `packages/shared` — position, GPS, battery, radio, vehicle mode, and session stats — regardless of whether the source was CRSF, MAVLink, or both.
_Avoid_: MAVLink state, live object

**Frame message stat**:
A counted message type on the link (MAVLink message ID or CRSF frame type encoded in status stats). Shown in the activity panel as IDs + labels.
_Avoid_: MAVLink message (in operator-facing UI copy)

**Wake-up bytes**:
Outbound serial bytes the GCS sends after connect so a silent FC or radio mirror starts streaming (desktop sends MAVLink GCS heartbeats / requests; browser server may send none).
_Avoid_: MAVLink wake-up (in operator-facing UI copy)

### Operator UI

**Attitude HUD**:
The map-mounted primary flight display (`HudOverlay`) — pitch ladder, roll scale, heading tape, and key motion/vehicle fields from **TelemetryState**.
_Avoid_: Artificial horizon (description only), HUD overlay, Drone overlay (retired map text box)

**Telemetry instruments**:
Sidebar **Inst** view — compact SVG gauges (compass, battery, radio, tapes, GPS badge, attitude ball) from **TelemetryState** without new backend fields.
_Avoid_: Widget panel, gauge mode

**Preflight health**:
A read-only, operator-facing readiness summary derived purely from **active telemetry** (plus the UI **home reference** and source mode). Aggregates individual **preflight checks** into one of `READY` / `CAUTION` / `NOT_READY` / `UNKNOWN`. Advisory only — it sends no commands and is not the flight controller's pre-arm result.
_Avoid_: Pre-arm check (that is the FC's own gate), Preflight status (use the full term)

**Preflight check**:
One evaluated readiness condition (telemetry freshness, GPS, battery, radio, home reference, armed state, system health), each carrying its own status, message, and an `optional` flag that excludes it from global aggregation when its only verdict is `UNKNOWN`.
_Avoid_: Health check (ambiguous with sensor health)

**Telemetry freshness**:
The **preflight check** asking whether **active telemetry** is recent enough for the current source mode. Enforced only in `live` (wall-clock vs `lastPacketAt`); skipped as an optional `UNKNOWN` in `replay`/`simulation`, whose timestamps are virtual. Distinct from **Telemetry link** (the serial connection) — never reuse that term here.
_Avoid_: Telemetry link, Signal, Connection check

**Home reference**:
The operator's reference point latched by the dashboard from the first valid telemetry coordinate (`App` state), used for home-distance and the home **preflight check**. It is _not_ the flight controller's stored home / EKF origin.
_Avoid_: Home position (implies FC home), Launch point

### Source and playback

**Source mode**:
Which producer drives the dashboard right now — `live` (telemetry link), `replay` (recorded log), or `simulation` (synthetic). Exactly one is active at a time. Selected in the topbar; replay and simulation never open, write, or request serial.
_Avoid_: Input mode, feed type

**Active telemetry**:
The single **TelemetryState** the dashboard renders, derived from the current source mode. Live, replay, and simulation each keep their own internal **TelemetryState**; only the active one is displayed.
_Avoid_: Current telemetry (ambiguous with live)

**Replay log**:
A local recorded file (JSONL or JSON) of past telemetry, treated as untrusted input. Newly recorded logs use `REPLAY_LOG_SCHEMA_VERSION` 1; legacy `{time,type,data}` and plain **TelemetryState** lines are read best-effort.
_Avoid_: Flight log (use only for the human-facing file label), recording

**Replay event**:
One normalized entry from a replay log — `telemetry`, `partialTelemetry`, `activity`, or `diagnostic`. The replay engine applies events in file order to reconstruct **active telemetry**.
_Avoid_: Log line (that is the raw, pre-parse form)

**Replay engine**:
The pure, timer-free core (`advanceTo` / `stepOnce` / `seekTo`) that reconstructs state from **replay events**. A requestAnimationFrame driver feeds it virtual time. Simulation reuses the same engine over a pre-generated event list.
_Avoid_: Player, scheduler (the rAF wrapper is the "driver")

**Controlled track**:
The map path supplied to `MapPanel` by the replay/simulation source (rebuilt deterministically on seek/restart). Distinct from live mode's internal self-appending track.
_Avoid_: Replay path

**Simulation scenario**:
A named deterministic generator (`Nominal flight`, `Weak radio link`, `GPS degradation`, `Low battery approach`) that, given a seed, produces a bounded **replay event** list. No file, serial, network, or hardware access.
_Avoid_: Demo data, test mode

## Flagged ambiguities

| Ambiguous | Canonical | Notes |
|-----------|-----------|--------|
| `mavlinkPackets` in API types | Keep field name; means parsed telemetry frames | Renaming is a breaking shared-type change |
| "browser-based GCS" in README | Product shell is desktop-first; browser stack is dev/fallback | See ADR 0001 |
| "Cloud" in operator-facing copy | **Hosted Web App** + **Hosted privacy line** | Internal runtime key stays `cloud`; ADR/code unchanged |

## Example dialogue

**Operator:** I plugged the TX16S into Windows but the map is empty.

**Dev:** Which runtime mode — desktop MSI or `pnpm dev` in the browser?

**Operator:** Desktop.

**Dev:** Good — that's the canonical telemetry link for CRSF-first ports. Is the topbar badge "Serial linked" or "Telemetry live"?

**Operator:** Serial linked only.

**Dev:** Raw bytes but no frames usually means wrong baud. For a CRSF-first port use 420000; direct FC USB is often 115200 or 460800. Check frame message stats in the activity log once telemetry flows.

**Operator:** I opened the Hosted Web App at uavgroundcontrolstation.com — does my GPS go to your server?

**Dev:** No. Telemetry stays in your browser. The hosted site is only the app shell; Web Serial reads your local USB radio. We never receive GPS or flight data in v1.
