import { EventEmitter } from "node:events";
import mavlink from "node-mavlink";
import type { MavLinkPacket } from "node-mavlink";
import { SerialPort } from "serialport";
import type { BackendStatus, ConnectRequest, SerialPortInfo, TelemetryState } from "@uav-ground-control-station/shared";
import { TelemetryStore } from "./telemetryState.js";

const defaultBaudRate = 460800;
const { createMavLinkStream } = mavlink as typeof import("node-mavlink");

const messageIds = {
  heartbeat: 0,
  sysStatus: 1,
  gpsRawInt: 24,
  attitude: 30,
  globalPositionInt: 33,
  navControllerOutput: 62,
  rcChannels: 65,
  vfrHud: 74,
  radioStatus: 109,
  batteryStatus: 147,
  statusText: 253
} as const;

export class SerialMavlinkService extends EventEmitter {
  private readonly store = new TelemetryStore();
  private port: SerialPort | null = null;
  private serialConnected = false;

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
        console.warn(`Dropped MAVLink packet with invalid CRC (${packet.length} bytes).`);
      }
    });

    mavlinkStream.on("data", (packet: MavLinkPacket) => this.applyPacket(packet));
    mavlinkStream.on("error", (error) => {
      console.error("MAVLink parser error:", error);
    });

    port.on("close", () => {
      this.serialConnected = false;
      this.store.setConnected(false);
      this.emitTelemetry();
    });
    port.on("error", (error) => {
      console.error("Serial port error:", error);
    });

    this.emitTelemetry();
    return this.getStatus();
  }

  async disconnect(): Promise<BackendStatus> {
    if (this.port?.isOpen) {
      const port = this.port;
      await new Promise<void>((resolve, reject) => {
        port.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    this.port = null;
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
      lastPacketMs: telemetry.lastPacketAt === null ? null : Date.now() - telemetry.lastPacketAt
    };
  }

  onTelemetry(listener: (telemetry: TelemetryState) => void): () => void {
    this.on("telemetry", listener);
    return () => this.off("telemetry", listener);
  }

  private applyPacket(packet: MavLinkPacket): void {
    const payload = dataViewFromBuffer(packet.payload);
    this.store.markPacket(packet.header.sysid, packet.header.compid);

    switch (packet.header.msgid) {
      case messageIds.heartbeat:
        this.store.updateHeartbeat(payload);
        break;
      case messageIds.sysStatus:
        this.store.updateSysStatus(payload);
        break;
      case messageIds.batteryStatus:
        this.store.updateBatteryStatus(payload);
        break;
      case messageIds.gpsRawInt:
        this.store.updateGpsRawInt(payload);
        break;
      case messageIds.globalPositionInt:
        this.store.updateGlobalPositionInt(payload);
        break;
      case messageIds.vfrHud:
        this.store.updateVfrHud(payload);
        break;
      case messageIds.attitude:
        this.store.updateAttitude(payload);
        break;
      case messageIds.radioStatus:
        this.store.updateRadioStatus(payload);
        break;
      case messageIds.rcChannels:
        this.store.updateRcChannels(payload);
        break;
      case messageIds.statusText:
        this.store.updateStatusText(payload);
        break;
      case messageIds.navControllerOutput:
        this.store.updateNavControllerOutput(payload);
        break;
      default:
        break;
    }

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
