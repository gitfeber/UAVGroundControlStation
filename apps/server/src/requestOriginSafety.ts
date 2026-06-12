import type { FastifyRequest } from "fastify";

/** Browser origins allowed to invoke state-changing serial-control routes (CSRF guard). */
export const ALLOWED_CONTROL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

/**
 * Rejects browser-initiated cross-origin POSTs to the unauthenticated serial-control
 * API (ADR 0002). Non-browser clients that omit `Origin` (curl, local scripts) are
 * allowed so bench tooling keeps working.
 */
export function validateControlRequestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (!origin) {
    return null;
  }

  if ((ALLOWED_CONTROL_ORIGINS as readonly string[]).includes(origin)) {
    return null;
  }

  return "Cross-origin requests to serial-control endpoints are not allowed.";
}
