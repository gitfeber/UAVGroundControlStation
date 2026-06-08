import { describe, expect, it } from "vitest";
import { aggregateTargetQuality } from "./quality.js";

describe("aggregateTargetQuality", () => {
  it("marks bad reasons as invalid even when coordinates exist", () => {
    const result = aggregateTargetQuality(["dem_not_loaded"], true);
    expect(result.quality).toBe("bad");
    expect(result.valid).toBe(false);
  });

  it("keeps warn reasons valid with coordinates", () => {
    const result = aggregateTargetQuality(["gps_few_satellites"], true);
    expect(result.quality).toBe("warn");
    expect(result.valid).toBe(true);
  });

  it("prefers bad over warn when both are present", () => {
    const result = aggregateTargetQuality(["gps_few_satellites", "gps_no_3d_fix"], true);
    expect(result.quality).toBe("bad");
    expect(result.valid).toBe(false);
  });
});
