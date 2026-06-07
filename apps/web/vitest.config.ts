import { defineConfig } from "vitest/config";

// Replay/simulation logic is pure TypeScript (parser, scheduler core, state
// reconstruction, simulation generator). Tests run in a plain Node environment
// with no DOM, no jsdom, and no React renderer — see ADR 0003 and handoff.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
