/** Documented GCS baud rates (see README and Topbar). */
export const ALLOWED_BAUD_RATES = [57600, 115200, 420000, 460800] as const;

export const SERIAL_PORT_PATH_MAX_LENGTH = 256;

const WINDOWS_COM = /^COM[1-9]\d*$/i;
const MAC_TTY_OR_CU = /^\/dev\/(tty|cu)\.[A-Za-z0-9._-]+$/;
const LINUX_TTY_SERIAL = /^\/dev\/tty[A-Za-z0-9._-]+$/;
const LINUX_SERIAL_BY_ID = /^\/dev\/serial\/by-(id|path)\/[A-Za-z0-9._:+@-]+$/;
const LINUX_RFCOMM = /^\/dev\/rfcomm\d+$/;

const SERIAL_PORT_PATTERNS = [
  WINDOWS_COM,
  MAC_TTY_OR_CU,
  LINUX_TTY_SERIAL,
  LINUX_SERIAL_BY_ID,
  LINUX_RFCOMM
] as const;

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function matchesSerialPortPattern(path: string): boolean {
  return SERIAL_PORT_PATTERNS.some((pattern) => pattern.test(path));
}

export function validateSerialPortPath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return "Serial port path is required.";
  }
  if (trimmed.length > SERIAL_PORT_PATH_MAX_LENGTH) {
    return "Serial port path is too long.";
  }
  if (containsControlCharacters(trimmed)) {
    return "Serial port path contains invalid characters.";
  }
  if (trimmed.includes("..")) {
    return "Serial port path is not allowed.";
  }
  if (matchesSerialPortPattern(trimmed)) {
    return null;
  }
  return "Serial port path is not a supported device path.";
}

export function validateBaudRate(baudRate: number | undefined): string | null {
  if (baudRate === undefined) {
    return null;
  }
  if (!Number.isInteger(baudRate)) {
    return "Baud rate must be an integer.";
  }
  if (!(ALLOWED_BAUD_RATES as readonly number[]).includes(baudRate)) {
    return `Baud rate must be one of: ${ALLOWED_BAUD_RATES.join(", ")}.`;
  }
  return null;
}

export const connectRouteSchema = {
  body: {
    type: "object",
    required: ["path"],
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        minLength: 1,
        maxLength: SERIAL_PORT_PATH_MAX_LENGTH
      },
      baudRate: {
        type: "integer",
        enum: [...ALLOWED_BAUD_RATES]
      }
    }
  }
} as const;
