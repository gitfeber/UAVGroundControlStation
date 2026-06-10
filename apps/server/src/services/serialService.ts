import type { BackendStatus, ConnectRequest, SerialPortInfo, TelemetryState } from "@uav-ground-control-station/shared";

/** Minimal serial contract used by HTTP routes and tests. */
export interface SerialService {
  getTelemetry(): TelemetryState;
  getStatus(): BackendStatus;
  listPorts(): Promise<SerialPortInfo[]>;
  connect(request: ConnectRequest): Promise<BackendStatus>;
  disconnect(): Promise<BackendStatus>;
  resetSession(): TelemetryState;
  onTelemetry(listener: (telemetry: TelemetryState) => void): void | (() => void);
}
