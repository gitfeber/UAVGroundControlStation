import { describe, expect, it } from "vitest";
import {
  connectFailureMessage,
  describeConnectFailure,
  describeNoParsedFrames,
  describeNoRawBytes,
  describeParserSpike,
  describeSerialError,
  resolveLinkIssues
} from "./linkErrors";

describe("describeConnectFailure", () => {
  it("maps Web Serial denial to site-settings guidance", () => {
    const issue = describeConnectFailure(new DOMException("User cancelled the request.", "NotFoundError"));
    expect(issue.id).toBe("web-serial-denied");
    expect(issue.message).toMatch(/site settings/i);
  });

  it("maps port busy errors", () => {
    const issue = describeConnectFailure(new Error("Resource busy (cannot open port)"));
    expect(issue.id).toBe("port-busy");
    expect(issue.message).toMatch(/Close other apps/i);
  });
});

describe("describeSerialError", () => {
  it("maps unplugged copy", () => {
    const issue = describeSerialError("Serial device was unplugged.");
    expect(issue?.id).toBe("serial-disconnected");
  });
});

describe("describeParserSpike", () => {
  it("flags when parser errors dominate decoded frames", () => {
    const issue = describeParserSpike({
      serialConnected: true,
      mavlinkPackets: 10,
      lastPacketMs: 100,
      parserErrors: 50
    });
    expect(issue?.id).toBe("parser-spike");
    expect(issue?.message).toMatch(/baud rate/i);
  });

  it("ignores low parser error counts", () => {
    expect(
      describeParserSpike({
        serialConnected: true,
        mavlinkPackets: 100,
        lastPacketMs: 100,
        parserErrors: 2
      })
    ).toBeNull();
  });
});

describe("resolveLinkIssues", () => {
  const connection = { path: "COM3", baudRate: 420000, startedAt: 0 };

  it("returns no issues outside live mode", () => {
    expect(
      resolveLinkIssues({
        status: { serialConnected: true, mavlinkPackets: 0, lastPacketMs: null, lastSerialError: "busy" },
        connectError: null,
        connection,
        nowMs: 10_000,
        liveMode: false
      })
    ).toEqual([]);
  });

  it("surfaces silence and parser issues while connected", () => {
    const issues = resolveLinkIssues({
      status: {
        serialConnected: true,
        mavlinkPackets: 0,
        lastPacketMs: null,
        rawBytes: 128,
        parserErrors: 40
      },
      connectError: null,
      connection,
      nowMs: 10_000,
      liveMode: true
    });

    expect(issues.map((issue) => issue.id)).toEqual(expect.arrayContaining(["no-parsed-frames", "parser-spike"]));
  });
});

describe("connectFailureMessage", () => {
  it("returns operator message string", () => {
    expect(connectFailureMessage(new Error("Resource busy"))).toMatch(/Close other apps/i);
  });
});

describe("describeNoRawBytes", () => {
  const connection = { path: "COM3", baudRate: 420000, startedAt: 0 };

  it("mentions CRSF baud when no wake-up bytes were sent", () => {
    expect(describeNoRawBytes(connection, 0).message).toMatch(/420000/);
  });
});

describe("describeNoParsedFrames", () => {
  const connection = { path: "COM3", baudRate: 420000, startedAt: 0 };

  it("mentions CRSF and MAVLink baud options", () => {
    expect(describeNoParsedFrames(connection).message).toMatch(/420000/);
    expect(describeNoParsedFrames(connection).message).toMatch(/115200/);
  });
});
