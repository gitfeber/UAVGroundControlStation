import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { ConnectRequest, TelemetryState } from "@uav-ground-control-station/shared";
import { LoggerService } from "./services/loggerService.js";
import { SerialMavlinkService } from "./services/serialMavlinkService.js";
import { WebSocketHub } from "./services/websocketHub.js";

const app = Fastify({ logger: true });
const serial = new SerialMavlinkService();
const hub = new WebSocketHub();
const logger = new LoggerService();

let latestTelemetry: TelemetryState = serial.getTelemetry();

await app.register(cors, {
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"]
});
await app.register(websocket);

serial.onTelemetry((telemetry) => {
  latestTelemetry = telemetry;
});

app.get("/api/ports", async () => serial.listPorts());

app.post<{ Body: ConnectRequest }>("/api/connect", async (request, reply) => {
  try {
    return await serial.connect(request.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect serial port.";
    return reply.code(400).send({ error: message });
  }
});

app.post("/api/disconnect", async () => serial.disconnect());

app.post("/api/reset", async () => serial.resetSession());

app.get("/api/status", async () => serial.getStatus());

app.post("/api/logging/start", async () => logger.start());

app.post("/api/logging/stop", async () => logger.stop());

app.get("/api/logging/status", async () => logger.status());

app.get("/ws", { websocket: true }, (socket) => {
  hub.add(socket, latestTelemetry, serial.getStatus());
});

setInterval(() => {
  const status = serial.getStatus();
  hub.broadcastTelemetry(latestTelemetry);
  hub.broadcastStatus(status);
  logger.writeTelemetry(latestTelemetry);
}, 250);

const port = Number(process.env.PORT ?? 3001);
// Default to loopback. This server exposes unauthenticated serial-control
// endpoints (open/close the link to flight hardware); binding a routable
// interface grants any device on the network remote control. Setting HOST to a
// non-loopback address is a deliberate, at-your-own-risk opt-in. See
// docs/adr/0002-server-loopback-only.md.
const host = process.env.HOST ?? "127.0.0.1";
const isLoopbackHost = host === "127.0.0.1" || host === "::1" || host === "localhost";

try {
  await app.listen({ port, host });
  if (!isLoopbackHost) {
    app.log.warn(
      `Serial-control API is bound to ${host} (non-loopback) with no authentication. Any device that can reach this host can open or close the link to flight hardware.`
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
