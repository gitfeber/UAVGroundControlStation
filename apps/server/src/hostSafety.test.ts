import { describe, expect, it, vi } from "vitest";
import { isLoopbackHost, warnIfNonLoopbackHost } from "./hostSafety.js";

describe("hostSafety", () => {
  it("treats common loopback bind addresses as local-only", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("treats routable bind addresses as non-loopback exposure", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.42")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
  });

  it("emits a console warning for non-loopback binds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnIfNonLoopbackHost("127.0.0.1");
    expect(warn).not.toHaveBeenCalled();

    warnIfNonLoopbackHost("0.0.0.0");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("0.0.0.0");
    expect(String(warn.mock.calls[0]?.[0])).toContain("no authentication");

    warn.mockRestore();
  });
});
