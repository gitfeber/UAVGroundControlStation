const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const REMOTE_SERIAL_CONTROL_API_BANNER =
  "Remote serial-control API — this dashboard talks to an unauthenticated server beyond loopback. Any device on the network can open or close the link to flight hardware.";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(normalized);
}

function resolveUrlHostCandidate(
  value: string | undefined,
  fallbackOrigin: string | undefined
): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    if (!fallbackOrigin) {
      return null;
    }

    try {
      return new URL(fallbackOrigin).hostname;
    } catch {
      return null;
    }
  }

  try {
    const parsed = fallbackOrigin ? new URL(trimmed, fallbackOrigin) : new URL(trimmed);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Returns a banner message when the browser stack is configured to reach a
 * non-loopback Node server via explicit env URLs, relative API paths, or a
 * non-loopback page origin (same-origin / relative fallback).
 */
export function getRemoteSerialControlApiBanner(
  apiBaseUrl: string | undefined,
  wsUrl: string | undefined,
  fallbackOrigin: string | undefined
): string | null {
  const hostCandidates = [
    resolveUrlHostCandidate(apiBaseUrl, fallbackOrigin),
    resolveUrlHostCandidate(wsUrl, fallbackOrigin)
  ];

  for (const hostname of hostCandidates) {
    if (hostname && !isLoopbackHostname(hostname)) {
      return REMOTE_SERIAL_CONTROL_API_BANNER;
    }
  }

  return null;
}
