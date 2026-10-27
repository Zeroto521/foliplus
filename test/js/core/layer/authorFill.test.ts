import { describe, expect, it } from "vitest";
import { readFeatureFillColors } from "#core/layer/authorFill.js";

/** A Circle-like leaf: getRadius satisfies the areal fill carrier check and
 *  feature.properties is where explore puts its colour. */
const makeLeaf = (props?: Record<string, unknown>) => {
  const leaf: any = {
    options: { fillOpacity: 0.5, fill: true },
    setStyle: () => undefined,
    getRadius: () => 3,
  };
  if (props !== undefined) leaf.feature = { properties: props };
  return leaf;
};

const makeLayer = (leaves: unknown[]) => ({
  options: {},
  eachLayer: (fn: (child: unknown) => void) => leaves.forEach(child => fn(child)),
});

describe("readFeatureFillColors", () => {
  it("reads each explore leaf's author colour", () => {
    const leaves = [
      makeLeaf({ __folium_color: "#0d0887", cat: "a" }),
      makeLeaf({ __folium_color: "#f0f921", cat: "b" }),
    ];

    const snapshot = readFeatureFillColors(makeLayer(leaves));

    expect(snapshot.size).toBe(2);
    expect([...snapshot.values()]).toEqual(["#0d0887", "#f0f921"]);
  });

  it("normalizes colour spelling", () => {
    const snapshot = readFeatureFillColors(
      makeLayer([makeLeaf({ __folium_color: "#FFF" })]),
    );

    expect([...snapshot.values()]).toEqual(["#ffffff"]);
  });

  it("keeps a feature without the property as null", () => {
    const snapshot = readFeatureFillColors(
      makeLayer([
        makeLeaf({ __folium_color: "#0d0887" }),
        makeLeaf({ cat: "b" }),
        makeLeaf(undefined),
      ]),
    );

    expect([...snapshot.values()]).toEqual(["#0d0887", null, null]);
  });

  it("treats a blank colour as no colour", () => {
    const snapshot = readFeatureFillColors(
      makeLayer([makeLeaf({ __folium_color: "  " })]),
    );

    expect([...snapshot.values()]).toEqual([null]);
  });
  it("returns an empty snapshot for a layer without areal leaves", () => {
    expect(readFeatureFillColors(makeLayer([])).size).toBe(0);
  });
});
