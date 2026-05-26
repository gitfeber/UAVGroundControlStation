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
docs/adr/        Architecture decision records
CONTEXT.md       Domain glossary (telemetry link, runtime mode, frames)
```

**Runtime:** For TX16S / CRSF on Windows `COM*`, use `pnpm dev:desktop` (canonical). `pnpm dev` (browser + Node) is MAVLink-only dev/fallback — see [ADR 0001](docs/adr/0001-dual-runtime-desktop-canonical.md).

## Versioning

Every functional change to the application must bump the app version before building desktop installers. Keep these files in sync:

- `package.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

Tauri uses the desktop version for MSI/NSIS bundle metadata. A newer version lets Windows install the latest MSI over an older installed build.

## Requirements

- Node.js 22.13+ recommended, or Node.js 20.19+ with pnpm 10
- pnpm 10 or newer compatible with your Node.js version
- Rust stable and the Tauri prerequisites for native desktop builds
- macOS, Windows, or Linux
- A TX16S / ELRS connection over USB-C, USB-A adapter, hub, dock, or any other USB connection that exposes MAVLink telemetry as a serial port

## Setup

### Windows PowerShell First-Time Setup

Install Node.js on Windows first. Node.js 22 LTS is recommended.

If `node`, `npm`, and `corepack` are not recognized in PowerShell, install Node.js with `winget`:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close PowerShell completely, open a new PowerShell window, and verify:

```powershell
node --version
npm --version
```

Then open a new PowerShell window in the repository and enable pnpm:

```powershell
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm --version
```

If `corepack` is not available, install pnpm with npm:

```powershell
npm install -g pnpm@10
pnpm --version
```

If PowerShell blocks `npm.ps1` because it is not signed, use the command shim explicitly:

```powershell
& "C:\Program Files\nodejs\npm.cmd" --version
& "C:\Program Files\nodejs\npm.cmd" install -g pnpm@10.33.4
```

If `pnpm` is still not recognized after the global install, the npm global binary folder is not in the current PowerShell `PATH`. Use the generated command shim directly:

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --version
& "$env:APPDATA\npm\pnpm.cmd" install
& "$env:APPDATA\npm\pnpm.cmd" build:desktop
```

If `pnpm install` fails with `EACCES` inside `node_modules` after you previously installed dependencies from WSL, remove the WSL-created install tree and reinstall from Windows:

```powershell
cmd /c rmdir /s /q node_modules
cmd /c rmdir /s /q apps\server\node_modules
cmd /c rmdir /s /q apps\web\node_modules
cmd /c rmdir /s /q apps\desktop\node_modules
cmd /c rmdir /s /q packages\shared\node_modules
& "$env:APPDATA\npm\pnpm.cmd" install --force
```

It is best to use one host environment per install tree. For Windows desktop hardware testing, install and build from Windows PowerShell. If you later switch back to WSL-only development, reinstall dependencies from WSL.

To make `pnpm` available by name in new PowerShell windows, add the npm global binary folder to the user `PATH`:

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:APPDATA\npm;C:\Program Files\nodejs",
  "User"
)
```

Close PowerShell completely and open a new window before trying `pnpm --version` again.

If `corepack enable` fails with `EPERM` because it cannot write shims into `C:\Program Files\nodejs`, either run PowerShell as Administrator once and retry `corepack enable`, or avoid global shims and run pnpm through Corepack directly:

```powershell
corepack prepare pnpm@10.33.4 --activate
corepack pnpm@10.33.4 install
corepack pnpm@10.33.4 build:desktop
```

After that, `pnpm build:desktop` and `pnpm dev:desktop` will work from PowerShell.

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

The Windows bundle uses `apps/desktop/src-tauri/icons/icon.ico` for the executable resource icon.

To build an installer or native desktop bundle:

```bash
pnpm build:desktop
```

Install the Tauri prerequisites for your OS first. On Windows this includes Rust and the Microsoft WebView2 runtime/build tools required by Tauri.

If `pnpm build:desktop` fails with `cargo metadata ... program not found`, install Rust for Windows:

```powershell
winget install Rustlang.Rustup
```

Close PowerShell completely, open a new PowerShell window, and verify:

```powershell
cargo --version
rustc --version
```

Then run:

```powershell
& "$env:APPDATA\npm\pnpm.cmd" build:desktop
```

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
5. For a direct flight-controller USB link, try `115200` or `460800` baud. For a TX16S telemetry mirror over USB-VCP, use `420000` baud.
6. Ensure MAVLink / ELRS telemetry is enabled on the RC link and flight controller.
7. The topbar should switch to `MAVLink live` when packets are received.

If the backend can open the serial port but no packets arrive, the UI shows `Serial linked`. That usually means the port is correct but MAVLink telemetry is not flowing yet.

The dropdown shows every serial device reported by the operating system, including manufacturer, friendly name, VID/PID, and serial number when available. If the radio appears under an unusual name, use `Manual path...` and enter the port path directly.

## Telemetry Troubleshooting

After connecting a port, use the topbar diagnostics:

- `Raw ...B` increases: the selected serial port is producing bytes.
- `Tx ...B` increases: the desktop app is successfully writing MAVLink wake-up traffic to the port.
- `Packets` increases: valid MAVLink v1/v2 packets are being parsed.
- `Raw` stays at `0B`: the selected port is open but not sending data. Check the TX16S USB mode, telemetry settings, cable, driver, or try another COM port.
- `Tx` increases but `Raw` stays at `0B`: the app is sending GCS heartbeat/stream requests, but the device is not responding on that port.
- `Raw` increases but `Packets` stays at `0`: the port is sending data, but no MAVLink or CRSF telemetry frames were recognized. For TX16S telem mirror use `420000`; for direct FC USB try `115200` or `460800`.
- `Parse errors` increases: bytes are arriving, but they do not look like clean MAVLink frames. This can be a wrong baud rate, another protocol such as CRSF/EdgeTX telemetry, or a non-telemetry USB mode.

Important TX16S note: a USB connection to the radio does not automatically guarantee a MAVLink byte stream. Depending on EdgeTX/ELRS setup, the radio may expose joystick, storage, serial passthrough, CRSF telemetry, or no MAVLink stream at all. For this app, the selected port must output MAVLink v1/v2 bytes.

For direct ArduPilot flight-controller USB connections, the desktop app opens the port as 8N1 with no flow control, sets DTR and RTS, waits briefly, and then writes an initial MAVLink GCS heartbeat. This mirrors the successful PowerShell/.NET serial test pattern and avoids sending extra stream requests before the controller has responded.

The desktop app also keeps sending a MAVLink GCS heartbeat once per second. After packets are received, it periodically sends ArduPilot `REQUEST_DATA_STREAM` messages to refresh telemetry streams.

The desktop app writes the first GCS heartbeat and stream requests synchronously during `connect()`, before the reader thread starts. The desktop status bridge reports outbound wake-up traffic even if the flight controller does not answer. `Tx` should start increasing immediately after connect. If `Tx` increases but `Raw` remains `0B`, the app is writing to the port but the device is not sending bytes back to this process.

The bottom map overlay includes an `Activity Log` panel. Open it while testing a radio connection to see port scans, connection attempts, raw-byte warnings, MAVLink parser warnings, and serial errors without leaving the app.

The `Activity Log` also shows the most frequent MAVLink message IDs received during the current session. Use this to verify which messages the flight controller is actually streaming when the packet counter is increasing but sidebar metrics are still empty.

Parser error diagnostics only count malformed frame parsing now. Normal byte resynchronization when opening a port in the middle of an active MAVLink stream is ignored, because it is expected and not an actual protocol error.

MAVLink payload decoding follows MAVLink wire order, not the display order from XML definitions. This matters for messages such as `GPS_RAW_INT`, `BATTERY_STATUS`, and `RADIO_STATUS`, where fields of the same size are packed before smaller fields.

In desktop mode, the UI listens for native Tauri status events and also polls native status once per second. This keeps packet/message diagnostics fresh while a connection is active and avoids stale `MAVLink live` badges after disconnect.

Desktop mode also polls native telemetry once per second as a fallback. This keeps the sidebar synchronized even if high-rate Tauri telemetry events are dropped or delayed by the WebView.

Telemetry objects from native desktop mode are normalized with frontend defaults before rendering. This prevents a malformed or partial native payload from blanking the whole UI; rendering errors are caught by an in-app error boundary.

If the desktop app shows `Unable to initialize desktop bridge` or a map crash reading `lng` on startup, rebuild and reinstall the latest MSI. Tauri v2 requires capability files in `apps/desktop/src-tauri/capabilities/` so the webview can call native commands and listen for `telemetry`/`status` events. The bundled UI uses `main-capability`; `pnpm dev:desktop` also needs `dev-remote.json` for `http://localhost:5173`.

### TX16S telemetry mirror (CRSF over USB-VCP)

When the flight controller forwards telemetry to the radio and the TX16S mirrors it to the PC over USB-VCP, UAV Ground Control Station decodes native CRSF frames in addition to MAVLink:

- Use the TX16S telem mirror COM port, not the radio storage/joystick port.
- Set baud rate to `420000`.
- The desktop app stays listen-only on that port (no MAVLink wake-up traffic).
- Decoded CRSF types include GPS, battery, attitude (`0x1E`), flight mode (`0x21`), vario, baro altitude, and link statistics.
- ArduPilot/ELRS passthrough frames (`0x7A`, `0x80`, `0x3A`) are also scanned for embedded MAVLink.

The Activity Log message list shows CRSF frame types as `CRSF GPS`, `CRSF Attitude`, `CRSF Flight Mode`, and similar entries alongside MAVLink IDs. Roll/pitch come from `CRSF Attitude` (`16414`); flight mode text comes from `CRSF Flight Mode` (`16417`), not from `0x1E`.

At `420000` baud the desktop app treats the stream as CRSF-first: it does not scan the full byte stream for MAVLink sync bytes (that produced false parse errors on TX16S mirrors). MAVLink is only extracted from CRSF passthrough payloads such as `CRSF ELRS Ext` when `0xFE`/`0xFD` markers are present inside the frame.

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
