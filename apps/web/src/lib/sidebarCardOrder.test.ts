import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ORDER } from "./sidebarCardOrder";

describe("sidebarCardOrder", () => {
  it("default order excludes ground target (moved to camera dock)", () => {
    expect(DEFAULT_SIDEBAR_ORDER).not.toContain("groundTarget" as never);
  });
});
