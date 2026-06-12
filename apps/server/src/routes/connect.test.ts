import { createInitialTelemetryState } from "@uav-ground-control-station/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { buildApp } from "../buildApp.js";
import type { SerialService } from "../services/serialService.js";

interface MockSerialService extends SerialService {
  connect: Mock;
  disconnect: Mock;
  resetSession: Mock;
  listPorts: Mock;
  onTelemetry: Mock;
}

function createMockSerial(): MockSerialService {
  const initialTelemetry = createInitialTelemetryState();
  const status = {
    serialConnected: false,
    mavlinkPackets: 0,
    lastPacketMs: null
  };

  return {
    getTelemetry: () => initialTelemetry,
    getStatus: () => status,
    listPorts: vi.fn(async () => []),
    connect: vi.fn(async () => ({ ...status, serialConnected: true })),
    disconnect: vi.fn(async () => status),
    resetSession: vi.fn(() => initialTelemetry),
    onTelemetry: vi.fn((_listener: (telemetry: typeof initialTelemetry) => void) => undefined)
  };
}

function postConnect(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/connect",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body)
  });
}

describe("/api/connect validation", () => {
  let app: FastifyInstance;
  let serial: MockSerialService;

  beforeEach(() => {
    serial = createMockSerial();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("rejects a missing path with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: {}
    });
    expect(response.statusCode).toBe(400);
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("rejects an empty path with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { path: "   " }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Serial port path is required." });
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("rejects unsupported device paths with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const blocked = [
      "/etc/passwd",
      "/dev/null",
      "/dev/zero",
      "/dev/random",
      "/dev/sda",
      "/dev/input/event0",
      "/dev/disk/by-id/foo"
    ];

    for (const path of blocked) {
      serial.connect.mockClear();
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: { path }
      });
      expect(response.statusCode).toBe(400);
      expect(serial.connect).not.toHaveBeenCalled();
    }
  });

  it("rejects path traversal with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { path: "/dev/../etc/passwd" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Serial port path is not allowed." });
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("rejects non-integer baud rates with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await postConnect(app, { path: "COM3", baudRate: "460800" });
    expect(response.statusCode).toBe(400);
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("rejects unsupported baud rates with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { path: "COM3", baudRate: 999999 }
    });
    expect(response.statusCode).toBe(400);
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields with 400 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await postConnect(app, { path: "COM3", extra: true });
    expect(response.statusCode).toBe(400);
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("accepts valid serial paths, trims whitespace, and calls connect with normalized input", async () => {
    app = await buildApp({ serial });
    const cases = [
      { input: { path: "COM12", baudRate: 420000 }, expected: { path: "COM12", baudRate: 420000 } },
      {
        input: { path: "  /dev/ttyUSB0  ", baudRate: 460800 },
        expected: { path: "/dev/ttyUSB0", baudRate: 460800 }
      },
      { input: { path: "/dev/cu.usbserial-1410", baudRate: 115200 }, expected: { path: "/dev/cu.usbserial-1410", baudRate: 115200 } },
      { input: { path: "/dev/ttyACM0" }, expected: { path: "/dev/ttyACM0" } },
      {
        input: { path: "/dev/serial/by-id/usb-Example_Device-if00", baudRate: 115200 },
        expected: { path: "/dev/serial/by-id/usb-Example_Device-if00", baudRate: 115200 }
      },
      { input: { path: "/dev/rfcomm0" }, expected: { path: "/dev/rfcomm0" } }
    ] as const;

    for (const { input, expected } of cases) {
      serial.connect.mockClear();
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: input
      });
      expect(response.statusCode).toBe(200);
      expect(serial.connect).toHaveBeenCalledTimes(1);
      expect(serial.connect).toHaveBeenCalledWith(expected);
    }
  });

  it("rejects cross-origin connect attempts with 403 and does not call connect", async () => {
    app = await buildApp({ serial });
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      payload: { path: "COM3", baudRate: 115200 }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "Cross-origin requests to serial-control endpoints are not allowed."
    });
    expect(serial.connect).not.toHaveBeenCalled();
  });

  it("leaves the server responsive after repeated invalid connect attempts", async () => {
    app = await buildApp({ serial });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: { path: "/etc/passwd", baudRate: 999999 }
      });
      expect(response.statusCode).toBe(400);
    }

    expect(serial.connect).not.toHaveBeenCalled();
    const status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ serialConnected: false });
  });
});
