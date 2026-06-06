# Node server binds loopback only; remote access is unauthenticated opt-in

`apps/server` exposes REST endpoints that open and close the serial link to flight hardware (`/api/connect`, `/api/disconnect`, `/api/ports`) plus a `/ws` telemetry stream. It has no authentication. The default bind was `0.0.0.0`, so any device on the same LAN/field network could open or close the serial port and stream live position — unauthenticated. The CORS allowlist only constrains browsers; scripted clients ignore it. Per ADR 0001 the browser + Node stack is a dev/fallback path, and the operator confirmed it is only ever reached from the same machine.

**Decision:** Default the server bind to `127.0.0.1`. Treat any non-loopback bind as an explicit, operator-initiated opt-in (via `HOST`), and document that it is unauthenticated — exposing it to a network grants remote control of the serial link to flight hardware.

**Consequences:** The default browser dev flow (UI and server on one machine) is unaffected. Reaching the server from another device (e.g. a field tablet) now requires deliberately setting `HOST` and accepting the risk. If remote operation ever becomes a real product requirement, that needs authentication (token/mTLS) and an ADR update before promoting it — do not silently widen the default bind. README must stop advertising `0.0.0.0` as the default.

**Status:** accepted (2026-06-06)
