import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ConnectRequest, TelemetryState } from "@uav-ground-control-station/shared";
import { LoggerService } from "./services/loggerService.js";
import { SerialMavlinkService } from "./services/serialMavlinkService.js";
import type { SerialService } from "./services/serialService.js";
import { WebSocketHub } from "./services/websocketHub.js";
import {
  connectRouteSchema,
  validateBaudRate,
  validateSerialPortPath
} from "./validation/connectRequest.js";

export interface AppServices {
  serial: SerialService;
  hub: WebSocketHub;
  logger: LoggerService;
}

export async function buildApp(services?: Partial<AppServices>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false
      }
    }
  });
  const serial = services?.serial ?? new SerialMavlinkService();
  const hub = services?.hub ?? new WebSocketHub();
  const logger = services?.logger ?? new LoggerService();

  let latestTelemetry: TelemetryState = serial.getTelemetry();

  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"]
  });
  await app.register(websocket);

  serial.onTelemetry((telemetry) => {
    latestTelemetry = telemetry;
  });

  app.get("/api/ports", async () => serial.listPorts());

  app.post<{ Body: ConnectRequest }>(
    "/api/connect",
    {
      schema: connectRouteSchema,
      preHandler: async (request, reply) => {
        const body = request.body;
        const pathError = validateSerialPortPath(body.path);
        if (pathError) {
          return reply.code(400).send({ error: pathError });
        }
        const baudError = validateBaudRate(body.baudRate);
        if (baudError) {
          return reply.code(400).send({ error: baudError });
        }
      }
    },
    async (request, reply) => {
      try {
        return await serial.connect({
          path: request.body.path.trim(),
          ...(request.body.baudRate !== undefined ? { baudRate: request.body.baudRate } : {})
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to connect serial port.";
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post("/api/disconnect", async () => serial.disconnect());

  app.post("/api/reset", async () => serial.resetSession());

  app.get("/api/status", async () => serial.getStatus());

  app.post("/api/logging/start", async () => logger.start());

  app.post("/api/logging/stop", async () => logger.stop());

  app.get("/api/logging/status", async () => logger.status());

  app.get("/ws", { websocket: true }, (socket) => {
    hub.add(socket, latestTelemetry, serial.getStatus());
  });

  return app;
}
