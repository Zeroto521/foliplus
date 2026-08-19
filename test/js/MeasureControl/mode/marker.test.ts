import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MarkerMode } from "#foliplus/MeasureControl/mode/index.js";

describe("MarkerMode — TYPE", () => {
  it("has correct TYPE constant", () => {
    expect(MarkerMode.TYPE).toBe(CONST.MODE.MARKER);
  });
});

describe("MarkerMode — toGeoFeature", () => {
  it("returns a Point feature with address as name", () => {
    const feature = MarkerMode.toGeoFeature({
      id: "m1",
      type: "marker",
      lng: 121.5,
      lat: 31.2,
      address: "Shanghai",
    });
    expect(feature.type).toBe("Feature");
    expect(feature.properties.type).toBe("marker");
    expect(feature.properties.address).toBe("Shanghai");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toEqual([121.5, 31.2]);
  });

  it("uses fallback name when address is missing", () => {
    const feature = MarkerMode.toGeoFeature({
      id: "m2",
      type: "marker",
      lng: 0,
      lat: 0,
    });
    expect(feature.properties.name).toBe("Location Marker");
  });

  it("has NAME_LABEL and TYPE static properties", async () => {
    const { MarkerMode } = await import("#foliplus/MeasureControl/mode/index.js");
    expect(MarkerMode.NAME_LABEL).toBe("Location Marker");
    expect(MarkerMode.NAME_LABEL_KEY).toContain("name_marker");
  });
});
