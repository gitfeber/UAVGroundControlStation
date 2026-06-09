export type RuntimeMode = "web" | "desktop" | "cloud";

/** Production hosts that always serve the Hosted Web App (Web Serial) build. */
const KNOWN_CLOUD_HOSTS = new Set(["app.uavgroundcontrolstation.com"]);

/**
 * Resolve which link/runtime owns the serial port.
 *
 * - `desktop`: Tauri shell
 * - `cloud`: browser Web Serial (Hosted Web App)
 * - `web`: browser UI + Node server (local dev / self-hosted fallback)
 */
export function runtimeMode(): RuntimeMode {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return "desktop";
  }

  if (isCloudBuild() || isKnownCloudHost()) {
    return "cloud";
  }

  return "web";
}

function isCloudBuild(): boolean {
  return (
    import.meta.env.VITE_LINK === "webserial" ||
    import.meta.env.VITE_RUNTIME === "cloud" ||
    import.meta.env.MODE === "cloud"
  );
}

/** Fallback when a production host serves a non-cloud bundle by mistake. */
function isKnownCloudHost(): boolean {
  if (!import.meta.env.PROD || typeof window === "undefined") {
    return false;
  }
  return KNOWN_CLOUD_HOSTS.has(window.location.hostname);
}
