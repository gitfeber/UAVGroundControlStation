import { buildApp } from "./buildApp.js";
import { warnIfNonLoopbackHost } from "./hostSafety.js";
import { LoggerService } from "./services/loggerService.js";
import { SerialMavlinkService } from "./services/serialMavlinkService.js";
import { WebSocketHub } from "./services/websocketHub.js";

const serial = new SerialMavlinkService();
const hub = new WebSocketHub();
const logger = new LoggerService();
const app = await buildApp({ serial, hub, logger });

setInterval(() => {
  const status = serial.getStatus();
  hub.broadcastTelemetry(serial.getTelemetry());
  hub.broadcastStatus(status);
  logger.writeTelemetry(serial.getTelemetry());
}, 250);

const port = Number(process.env.PORT ?? 3001);
// Default to loopback. This server exposes unauthenticated serial-control
// endpoints (open/close the link to flight hardware); binding a routable
// interface grants any device on the network remote control. Setting HOST to a
// non-loopback address is a deliberate, at-your-own-risk opt-in. See
// docs/adr/0002-server-loopback-only.md.
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  warnIfNonLoopbackHost(host);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
