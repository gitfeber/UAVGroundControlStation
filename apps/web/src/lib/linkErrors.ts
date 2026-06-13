import type { BackendStatus } from "@uav-ground-control-station/shared";

export type LinkIssueSeverity = "error" | "warning";

export interface LinkIssue {
  id: string;
  severity: LinkIssueSeverity;
  title: string;
  message: string;
  detail?: string;
}

export interface LinkConnection {
  path: string;
  baudRate: number;
  startedAt: number;
}

const WEB_SERIAL_DENIED =
  /notfounderror|no port selected|user cancelled|user canceled|cancelled the request|canceled the request|permission denied|not allowed|must be handling a user gesture/i;
const PORT_BUSY = /resource busy|\bebusy\b|cannot lock|in use|already open|access is denied|failed to open serial port/i;

/** Operator-facing copy for connect() failures (Web Serial picker, desktop, server). */
export function describeConnectFailure(cause: unknown): LinkIssue {
  const name = cause instanceof Error ? cause.name : "";
  const raw = cause instanceof Error ? cause.message : String(cause);

  if (name === "NotFoundError" || WEB_SERIAL_DENIED.test(raw)) {
    return {
      id: "web-serial-denied",
      severity: "warning",
      title: "Serial access not granted",
      message: "Grant serial permission in your browser site settings, or pick a device when Connect prompts you."
    };
  }

  if (name === "SecurityError") {
    return {
      id: "web-serial-security",
      severity: "error",
      title: "Serial access blocked",
      message: "This page cannot open serial devices. Use HTTPS (or localhost) and allow serial access for this site."
    };
  }

  if (PORT_BUSY.test(raw)) {
    return {
      id: "port-busy",
      severity: "error",
      title: "Serial port in use",
      message: "Close other apps using this port (Mission Planner, QGroundControl, another GCS tab), then try Connect again.",
      detail: raw
    };
  }

  return {
    id: "connect-failed",
    severity: "error",
    title: "Connect failed",
    message: "Could not open the serial link. Check the port path, cable, and that the radio is powered.",
    detail: raw
  };
}

/** Map backend `lastSerialError` strings to operator guidance. */
export function describeSerialError(raw: string | null | undefined): LinkIssue | null {
  if (!raw?.trim()) return null;

  if (WEB_SERIAL_DENIED.test(raw)) {
    return {
      id: "serial-web-denied",
      severity: "warning",
      title: "Serial access not granted",
      message: "Grant serial permission in your browser site settings, or pick a device when Connect prompts you.",
      detail: raw
    };
  }

  if (PORT_BUSY.test(raw)) {
    return {
      id: "serial-port-busy",
      severity: "error",
      title: "Serial port in use",
      message: "Close other apps using this port, then reconnect.",
      detail: raw
    };
  }

  if (/unplugged|disconnect|stream ended|not readable/i.test(raw)) {
    return {
      id: "serial-disconnected",
      severity: "warning",
      title: "Serial link lost",
      message: "The USB device was unplugged or the stream ended. Reconnect when the cable and port are ready.",
      detail: raw
    };
  }

  return {
    id: "serial-error",
    severity: "error",
    title: "Serial error",
    message: "The serial link reported an error. Disconnect, verify the port and cable, then connect again.",
    detail: raw
  };
}

export function describeParserSpike(status: BackendStatus): LinkIssue | null {
  const parserErrors = status.parserErrors ?? 0;
  const packets = status.mavlinkPackets ?? 0;
  if (!status.serialConnected || parserErrors === 0) return null;
  if (parserErrors <= packets * 4) return null;

  return {
    id: "parser-spike",
    severity: "warning",
    title: "Parser errors rising",
    message: "Check baud rate and protocol (420000 for TX16S CRSF mirror; 115200/460800 for direct FC MAVLink). See Activity log for details.",
    detail: `${parserErrors.toLocaleString()} parser errors vs ${packets.toLocaleString()} decoded frames`
  };
}

export function describeNoRawBytes(connection: LinkConnection, txBytes: number): LinkIssue {
  return {
    id: "no-raw-bytes",
    severity: "warning",
    title: "No data on serial port",
    message:
      txBytes > 0
        ? `No bytes received on ${connection.path} after connect, although wake-up bytes were sent. The flight controller may not be on this port.`
        : `No bytes received on ${connection.path} after connect. Try 420000 baud for TX16S CRSF; check cable, USB mode, and that telemetry is enabled.`
  };
}

export function describeNoParsedFrames(connection: LinkConnection): LinkIssue {
  return {
    id: "no-parsed-frames",
    severity: "warning",
    title: "Bytes arriving but no telemetry frames",
    message: `Data is arriving on ${connection.path}, but no telemetry frames decoded. For TX16S CRSF mirror use 420000 baud; for direct FC MAVLink try 115200 or 460800.`
  };
}

/** Active link issues for topbar / activity log banners (live mode only). */
export function resolveLinkIssues(input: {
  status: BackendStatus;
  connectError: string | null;
  connection: LinkConnection | null;
  nowMs: number;
  liveMode: boolean;
}): LinkIssue[] {
  if (!input.liveMode) return [];

  const issues: LinkIssue[] = [];
  const seen = new Set<string>();

  function push(issue: LinkIssue | null): void {
    if (!issue || seen.has(issue.id)) return;
    seen.add(issue.id);
    issues.push(issue);
  }

  if (input.connectError) {
    push({
      id: "connect-error-active",
      severity: "error",
      title: "Connect failed",
      message: input.connectError
    });
  }

  push(describeSerialError(input.status.lastSerialError));
  push(describeParserSpike(input.status));

  const connection = input.connection;
  if (connection && input.status.serialConnected) {
    const elapsedMs = input.nowMs - connection.startedAt;
    const rawBytes = input.status.rawBytes ?? 0;
    const txBytes = input.status.txBytes ?? 0;
    const packets = input.status.mavlinkPackets ?? 0;

    if (elapsedMs > 3000 && rawBytes === 0) {
      push(describeNoRawBytes(connection, txBytes));
    }

    if (elapsedMs > 5000 && rawBytes > 0 && packets === 0) {
      push(describeNoParsedFrames(connection));
    }
  }

  return issues;
}

export function linkIssueLogMessage(issue: LinkIssue): string {
  return issue.detail ? `${issue.message} (${issue.detail})` : issue.message;
}

export function connectFailureMessage(cause: unknown): string {
  return describeConnectFailure(cause).message;
}
