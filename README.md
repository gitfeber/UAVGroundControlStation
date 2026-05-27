# UAV Ground Control Station

![UAV Ground Control Station logo](./docs/logo.png)

A local ground control station for UAVs — map, telemetry, and serial link in one dashboard.

![Runtime](https://img.shields.io/badge/runtime-Desktop%20%7C%20Browser-lightgrey)
![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-3178c6)

---

## Overview

**UAV Ground Control Station** is a slim, locally operated GCS that runs on the operator’s machine. A shared React UI shows position, battery, radio link, flight mode, and session stats on a MapLibre map — whether data arrives over **CRSF**, **MAVLink**, or both.

| Runtime | Use case | Protocols | Serial access |
|---------|----------|-----------|---------------|
| **Desktop** (Tauri, recommended) | Primary operator runtime, TX16S, Windows `COM*` | CRSF + MAVLink, GCS wake-up | Native Rust |
| **Browser + Node** | Development, MAVLink-direct links | MAVLink | `apps/server` (fallback) |

For **RadioMaster TX16S** with a USB telemetry mirror, the **desktop app** is the intended runtime (420000 baud, CRSF-first). See [`docs/adr/0001-dual-runtime-desktop-canonical.md`](docs/adr/0001-dual-runtime-desktop-canonical.md).

## Safety

This project is experimental ground-control software. Do not use it for unsafe, unsupervised, or illegal UAV operation. Always follow local regulations, manufacturer guidance, and safe test procedures.

Prefer bench testing and disconnected telemetry validation before using the software with real flight hardware.

## Features

- **Live map** with flight track (up to 5000 points), home reference, distance, and bottom-center **Attitude HUD** (pitch ladder, roll arc, heading tape, speed/altitude, climb bar, armed/mode)
- **Telemetry sidebar** — **Text** or **Inst** (mini gauges with the same telemetry fields as text mode); drag card headers (⠿) to reorder (shared order for both views, stored in `uav-gcs.sidebar.order`); **Reset** restores recommended flight-priority order; alerts stay fixed at the top
- **Serial link** — port picker (USB/PNP preferred), manual path entry, common baud rates
- **Activity log** — connection status, parser stats, frame message stats
- **Optional video stream** (MJPEG, etc.) via environment variables
- **Session logging** and reset for new flights
- **Shared data model** [`TelemetryState`](packages/shared/src/index.ts) for desktop and browser

## Screenshots

![UAV Ground Control Station dashboard](./docs/screenshots/dashboard-overview.png)

Desktop runtime: map, telemetry sidebar, frame message stats, and optional camera panel.

## Architecture

**Telemetry data flow:**

```text
TX16S / Flight Controller
        |
        | USB serial telemetry
        v
Desktop / Node parser
        |
        | normalized TelemetryState
        v
React operator dashboard
```

**Monorepo layout:**

```text
packages/shared     Shared types & TelemetryState
apps/web            React + Vite + Tailwind + MapLibre (shared UI)
apps/desktop        Tauri v2 + Rust (CRSF/MAVLink, COM*, wake-up)  ← canonical
apps/server         Fastify + WebSocket + serialport (MAVLink, dev/fallback)
```

Domain language and terms: [`CONTEXT.md`](CONTEXT.md).

## Prerequisites

- **Node.js** ≥ 20.19
- **pnpm** 10.x (`corepack enable` recommended)
- **Desktop build:** [Rust](https://www.rust-lang.org/tools/install) and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- **Windows:** run maintenance commands (`pnpm install`, `lint`, `typecheck`) in **WSL**; run **Tauri dev/build** for real `COM*` hardware in **Windows PowerShell**

## Quick start

### Repository

```bash
git clone https://github.com/gitfeber/UAVGroundControlStation.git
cd UAVGroundControlStation
pnpm install
```

### Desktop (recommended)

**Pre-built installers** (no local Rust toolchain required):

1. Open [GitHub Releases](https://github.com/gitfeber/UAVGroundControlStation/releases) for this repository.
2. Download the asset for your OS (Windows `.msi` / setup `.exe`, or Linux `.deb` / `.AppImage`).
3. Install and launch **UAV Ground Control Station**.

Each push to `main` runs tests first; if they pass, CI publishes a **prerelease** with Windows and Linux installers (tag like `v0.1.8-build.42`, job `publish` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)). **Stable** releases use a version tag such as `v0.1.8` (see [`.github/workflows/release.yml`](.github/workflows/release.yml)).

**From source:**

```bash
pnpm dev:desktop
```

Release build (local MSI/installer):

```bash
pnpm build:desktop
```

Artifacts: `apps/desktop/src-tauri/target/release/bundle/`

**Maintainers — stable release (optional):**

Automatic prereleases happen on every green `main` push. For a non-prerelease “stable” release:

```bash
git tag v0.1.8
git push origin v0.1.8
```

The release workflow builds **Windows** and **Linux** installers and attaches them to the GitHub release (no macOS builds in CI). You can also trigger it manually under **Actions → Release → Run workflow**.

If the release job fails with *Resource not accessible by integration*, enable **Settings → Actions → General → Workflow permissions → Read and write permissions** for the repository.

### Browser development (MAVLink fallback)

```bash
cp .env.example .env
pnpm dev
```

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:5173`

## Operator notes

### Serial link

| Scenario | Typical baud rate |
|----------|-------------------|
| TX16S telemetry mirror (CRSF-first) | **420000** |
| Flight controller USB (MAVLink direct) | **115200** or **460800** |

**Symptom:** status shows “Serial linked” but no map/telemetry → usually wrong baud rate or wrong runtime (for TX16S, use desktop).

### Windows

Host `COM*` ports are often unreachable from **WSL-hosted Node**. For TX16S and CRSF, use the **desktop app**, not the browser stack over WSL.

### Supported port paths

- Windows: `COM*`
- macOS: `/dev/cu.*`, `/dev/tty.*`
- Linux: `/dev/ttyACM*`, `/dev/ttyUSB*`

Empty system ports without device metadata are hidden; unusual paths can be entered manually.

## Configuration (browser stack)

`.env` at the repository root (see [`.env.example`](.env.example)):

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Node server REST API (default: `http://localhost:3001`) |
| `VITE_WS_URL` | WebSocket for telemetry (default: `ws://localhost:3001/ws`) |
| `VITE_MAP_STYLE_URL` | Optional: full MapLibre style URL |
| `VITE_SATELLITE_TILE_URL` | Optional: raster satellite tile URL |
| `VITE_VIDEO_URL` / `VITE_VIDEO_KIND` | Optional: camera stream (e.g. MJPEG) |

Server: `PORT` (default `3001`), `HOST` (default `0.0.0.0`) in `apps/server`.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build          # browser stack
pnpm build:desktop  # desktop installer
```

Agent and architecture rules: [`AGENTS.md`](AGENTS.md).

## Project structure

```text
apps/desktop/       Tauri + Rust (primary serial link)
apps/server/        Node backend (dev/fallback)
apps/web/           React dashboard
packages/shared/    API and telemetry contracts
docs/adr/           architecture decisions
```

## License

No public license is provided. All rights reserved unless stated otherwise.
