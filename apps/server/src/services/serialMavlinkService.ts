import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import mavlink from "node-mavlink";
import type { MavLinkPacket } from "node-mavlink";
import { SerialPort } from "serialport";
import type { BackendStatus, ConnectRequest, SerialPortInfo, TelemetryState } from "@uav-ground-control-station/shared";
import { TelemetryStore, applyMavlinkFrame } from "@uav-ground-control-station/shared";

const defaultBaudRate = 460800;
const { createMavLinkStream } = mavlink as typeof import("node-mavlink");

export class SerialMavlinkService extends EventEmitter {
  private readonly store = new TelemetryStore();
  private port: SerialPort | null = null;
  private mavlinkStream: Readable | null = null;
  private serialConnected = false;
  private rawBytes = 0;
  private parserErrors = 0;
  private lastSerialError: string | null = null;

  async listPorts(): Promise<SerialPortInfo[]> {
    const ports = await SerialPort.list();
    return ports.filter(isLikelyDeviceBackedPort).map((port) => {
      const extra = port as typeof port & { friendlyName?: string };
      const info: SerialPortInfo = {
        path: port.path,
        transport: detectTransport(port),
        displayName: displayNameForPort(port, extra.friendlyName)
      };
      if (port.manufacturer) info.manufacturer = port.manufacturer;
      if (port.serialNumber) info.serialNumber = port.serialNumber;
      if (port.vendorId) info.vendorId = port.vendorId;
      if (port.productId) info.productId = port.productId;
      if (port.pnpId) info.pnpId = port.pnpId;
      if (port.locationId) info.locationId = port.locationId;
      if (extra.friendlyName) info.friendlyName = extra.friendlyName;
      return info;
    }).sort(compareSerialPorts);
  }

  async connect(request: ConnectRequest): Promise<BackendStatus> {
    if (!request.path) {
      throw new Error("Serial port path is required.");
    }

    await this.disconnect();
    this.rawBytes = 0;
    this.parserErrors = 0;
    this.lastSerialError = null;

    const port = new SerialPort({
      path: request.path,
      baudRate: request.baudRate ?? defaultBaudRate,
      autoOpen: false
    });

    await new Promise<void>((resolve, reject) => {
      port.open((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    this.port = port;
    this.serialConnected = true;
    this.store.setConnected(true);

    const mavlinkStream = createMavLinkStream(port, {
      onCrcError: (packet) => {
        this.parserErrors += 1;
        console.warn(`Dropped MAVLink packet with invalid CRC (${packet.length} bytes).`);
      }
    });
    this.mavlinkStream = mavlinkStream;

    port.on("data", (chunk: Buffer) => {
      this.rawBytes += chunk.length;
    });
    mavlinkStream.on("data", (packet: MavLinkPacket) => this.applyPacket(packet));
    mavlinkStream.on("error", (error) => {
      this.parserErrors += 1;
      this.lastSerialError = error instanceof Error ? error.message : String(error);
      console.error("MAVLink parser error:", error);
      void this.disconnect();
    });

    port.on("close", () => {
      this.serialConnected = false;
      this.store.setConnected(false);
      this.emitTelemetry();
    });
    port.on("error", (error) => {
      this.lastSerialError = error.message;
      console.error("Serial port error:", error);
      void this.disconnect();
    });

    this.emitTelemetry();
    return this.getStatus();
  }

  async disconnect(): Promise<BackendStatus> {
    const port = this.port;
    const stream = this.mavlinkStream;

    this.port = null;
    this.mavlinkStream = null;

    if (stream) {
      stream.removeAllListeners();
      stream.destroy();
    }

    if (port) {
      port.removeAllListeners();
      if (port.isOpen) {
        await new Promise<void>((resolve, reject) => {
          port.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    }

    this.serialConnected = false;
    this.store.setConnected(false);
    this.emitTelemetry();
    return this.getStatus();
  }

  resetSession(): TelemetryState {
    this.store.reset();
    this.store.setConnected(this.serialConnected);
    const state = this.store.getState();
    this.emitTelemetry();
    return state;
  }

  getTelemetry(): TelemetryState {
    return this.store.getState();
  }

  getStatus(): BackendStatus {
    const telemetry = this.store.getState();
    return {
      serialConnected: this.serialConnected,
      mavlinkPackets: telemetry.packetCount,
      lastPacketMs: telemetry.lastPacketAt === null ? null : Date.now() - telemetry.lastPacketAt,
      rawBytes: this.rawBytes,
      txBytes: 0,
      parserErrors: this.parserErrors,
      lastSerialError: this.lastSerialError
    };
  }

  onTelemetry(listener: (telemetry: TelemetryState) => void): () => void {
    this.on("telemetry", listener);
    return () => this.off("telemetry", listener);
  }

  private applyPacket(packet: MavLinkPacket): void {
    applyMavlinkFrame(this.store, {
      sysid: packet.header.sysid,
      compid: packet.header.compid,
      msgid: packet.header.msgid,
      payload: dataViewFromBuffer(packet.payload)
    });
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.emit("telemetry", this.store.getState());
  }
}

function dataViewFromBuffer(buffer: Buffer): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

type ListedPort = Awaited<ReturnType<typeof SerialPort.list>>[number];

function isLikelyDeviceBackedPort(port: ListedPort): boolean {
  if (hasUsbOrPnpMetadata(port)) return true;
  if (/^COM\d+$/i.test(port.path)) return true;
  if (/^\/dev\/(?:cu|tty)\.usb/i.test(port.path)) return true;
  if (/^\/dev\/tty(?:ACM|USB)\d+$/i.test(port.path)) return true;

  return false;
}

function hasUsbOrPnpMetadata(port: ListedPort): boolean {
  return Boolean(
    port.manufacturer ||
      port.serialNumber ||
      port.vendorId ||
      port.productId ||
      port.pnpId ||
      port.locationId
  );
}

function detectTransport(port: ListedPort): SerialPortInfo["transport"] {
  if (port.vendorId || port.productId || /^\/dev\/(?:cu|tty)\.usb/i.test(port.path) || /^\/dev\/tty(?:ACM|USB)\d+$/i.test(port.path)) {
    return "usb";
  }

  if (/^COM\d+$/i.test(port.path)) {
    return "windows-com";
  }

  if (hasUsbOrPnpMetadata(port)) {
    return "serial";
  }

  return "unknown";
}

function displayNameForPort(port: ListedPort, friendlyName?: string): string {
  const name = friendlyName ?? port.manufacturer;
  if (!name) return port.path;
  return `${port.path} - ${name}`;
}

function compareSerialPorts(a: SerialPortInfo, b: SerialPortInfo): number {
  const priority = (port: SerialPortInfo) => {
    if (port.transport === "usb") return 0;
    if (port.transport === "windows-com") return 1;
    if (port.transport === "serial") return 2;
    return 3;
  };

  return priority(a) - priority(b) || a.path.localeCompare(b.path, undefined, { numeric: true });
}
