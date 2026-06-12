import { finiteNumber, finiteOrNull } from "@uav-ground-control-station/shared";
import { describe, expect, it } from "vitest";

describe("finiteNumber helpers", () => {
  it("maps non-finite values to null", () => {
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(12.5)).toBe(12.5);
  });

  it("finiteNumber rejects non-finite numbers", () => {
    expect(finiteNumber(Number.NaN)).toBeNull();
    expect(finiteNumber(0)).toBe(0);
  });
});
