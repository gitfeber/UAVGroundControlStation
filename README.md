# UAV Ground Control Station

A slim local browser-based Ground Control Station for UAVs.

The MVP reads MAVLink telemetry from a TX16S / ELRS / USB-C serial connection through a local Node.js backend, normalizes the data into a shared telemetry state, and streams it to a React UI over WebSocket. The UI is intentionally focused: one dark technical dashboard with a central map, a compact telemetry sidebar, topbar connection controls, alerting, track drawing, and a small camera feed panel.

## Stack

- Monorepo: pnpm workspaces
- Shared types: TypeScript package in `packages/shared`
- Backend: Node.js, TypeScript, Fastify, WebSocket, `serialport`
- MAVLink: `node-mavlink` packet stream parsing with focused MVP payload normalization
- Frontend: React, Vite, TypeScript, Tailwind CSS
- Map: MapLibre GL JS
- Desktop: Tauri v2 native shell for Windows/macOS/Linux host serial access

## Project Structure

```text
apps/
  server/        Fastify backend, serial/MAVLink service, WebSocket broadcaster, logger
  web/           React/Vite dashboard, map, sidebar, camera panel
  desktop/       Tauri desktop shell with native serial-port access
packages/
  shared/        Shared TypeScript API and telemetry types
logs/            Optional local JSONL flight logs
```

## Requirements

- Node.js 22.13+ recommended, or Node.js 20.19+ with pnpm 10
- pnpm 10 or newer compatible with your Node.js version
- Rust stable and the Tauri prerequisites for native desktop builds
- macOS, Windows, or Linux
- A TX16S / ELRS connection over USB-C, USB-A adapter, hub, dock, or any other USB connection that exposes MAVLink telemetry as a serial port

## Setup

Browser mode with the Node/Fastify backend:

```bash
pnpm install
pnpm dev
```

If pnpm asks to approve native build scripts, approve `@serialport/bindings-cpp` so the backend can access serial hardware.

Open the app at:

```text
http://localhost:5173
```

The backend listens on:

```text
http://localhost:3001
```

Desktop mode with native host serial access:

```bash
pnpm install
pnpm dev:desktop
```

The Tauri desktop app embeds the same React UI, but serial-port discovery and MAVLink reading happen in the native Rust process. On Windows this means the app can see Windows `COM` ports directly, without attaching the TX16S to WSL.

On Windows, run `pnpm dev:desktop` from a native Windows terminal such as PowerShell, Windows Terminal, or CMD with Node.js, pnpm, Rust, and the Tauri prerequisites installed on Windows. If you start the desktop app from WSL, it is a Linux process and will not see Windows `COM` ports directly.

To build an installer or native desktop bundle:

```bash
pnpm build:desktop
```

Install the Tauri prerequisites for your OS first. On Windows this includes Rust and the Microsoft WebView2 runtime/build tools required by Tauri.

## Serial Port Discovery

The app only lists serial ports that look device-backed and usable for hardware telemetry. It filters out common empty system serial ports such as Linux/WSL `/dev/ttyS*` entries unless the operating system reports USB, PNP, manufacturer, serial number, VID/PID, or location metadata.

Supported device names include:

- macOS USB serial/modem devices such as `/dev/cu.usbmodem...`, `/dev/tty.usbmodem...`, `/dev/cu.usbserial...`, and `/dev/tty.usbserial...`
- Windows serial devices such as `COM3`, `COM4`, or another active `COM` port
- Linux USB serial devices such as `/dev/ttyACM0`, `/dev/ttyUSB0`, or another active USB-backed `/dev/tty*` device

If the TX16S is physically connected to Windows but the backend runs inside WSL, the Windows `COM` port is not automatically visible inside WSL. Use one of these approaches:

- Prefer `pnpm dev:desktop` on Windows. The Tauri app accesses Windows serial ports directly.
- Attach the USB device to WSL with `usbipd-win`, then select the resulting Linux device such as `/dev/ttyACM0`.
- Run the backend on the Windows host so it can open the Windows `COM` port directly.

The UI still provides `Manual path...` for unusual devices, custom mappings, or setups where the OS reports a valid path that does not include standard USB metadata.

## TX16S / ELRS Telemetry

1. Connect the TX16S to the computer with USB-C, a USB-A adapter, a dock, or a hub.
2. Start the app with `pnpm dev`.
3. Open `http://localhost:5173`.
4. Use the serial port dropdown to select the TX16S / USB serial device.
5. Try baud rate `460800` first. If no MAVLink packets arrive, try `115200` or `57600`.
6. Ensure MAVLink / ELRS telemetry is enabled on the RC link and flight controller.
7. The topbar should switch to `MAVLink live` when packets are received.

If the backend can open the serial port but no packets arrive, the UI shows `Serial linked`. That usually means the port is correct but MAVLink telemetry is not flowing yet.

The dropdown shows every serial device reported by the operating system, including manufacturer, friendly name, VID/PID, and serial number when available. If the radio appears under an unusual name, use `Manual path...` and enter the port path directly.

## API

- `GET /api/ports` lists serial ports with path and optional metadata such as manufacturer, friendly name, VID/PID, serial number, PNP ID, and location ID.
- `POST /api/connect` opens a serial port with `{ "path": "...", "baudRate": 460800 }`.
- `POST /api/disconnect` closes the current serial connection.
- `POST /api/reset` resets the telemetry session state.
- `GET /api/status` returns serial and packet status.
- `POST /api/logging/start` starts JSONL telemetry logging.
- `POST /api/logging/stop` stops JSONL telemetry logging.
- `GET /api/logging/status` returns logging status.
- `GET /ws` streams telemetry and backend status updates.

## Map Tiles

By default the MVP uses OpenStreetMap raster tiles as a no-key fallback.

To use satellite tiles, set either:

```bash
VITE_MAP_STYLE_URL=https://example.com/maplibre-style.json
```

or:

```bash
VITE_SATELLITE_TILE_URL=https://example.com/tiles/{z}/{x}/{y}.jpg
```

Put local overrides in `.env` or copy `.env.example`.

## Video Feed

The camera panel supports configurable placeholders for:

- MJPEG URL
- HLS URL
- WebRTC placeholder

Set `VITE_VIDEO_URL` and `VITE_VIDEO_KIND`, or edit the URL directly in the panel. If no URL is configured, the panel shows `No video source configured`.

## Development Commands

```bash
pnpm dev
pnpm dev:desktop
pnpm build
pnpm build:desktop
pnpm lint
pnpm typecheck
```

On Windows development machines for this repository, normal repo maintenance commands can run through WSL. For native Windows desktop hardware access, run `pnpm dev:desktop` or `pnpm build:desktop` in a native Windows terminal so Tauri can open host `COM` ports directly.

## MVP Scope

Included:

- Serial port listing and connect/disconnect controls
- MAVLink packet counting and live status
- MAVLink message handling for heartbeat, battery, GPS, global position, VFR HUD, attitude, radio, RC channels, status text, and navigation controller output
- ArduPlane and ArduCopter custom mode labels
- Telemetry sidebar with battery, GPS, speed, altitude, mode, armed state, RSSI, system, and session stats
- Map position marker, home marker, heading, and track line
- Alerts for stale MAVLink, low battery, poor GPS, low satellites, weak radio link, sensor health, and warning-level STATUSTEXT
- Optional local JSONL telemetry logging in `logs/`

Not included in the MVP:

- Mission planning
- Parameter editing
- Fleet management
- Flight report generation
- LILYGO blackbox import

Those areas are intended future extensions.
