import { describe, expect, it } from "vitest";
import { validateSerialPortPath } from "./connectRequest.js";

describe("validateSerialPortPath", () => {
  const accepted = [
    "COM3",
    "COM12",
    "/dev/ttyUSB0",
    "/dev/ttyACM0",
    "/dev/ttyAMA0",
    "/dev/ttyS0",
    "/dev/cu.usbserial-0001",
    "/dev/tty.usbmodem101",
    "/dev/serial/by-id/usb-Example_Device-if00",
    "/dev/serial/by-path/platform-xhci-hcd.0-usb-0:1:1.0",
    "/dev/rfcomm0"
  ];

  const rejected = [
    ["/dev/null", "Serial port path is not a supported device path."],
    ["/dev/zero", "Serial port path is not a supported device path."],
    ["/dev/random", "Serial port path is not a supported device path."],
    ["/dev/sda", "Serial port path is not a supported device path."],
    ["/dev/input/event0", "Serial port path is not a supported device path."],
    ["/dev/disk/by-id/foo", "Serial port path is not a supported device path."],
    ["/etc/passwd", "Serial port path is not a supported device path."],
    ["/dev/../etc/passwd", "Serial port path is not allowed."],
    ["   ", "Serial port path is required."]
  ] as const;

  it.each(accepted)("accepts plausible serial path %s", (path) => {
    expect(validateSerialPortPath(path)).toBeNull();
  });

  it.each(rejected)("rejects %s", (path, message) => {
    expect(validateSerialPortPath(path)).toBe(message);
  });
});
