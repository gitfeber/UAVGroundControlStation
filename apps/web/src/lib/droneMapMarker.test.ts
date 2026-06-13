import { describe, expect, it } from "vitest";
import { droneMarkerCollection } from "./droneMapMarker";

describe("droneMarkerCollection", () => {
  it("includes heading property when available", () => {
    const collection = droneMarkerCollection([10.5, 51.2], 135);
    expect(collection.features[0]?.properties.heading).toBe(135);
  });

  it("omits heading property when null", () => {
    const collection = droneMarkerCollection([10.5, 51.2], null);
    expect(collection.features[0]?.properties.heading).toBeUndefined();
  });
});
