# ADR 0004: Preflight Health is a Read-only Advisory, Not the FC Pre-arm

**Status:** Accepted
**Date:** 2026-06-07

## Context

Operators want an at-a-glance "is the aircraft ready to fly?" panel. The obvious mental model is the flight controller's own **pre-arm check** — the gate the FC enforces before it will arm. A reader seeing a feature called "preflight" will reasonably assume it reflects that FC state and may even expect it to talk to the vehicle.

It does not, and must not. The GCS is read-only with respect to the aircraft (ADR 0001/0002 keep the control surface narrow; ADR 0003 keeps replay/simulation hardware-free). Wiring a real pre-arm path would mean requesting FC arming-check status and/or issuing commands — violating the read-only constraint and entangling a UI advisory with the live serial path.

We also display **active telemetry** from three source modes (`live`, `replay`, `simulation`), and the panel should be meaningful in all of them — but only `live` has a wall-clock-relative `lastPacketAt`; replay/simulation timestamps are virtual (ADR 0003).

## Decision

Preflight health is a **read-only, frontend-derived advisory** computed by a pure function (`evaluatePreflightHealth`) from **active telemetry**, the UI **home reference**, and the current source mode. It is **not** the flight controller's pre-arm result and represents no FC state.

- It sends no backend, serial, MAVLink, CRSF, or UAV control command, and triggers no connect/reconnect/stream-request behavior.
- It is evaluated across `live`, `replay`, and `simulation`.
- **Telemetry freshness** is enforced only in `live` (wall-clock vs `lastPacketAt`); in `replay`/`simulation` that check is reported as an optional `UNKNOWN` and excluded from global aggregation, because their timestamps are virtual. All other checks (GPS, battery, radio, home reference, armed state, system health) still run in every mode.
- The aggregate status (`READY` / `CAUTION` / `NOT_READY` / `UNKNOWN`) is advisory and operator-facing only.

See CONTEXT.md for the canonical terms **Preflight health**, **Preflight check**, **Telemetry freshness**, and **Home reference** (deliberately distinct from the reserved term **Telemetry link**).

## Consequences

- Future contributors must not "complete" this feature by querying FC arming checks or sending commands — that is a different feature with a different contract and would need its own ADR.
- The advisory can disagree with the FC's real pre-arm state; this is acceptable and expected, and the UI labels it as advisory (and the home check as a UI first-fix reference, not FC home).
- Preflight thresholds are kept independent from `alerts.ts` for now (lower regression risk); unifying them later is a reversible implementation detail and does not need an ADR.
