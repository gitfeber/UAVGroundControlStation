# UAV Ground Control Station

Local ground control for UAVs. One React dashboard talks to either a native desktop link (CRSF + MAVLink) or a browser dev stack (MAVLink-only Node backend).

## Language

### Link and runtime

**Telemetry link**:
The active serial connection between the GCS and the aircraft path (TX16S USB mirror, ELRS, or direct FC USB).
_Avoid_: Port, COM line (unless discussing OS device names)

**Runtime mode**:
Which host process owns the serial port and parsers: `desktop` (Tauri/Rust, canonical for TX16S/CRSF) or `web` (browser UI + Node server, MAVLink dev/fallback).
_Avoid_: App mode, client type

**CRSF-first port**:
A serial session where CRSF frames are detected first; MAVLink may arrive only inside CRSF passthrough frames (typical TX16S telem mirror at 420000 baud).
_Avoid_: CRSF mode toggle

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

## Flagged ambiguities

| Ambiguous | Canonical | Notes |
|-----------|-----------|--------|
| `mavlinkPackets` in API types | Keep field name; means parsed telemetry frames | Renaming is a breaking shared-type change |
| "browser-based GCS" in README | Product shell is desktop-first; browser stack is dev/fallback | See ADR 0001 |

## Example dialogue

**Operator:** I plugged the TX16S into Windows but the map is empty.

**Dev:** Which runtime mode — desktop MSI or `pnpm dev` in the browser?

**Operator:** Desktop.

**Dev:** Good — that's the canonical telemetry link for CRSF-first ports. Is the topbar badge "Serial linked" or "Telemetry live"?

**Operator:** Serial linked only.

**Dev:** Raw bytes but no frames usually means wrong baud. For a CRSF-first port use 420000; direct FC USB is often 115200 or 460800. Check frame message stats in the activity log once telemetry flows.
