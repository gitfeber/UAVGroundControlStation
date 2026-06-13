import { describe, expect, it } from "vitest";
import { isVideoSignalGood } from "./useVideoSignalStatus";

describe("isVideoSignalGood", () => {
  it("returns true only for good status", () => {
    expect(isVideoSignalGood("good")).toBe(true);
    expect(isVideoSignalGood("connecting")).toBe(false);
    expect(isVideoSignalGood("error")).toBe(false);
    expect(isVideoSignalGood("none")).toBe(false);
  });
});
