/**
 * Web Serial is Chromium-only and requires a secure context (HTTPS or
 * localhost). The cloud runtime gates the connect UI on this and shows a clear
 * fallback notice on Firefox/Safari or plain HTTP.
 */
export function isWebSerialSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serial" in navigator &&
    typeof window !== "undefined" &&
    window.isSecureContext
  );
}

/** Human-readable reason the cloud runtime can't run, or null when supported. */
export function webSerialUnsupportedReason(): string | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return "This runtime requires a browser environment.";
  }
  if (!("serial" in navigator)) {
    return "Web Serial is not available. Use a Chromium-based browser (Chrome, Edge, Opera) — Firefox and Safari don't support it.";
  }
  if (!window.isSecureContext) {
    return "Web Serial requires a secure context. Open this app over HTTPS (or localhost).";
  }
  return null;
}
