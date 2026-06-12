import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { validateControlRequestOrigin } from "./requestOriginSafety.js";

function requestWithOrigin(origin: string | undefined): FastifyRequest {
  return { headers: { origin } } as FastifyRequest;
}

describe("validateControlRequestOrigin", () => {
  it("allows requests with no Origin header", () => {
    expect(validateControlRequestOrigin(requestWithOrigin(undefined))).toBeNull();
  });

  it("allows the Vite dev UI origins", () => {
    expect(validateControlRequestOrigin(requestWithOrigin("http://localhost:5173"))).toBeNull();
    expect(validateControlRequestOrigin(requestWithOrigin("http://127.0.0.1:5173"))).toBeNull();
  });

  it("rejects cross-origin browser requests", () => {
    const error = validateControlRequestOrigin(requestWithOrigin("https://evil.example"));
    expect(error).toBe("Cross-origin requests to serial-control endpoints are not allowed.");
  });
});
