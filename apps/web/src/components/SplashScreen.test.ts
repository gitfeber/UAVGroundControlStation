import { describe, expect, it } from "vitest";
import { progressAtElapsed } from "../lib/splashProgress";

describe("progressAtElapsed", () => {
  it("returns 0 before the first keyframe", () => {
    expect(progressAtElapsed(-10)).toBe(0);
    expect(progressAtElapsed(0)).toBe(0);
  });

  it("interpolates between irregular progress keyframes", () => {
    expect(progressAtElapsed(180)).toBe(7);
    expect(progressAtElapsed(270)).toBeCloseTo(12.5, 5);
    expect(progressAtElapsed(2200)).toBe(100);
  });

  it("holds the final value after completion", () => {
    expect(progressAtElapsed(5000)).toBe(100);
  });
});
