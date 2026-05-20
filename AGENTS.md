# Cursor Agent Notes

This repository is `uav-ground-control-station`, a slim local Ground Control Station for UAVs.

## Core Rules

- Keep the MVP focused on a single local dashboard: no mission planning, parameter editor, fleet management, or report system unless explicitly requested.
- Use TypeScript throughout the monorepo.
- Keep shared API and telemetry contracts in `packages/shared`.
- Hardware access belongs in `apps/server`; the browser app must stay visualization/control-only.
- Update `README.md` whenever a change affects setup, commands, architecture, APIs, telemetry behavior, environment variables, or operator workflow.
- On Windows development machines, run terminal commands through WSL.
- Keep serial-port handling cross-platform: support macOS `/dev/cu.*` and `/dev/tty.*`, Windows `COM*`, and Linux `/dev/ttyACM*` / `/dev/ttyUSB*`, including manual path entry when OS metadata is incomplete.
- Filter out empty system serial ports unless they have device metadata; prefer USB/PNP-backed ports in the UI.

## Architecture

- Frontend: `apps/web`, React + Vite + Tailwind + MapLibre GL JS.
- Backend: `apps/server`, Fastify + WebSocket + `serialport`.
- Shared types: `packages/shared`.
- Backend runs on `http://localhost:3001`.
- Frontend runs on `http://localhost:5173`.

## Telemetry Expectations

- Normalize incoming MAVLink data into `TelemetryState`.
- Preserve the shared `TelemetryState` shape unless the frontend and README are updated together.
- Keep WebSocket payloads JSON and small enough for local real-time display.
- Maintain the track limit of 5000 points in the frontend unless there is a deliberate performance change.

## UI Direction

- Dark technical GCS feel with a dominant map, left telemetry sidebar, compact topbar, and camera panel.
- Prefer simple local components over adding UI frameworks.
- Avoid unnecessary animation and keep the 1920x1080 layout strong while remaining usable on 13-14 inch laptops.
