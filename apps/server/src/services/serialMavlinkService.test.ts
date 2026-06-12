import { afterEach, describe, expect, it, vi } from "vitest";

const mockDestroy = vi.hoisted(() => vi.fn());

vi.mock("serialport", () => {
  class MockSerialPort {
    isOpen = true;
    open = vi.fn((callback: (error?: Error | null) => void) => callback());
    close = vi.fn((callback: (error?: Error | null) => void) => {
      this.isOpen = false;
      callback();
    });
    removeAllListeners = vi.fn();
    on = vi.fn();
    static list = vi.fn(async () => []);
  }

  return { SerialPort: MockSerialPort };
});

vi.mock("node-mavlink", () => ({
  default: {
    createMavLinkStream: vi.fn(() => ({
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      destroy: mockDestroy
    }))
  }
}));

import { SerialMavlinkService } from "./serialMavlinkService.js";

describe("SerialMavlinkService cleanup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disconnect clears the open port and marks serial disconnected", async () => {
    const service = new SerialMavlinkService();
    await service.connect({ path: "COM3", baudRate: 115200 });
    expect(service.getStatus().serialConnected).toBe(true);

    const status = await service.disconnect();
    expect(status.serialConnected).toBe(false);
    expect(mockDestroy).toHaveBeenCalled();
  });
});
