import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const appVersion = (
  JSON.parse(readFileSync(resolve(rootDir, "../../package.json"), "utf-8")) as { version?: string }
).version ?? "0.0.0";

export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion)
  },
  // Cloud builds use relative asset URLs so the SPA works when hosted on a subpath
  // (absolute /assets/* requests otherwise get the HTML shell and fail MIME checks).
  base: process.env.VITE_BASE_PATH ?? (mode === "cloud" ? "./" : "/"),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true
      }
    }
  }
}));
