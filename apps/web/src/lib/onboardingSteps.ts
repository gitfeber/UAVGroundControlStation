import type { DriveStep } from "driver.js";
import { isMapBasemapSwitcherEnabled } from "./mapBasemaps";
import type { RuntimeMode } from "./runtimeMode";

type StepDef = DriveStep & {
  runtimes?: RuntimeMode[];
  when?: () => boolean;
};

const tourTarget = (id: string) => `[data-tour="${id}"]`;

function serialConnectDescription(runtimeMode: RuntimeMode): string {
  if (runtimeMode === "cloud") {
    return "Click Connect and pick your USB serial device in the browser prompt. Use 420000 baud for TX16S CRSF telemetry mirrors, or 115200 / 460800 for direct flight-controller MAVLink USB.";
  }

  if (runtimeMode === "desktop") {
    return "Choose your serial port (or enter a manual path such as COM3 or /dev/cu.*), set baud rate, then Connect. Desktop uses native serial access — preferred for TX16S CRSF at 420000 baud and Windows COM ports.";
  }

  return "Choose a serial port (or manual path), set baud rate, then Connect. The browser UI talks to the local Node backend over WebSocket. Use Refresh if your USB device was plugged in after launch.";
}

function groundTargetDescription(runtimeMode: RuntimeMode): string {
  if (runtimeMode === "desktop") {
    return "Estimates a ground target from the camera crosshair using ray marching against a GeoTIFF DEM. Load terrain here for accurate slant range and map markers. Live mode only.";
  }

  return "Shows image-center target estimation from the camera crosshair. Browser runtimes use flat terrain; load a GeoTIFF DEM in the desktop app for accurate ray marching. Live mode only.";
}

export function buildOnboardingSteps(runtimeMode: RuntimeMode): DriveStep[] {
  const defs: StepDef[] = [
    {
      popover: {
        title: "Welcome to UAV Ground Control Station",
        description:
          "This quick tour highlights the main controls for linking your radio, reading telemetry, and operating the map. You can skip anytime — reopen it later from the ? button in the top bar.",
        side: "over",
        align: "center"
      }
    },
    {
      element: tourTarget("topbar"),
      popover: {
        title: "Command bar",
        description:
          "The top bar is your mission control strip: link controls on the left, source mode in the center, and live link statistics on the right.",
        side: "bottom",
        align: "start"
      }
    },
    {
      element: tourTarget("source-mode"),
      popover: {
        title: "Telemetry source",
        description:
          "Live reads real hardware. Replay loads recorded JSON/JSONL logs for post-flight review. Simulation runs deterministic synthetic telemetry for bench testing — no serial link required.",
        side: "bottom",
        align: "start"
      }
    },
    {
      element: tourTarget("serial-connect"),
      popover: {
        title: "Serial link",
        description: serialConnectDescription(runtimeMode),
        side: "bottom",
        align: "start"
      }
    },
    {
      element: tourTarget("link-status"),
      popover: {
        title: "Link health",
        description:
          "Watch Telemetry live, bridge status, packet counts, and last-packet age here. If telemetry goes quiet for more than 3 seconds in Live mode, stale-data indicators appear across the dashboard.",
        side: "bottom",
        align: "end"
      },
      runtimes: ["desktop", "web"]
    },
    {
      element: tourTarget("link-status"),
      popover: {
        title: "Link health",
        description:
          "These badges show whether Web Serial is active, how many packets arrived, and how fresh the last frame is. Stale live telemetry (>3 s) dims parts of the UI with warning banners.",
        side: "bottom",
        align: "end"
      },
      runtimes: ["cloud"]
    },
    {
      element: tourTarget("telemetry-sidebar"),
      popover: {
        title: "Telemetry sidebar",
        description:
          "Flight data, preflight checks, alerts, and sortable telemetry cards live here. Drag card headers (⠿) to reorder; Reset restores the recommended flight-priority layout.",
        side: "right",
        align: "start"
      }
    },
    {
      element: tourTarget("sidebar-view-toggle"),
      popover: {
        title: "Sidebar view",
        description: "Switch between Text metrics and Inst mini-gauges. Both views share the same card order and telemetry fields.",
        side: "left",
        align: "start"
      }
    },
    {
      element: tourTarget("preflight-health"),
      popover: {
        title: "Preflight health",
        description:
          "Advisory checks for GPS fix, battery, link freshness, sensors, and home distance. Green means ready, amber is caution, red is not ready — always verify against your airframe checklist.",
        side: "right",
        align: "start"
      }
    },
    {
      element: tourTarget("alerts"),
      popover: {
        title: "Alerts",
        description: "Active warnings and critical conditions surface here as badges — low battery, GPS loss, link issues, and similar events.",
        side: "right",
        align: "start"
      }
    },
    {
      element: tourTarget("map"),
      popover: {
        title: "Live map",
        description:
          "MapLibre shows your UAV position, up to 5000 track points, home reference, and ground-target markers with line-of-sight when estimation is valid.",
        side: "left",
        align: "center"
      }
    },
    {
      element: tourTarget("attitude-hud"),
      popover: {
        title: "Attitude HUD",
        description:
          "Bottom-center overlay with pitch ladder, roll arc, heading tape, speed, altitude, climb bar, and armed/mode status. Dims with a Stale banner when live telemetry is outdated.",
        side: "top",
        align: "center"
      }
    },
    {
      element: tourTarget("map-basemap"),
      popover: {
        title: "Map basemap",
        description: "Switch between Tactical, Satellite, and Topo styles. Your choice is saved locally for the next session.",
        side: "left",
        align: "start"
      },
      when: () => isMapBasemapSwitcherEnabled()
    },
    {
      element: tourTarget("clear-track"),
      popover: {
        title: "Clear track",
        description: "Removes the accumulated flight path from the map without disconnecting serial or resetting telemetry. Useful when starting a new flight segment.",
        side: "right",
        align: "start"
      }
    },
    {
      element: tourTarget("camera-feed"),
      popover: {
        title: "Camera feed",
        description:
          "Draggable picture-in-picture video panel with crosshair overlay for ground-target estimation. Set stream URL and type (MJPEG, HLS, WebRTC) here; drag the header to reposition.",
        side: "left",
        align: "end"
      }
    },
    {
      element: tourTarget("activity-log"),
      popover: {
        title: "Activity log",
        description:
          "Connection events, parser stats, and per-frame MAVLink message counts. Open to inspect warnings; Clear wipes the session log without affecting the serial link.",
        side: "top",
        align: "start"
      }
    },
    {
      element: tourTarget("ground-target"),
      popover: {
        title: "Ground target",
        description: groundTargetDescription(runtimeMode),
        side: "right",
        align: "start"
      }
    },
    {
      popover: {
        title: "You are ready to fly",
        description:
          "Connect your serial link in Live mode, confirm preflight health, and watch the map. Use Replay or Simulation to practice without hardware. Press Done to close this tour.",
        side: "over",
        align: "center"
      }
    }
  ];

  return defs
    .filter((step) => {
      if (step.runtimes && !step.runtimes.includes(runtimeMode)) {
        return false;
      }
      if (step.when && !step.when()) {
        return false;
      }
      return true;
    })
    .map(({ runtimes: _runtimes, when: _when, ...step }) => step);
}
