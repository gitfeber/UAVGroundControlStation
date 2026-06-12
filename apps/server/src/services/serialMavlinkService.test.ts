import { afterEach, describe, expect, it, vi } from "vitest";

const { MockEventEmitter, mockDestroy } = vi.hoisted(() => {
  const { EventEmitter } = require("node:events");
  const mockDestroy = vi.fn();
  return { MockEventEmitter: EventEmitter, mockDestroy };
});

vi.mock("serialport", () => {
  class MockSerialPort extends MockEventEmitter {
    isOpen = true;
    open = vi.fn((callback: (error?: Error | null) => void) => callback());
    close = vi.fn((callback: (error?: Error | null) => void) => {
      this.isOpen = false;
      callback();
    });
    static list = vi.fn(async () => []);
  }

  return { SerialPort: MockSerialPort };
});

vi.mock("node-mavlink", () => ({
  default: {
    createMavLinkStream: vi.fn(() => {
      const stream = new MockEventEmitter();
      (stream as { destroy: () => void }).destroy = mockDestroy;
      return stream;
    })
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
