import type { BackendStatus, TelemetryState } from "@uav-ground-control-station/shared";

interface WebSocketLike {
  readyState: number;
  send: (data: string) => void;
  on?: (event: "close" | "error", listener: () => void) => void;
}

const websocketOpen = 1;

export class WebSocketHub {
  private clients = new Set<WebSocketLike>();

  add(client: WebSocketLike, telemetry: TelemetryState, status: BackendStatus): void {
    this.clients.add(client);
    client.on?.("close", () => this.clients.delete(client));
    client.on?.("error", () => this.clients.delete(client));

    this.send(client, { type: "telemetry", data: telemetry });
    this.send(client, { type: "status", data: status });
  }

  broadcastTelemetry(data: TelemetryState): void {
    this.broadcast({ type: "telemetry", data });
  }

  broadcastStatus(data: BackendStatus): void {
    this.broadcast({ type: "status", data });
  }

  private broadcast(payload: unknown): void {
    for (const client of this.clients) {
      this.send(client, payload);
    }
  }

  private send(client: WebSocketLike, payload: unknown): void {
    if (client.readyState !== websocketOpen) {
      this.clients.delete(client);
      return;
    }

    client.send(JSON.stringify(payload));
  }
}
