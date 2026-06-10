/** Hostnames treated as local-only for the unauthenticated serial-control API. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const NON_LOOPBACK_BIND_WARNING =
  "[UAV GCS] SECURITY: Serial-control API is bound to a non-loopback address ({host}) with no authentication. Any device that can reach this host can open or close the link to flight hardware.";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(normalized);
}

export function warnIfNonLoopbackHost(host: string): void {
  if (isLoopbackHost(host)) {
    return;
  }

  console.warn(NON_LOOPBACK_BIND_WARNING.replace("{host}", host));
}
