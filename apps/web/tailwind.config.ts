import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "rgba(8, 13, 18, 0.86)",
        line: "rgba(120, 255, 244, 0.18)"
      },
      boxShadow: {
        glow: "0 0 32px rgba(34, 211, 238, 0.16)"
      }
    }
  },
  plugins: []
} satisfies Config;
