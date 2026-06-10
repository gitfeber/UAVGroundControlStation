import { describe, expect, it } from "vitest";
import { getRemoteSerialControlApiBanner, REMOTE_SERIAL_CONTROL_API_BANNER } from "./apiSafety";

describe("getRemoteSerialControlApiBanner", () => {
  describe("should warn", () => {
    it("warns for explicit non-loopback API URL", () => {
      expect(getRemoteSerialControlApiBanner("http://192.168.0.10:3001", undefined, undefined)).toBe(
        REMOTE_SERIAL_CONTROL_API_BANNER
      );
    });

    it("warns for explicit non-loopback WebSocket URL", () => {
      expect(
        getRemoteSerialControlApiBanner("http://127.0.0.1:3001", "ws://192.168.0.10:3001/ws", "http://localhost:5173")
      ).toBe(REMOTE_SERIAL_CONTROL_API_BANNER);
    });

    it("warns when API/WS URLs are unset on a non-loopback page origin", () => {
      expect(getRemoteSerialControlApiBanner(undefined, undefined, "http://192.168.0.10:5173")).toBe(
        REMOTE_SERIAL_CONTROL_API_BANNER
      );
    });

    it("warns when API/WS URLs are empty on a non-loopback page origin", () => {
      expect(getRemoteSerialControlApiBanner("", "", "http://192.168.0.10:5173")).toBe(
        REMOTE_SERIAL_CONTROL_API_BANNER
      );
    });

    it("warns when API/WS URLs are relative on a non-loopback page origin", () => {
      expect(getRemoteSerialControlApiBanner("/api", "/ws", "http://192.168.0.10:5173")).toBe(
        REMOTE_SERIAL_CONTROL_API_BANNER
      );
    });

    it("warns when loopback API is paired with relative WS on a non-loopback page origin", () => {
      expect(
        getRemoteSerialControlApiBanner("http://localhost:3001", "/ws", "http://192.168.0.10:5173")
      ).toBe(REMOTE_SERIAL_CONTROL_API_BANNER);
    });

    it("warns when relative API is paired with non-loopback WS on a loopback page origin", () => {
      expect(
        getRemoteSerialControlApiBanner("/api", "ws://192.168.0.10:3001/ws", "http://localhost:5173")
      ).toBe(REMOTE_SERIAL_CONTROL_API_BANNER);
    });
  });

  describe("should not warn", () => {
    it("does not warn for loopback page origin with unset API/WS URLs", () => {
      expect(getRemoteSerialControlApiBanner(undefined, undefined, "http://localhost:5173")).toBeNull();
    });

    it("does not warn for loopback page origin with empty API/WS URLs", () => {
      expect(getRemoteSerialControlApiBanner("", "", "http://127.0.0.1:5173")).toBeNull();
    });

    it("does not warn for loopback page origin with relative API/WS URLs", () => {
      expect(getRemoteSerialControlApiBanner("/api", "/ws", "http://localhost:5173")).toBeNull();
    });

    it("does not warn for explicit loopback API and WebSocket URLs", () => {
      expect(
        getRemoteSerialControlApiBanner(
          "http://127.0.0.1:3001",
          "ws://127.0.0.1:3001/ws",
          "http://localhost:5173"
        )
      ).toBeNull();
    });

    it("does not warn for bracketed IPv6 loopback API and WebSocket URLs", () => {
      expect(
        getRemoteSerialControlApiBanner("http://[::1]:3001", "ws://[::1]:3001/ws", "http://localhost:5173")
      ).toBeNull();
    });

    it("does not warn when no endpoints or fallback origin are configured", () => {
      expect(getRemoteSerialControlApiBanner(undefined, undefined, undefined)).toBeNull();
      expect(getRemoteSerialControlApiBanner("", "", undefined)).toBeNull();
    });
  });

  describe("invalid input", () => {
    it("does not crash on malformed URL config", () => {
      expect(
        getRemoteSerialControlApiBanner("not a valid url ::", undefined, "http://localhost:5173")
      ).toBeNull();
    });
  });
});
