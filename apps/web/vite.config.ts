import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
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
