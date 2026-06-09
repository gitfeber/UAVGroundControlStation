import {
  applyCrsfFrame,
  applyMavlinkFrame,
  crsfMessageId,
  crsfMessageLabel,
  messageIds,
  TelemetryStore,
  type BackendStatus,
  type MavlinkMessageStat,
  type TelemetryState
} from "@uav-ground-control-station/shared";
import { CrsfFramer } from "./crsfFramer";
import { MavlinkFramer } from "./mavlinkFramer";

export interface WebSerialLinkCallbacks {
  onTelemetry: (state: TelemetryState) => void;
  onStatus: (status: BackendStatus) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
}

const CRSF_LATCH_THRESHOLD = 3;
const CRSF_DECAY_MS = 3000;

/**
 * Browser-side telemetry link for the cloud runtime. Reads a user-selected
 * serial device with the Web Serial API, frames CRSF (TX16S) and/or MAVLink,
 * and decodes into the shared {@link TelemetryStore}.
 */
export class WebSerialLink {
  private readonly store = new TelemetryStore();
  private readonly mavlinkFramer = new MavlinkFramer();
  private readonly crsfFramer = new CrsfFramer();
  private readonly callbacks: WebSerialLinkCallbacks;

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopDone: Promise<void> = Promise.resolve();
  private connected = false;
  private closing = false;
  private rawBytes = 0;
  private lastSerialError: string | null = null;
  private baudRate = 115200;
  private crsfPrimary = false;
  private crsfFrameCount = 0;
  private lastCrsfFrameAt = 0;
  private readonly messageCounts = new Map<number, MavlinkMessageStat>();

  private readonly onPortDisconnect = (): void => {
    void this.disconnect("Serial device was unplugged.");
  };
  private readonly onBeforeUnload = (): void => {
    void this.disconnect("Page is closing.");
  };

  constructor(callbacks: WebSerialLinkCallbacks) {
    this.callbacks = callbacks;
  }

  isConnected(): boolean {
    return this.connected;
  }

  resetSession(): void {
    this.store.reset();
    this.mavlinkFramer.reset();
    this.crsfFramer.reset();
    this.store.setConnected(this.connected);
    this.rawBytes = 0;
    this.lastSerialError = null;
    this.crsfFrameCount = 0;
    this.crsfPrimary = this.baudRate === 420000;
    this.messageCounts.clear();
    this.emitStatus();
    this.emitTelemetry();
  }

  getStatus(): BackendStatus {
    const state = this.store.getState();
    return {
      serialConnected: this.connected,
      mavlinkPackets: state.packetCount,
      lastPacketMs: state.lastPacketAt === null ? null : Date.now() - state.lastPacketAt,
      rawBytes: this.rawBytes,
      txBytes: 0,
      parserErrors: this.mavlinkFramer.crcErrors,
      lastSerialError: this.lastSerialError,
      mavlinkMessages: topMessageStats(this.messageCounts)
    };
  }

  async connect(baudRate: number): Promise<void> {
    if (this.connected || this.closing) {
      await this.disconnect("Reconnecting.");
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate });

    this.baudRate = baudRate;
    this.store.reset();
    this.mavlinkFramer.reset();
    this.crsfFramer.reset();
    this.store.setConnected(true);
    this.port = port;
    this.connected = true;
    this.closing = false;
    this.rawBytes = 0;
    this.lastSerialError = null;
    this.crsfFrameCount = 0;
    this.crsfPrimary = baudRate === 420000;
    this.lastCrsfFrameAt = 0;
    this.messageCounts.clear();

    port.addEventListener("disconnect", this.onPortDisconnect);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.onBeforeUnload);
    }

    this.callbacks.onOpen?.();
    this.emitStatus();
    this.emitTelemetry();

    this.readLoopDone = this.readLoop(port);
  }

  async disconnect(reason = "Disconnected."): Promise<void> {
    if (this.closing || (!this.connected && this.port === null)) {
      return;
    }
    this.closing = true;

    const reader = this.reader;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* reader may already be errored/released after an unplug */
      }
    }
    await this.readLoopDone;

    if (this.port) {
      await this.finishClose(this.port, reason);
    }
  }

  private async readLoop(port: SerialPort): Promise<void> {
    if (!port.readable) {
      if (!this.closing) await this.finishClose(port, "Serial port is not readable.");
      return;
    }

    const reader = port.readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) this.ingest(value);
      }
    } catch (cause: unknown) {
      this.lastSerialError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* lock already released via cancel() */
      }
      this.reader = null;
    }

    if (!this.closing) {
      await this.finishClose(port, this.lastSerialError ?? "Serial stream ended.");
    }
  }

  private ingest(chunk: Uint8Array): void {
    this.rawBytes += chunk.byteLength;
    const listenOnly = this.baudRate === 420000;
    const now = Date.now();

    if (this.crsfPrimary && !listenOnly && this.lastCrsfFrameAt > 0 && now - this.lastCrsfFrameAt >= CRSF_DECAY_MS) {
      this.crsfPrimary = false;
      this.crsfFrameCount = 0;
    }

    let telemetryDirty = false;
    const crsfFrames = this.crsfFramer.push(chunk);
    if (crsfFrames.length > 0) {
      this.crsfFrameCount += crsfFrames.length;
      this.lastCrsfFrameAt = now;
      if (!listenOnly && this.crsfFrameCount >= CRSF_LATCH_THRESHOLD) {
        this.crsfPrimary = true;
      }
      telemetryDirty = true;
    }

    for (const frame of crsfFrames) {
      this.recordMessageStat(crsfMessageId(frame.frameType), crsfMessageLabel(frame.frameType));
      applyCrsfFrame(this.store, frame);
    }

    if (!this.crsfPrimary) {
      const mavlinkFrames = this.mavlinkFramer.push(chunk);
      if (mavlinkFrames.length > 0) {
        telemetryDirty = true;
      }
      for (const frame of mavlinkFrames) {
        this.recordMessageStat(frame.msgid, mavlinkMessageLabel(frame.msgid));
        applyMavlinkFrame(this.store, frame);
      }
    }

    if (telemetryDirty) this.emitTelemetry();
    this.emitStatus();
  }

  private recordMessageStat(id: number, label: string): void {
    const existing = this.messageCounts.get(id);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = Date.now();
      existing.label = label;
      return;
    }
    this.messageCounts.set(id, { id, label, count: 1, lastSeenAt: Date.now() });
  }

  private async finishClose(port: SerialPort, reason: string): Promise<void> {
    port.removeEventListener("disconnect", this.onPortDisconnect);
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.onBeforeUnload);
    }
    try {
      await port.close();
    } catch {
      /* port may already be gone after an unplug */
    }
    if (this.port === port) this.port = null;

    if (this.connected) {
      this.connected = false;
      this.store.setConnected(false);
      this.emitStatus();
      this.emitTelemetry();
      this.callbacks.onClose?.(reason);
    }
    this.closing = false;
  }

  private emitTelemetry(): void {
    this.callbacks.onTelemetry(this.store.getState());
  }

  private emitStatus(): void {
    this.callbacks.onStatus(this.getStatus());
  }
}

function topMessageStats(counts: Map<number, MavlinkMessageStat>): MavlinkMessageStat[] {
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
}

function mavlinkMessageLabel(messageId: number): string {
  switch (messageId) {
    case messageIds.heartbeat:
      return "HEARTBEAT";
    case messageIds.sysStatus:
      return "SYS_STATUS";
    case messageIds.gpsRawInt:
      return "GPS_RAW_INT";
    case messageIds.attitude:
      return "ATTITUDE";
    case messageIds.globalPositionInt:
      return "GLOBAL_POSITION_INT";
    case messageIds.navControllerOutput:
      return "NAV_CONTROLLER_OUTPUT";
    case messageIds.rcChannels:
      return "RC_CHANNELS";
    case messageIds.vfrHud:
      return "VFR_HUD";
    case messageIds.radioStatus:
      return "RADIO_STATUS";
    case messageIds.batteryStatus:
      return "BATTERY_STATUS";
    case messageIds.statusText:
      return "STATUSTEXT";
    default:
      return `MSG_${messageId}`;
  }
}
