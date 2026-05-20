import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoggingStatus, TelemetryState } from "@uav-ground-control-station/shared";

const logsDir = fileURLToPath(new URL("../../../../logs", import.meta.url));

export class LoggerService {
  private stream: WriteStream | null = null;
  private filePath: string | null = null;

  start(): LoggingStatus {
    if (this.stream) {
      return this.status();
    }

    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const filePath = join(logsDir, `flight-${timestampForFile()}.jsonl`);
    this.filePath = filePath;
    this.stream = createWriteStream(filePath, { flags: "a" });
    return this.status();
  }

  stop(): LoggingStatus {
    this.stream?.end();
    this.stream = null;
    this.filePath = null;
    return this.status();
  }

  status(): LoggingStatus {
    return {
      active: this.stream !== null,
      filePath: this.filePath
    };
  }

  writeTelemetry(data: TelemetryState): void {
    if (!this.stream) return;

    const entry = {
      time: Date.now(),
      type: "telemetry",
      data: compactTelemetry(data)
    };

    this.stream.write(`${JSON.stringify(entry)}\n`);
  }
}

function timestampForFile(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function compactTelemetry(data: TelemetryState): Partial<TelemetryState> {
  return {
    connected: data.connected,
    lastPacketAt: data.lastPacketAt,
    packetCount: data.packetCount,
    vehicle: data.vehicle,
    position: data.position,
    gps: data.gps,
    motion: data.motion,
    battery: data.battery,
    radio: data.radio,
    system: {
      loadPercent: data.system.loadPercent,
      statusText: data.system.statusText.slice(0, 5)
    },
    stats: data.stats
  };
}
