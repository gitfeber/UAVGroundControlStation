import { describe, expect, it } from "vitest";
import { sanitizeHttpUrl, sanitizeTileTemplateUrl } from "./safeHttpUrl";

describe("sanitizeHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(sanitizeHttpUrl("http://127.0.0.1:8080/stream")).toBe("http://127.0.0.1:8080/stream");
    expect(sanitizeHttpUrl("https://example.com/video.mjpg")).toBe("https://example.com/video.mjpg");
  });

  it("rejects dangerous or unsupported schemes", () => {
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeHttpUrl("data:text/html,hi")).toBe("");
    expect(sanitizeHttpUrl("file:///etc/passwd")).toBe("");
  });

  it("rejects URLs with embedded credentials", () => {
    expect(sanitizeHttpUrl("http://user:pass@localhost/stream")).toBe("");
  });

  it("preserves tile template placeholders", () => {
    expect(sanitizeTileTemplateUrl("https://example.test/{z}/{x}/{y}.png")).toBe(
      "https://example.test/{z}/{x}/{y}.png"
    );
  });
});
