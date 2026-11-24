// test/js/core/layer/paint — the layer paint read: one color per geometry face.
//
// Six shapes decide the contract: an areal fill, a stroke-only line, a marker
// chassis, a mixed tree, a multicolor tree, and a fully transparent fill (where
// the stroke takes over as the primary color).
import { beforeEach, describe, expect, it } from "vitest";
import { readLayerPaint, readLeafPaints } from "#core/layer/index.js";

/** A Leaflet Marker stand-in: the geometry predicate is `instanceof L.Marker`. */
class Marker {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  setIcon = () => this;
}

const markerOf = (iconOptions: Record<string, unknown>) =>
  new Marker({ icon: { options: iconOptions } });

/** A Path-shaped leaf: anything owning a runtime `setStyle`. */
const pathOf = (options: Record<string, unknown>) => ({
  options,
  setStyle: () => undefined,
});

/** A LayerGroup stand-in: `walkLeaf` descends anything with `eachLayer`. */
const groupOf = (...children: unknown[]) => ({
  eachLayer: (fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  },
});

/** An areal leaf: a `setStyle` carrier with a radius geometry (a Circle / CircleMarker shape). */
const arealOf = (options: Record<string, unknown>) => ({
  ...pathOf(options),
  getRadius: () => 5,
});

beforeEach(() => {
  (window as unknown as { L: { Marker: unknown } }).L.Marker = Marker;
});

describe("readLayerPaint — areal", () => {
  it("reads the fill color, pairs its opacity with the fill, and keeps the stroke", () => {
    const paint = readLayerPaint(
      arealOf({
        fillColor: "#22A06B",
        fillOpacity: 0.24,
        color: "#111111",
        opacity: 0.9,
      }),
    );

    expect(paint.kind).toBe("areal");
    expect(paint.color).toBe("#22a06b");
    expect(paint.border).toBe("#111111");
    expect(paint.opacity).toBe(0.24);
    expect(paint.multicolor).toBe(false);
    expect(paint.colors).toEqual(["#22a06b"]);
  });

  it("falls back to the stroke color when the fill is switched off", () => {
    const paint = readLayerPaint(
      arealOf({ fill: false, fillColor: "#0000ff", color: "#00AA00", opacity: 0.5 }),
    );

    expect(paint.color).toBe("#00aa00");
    expect(paint.border).toBe("#00aa00");
    expect(paint.opacity).toBe(0.5);
  });

  it("expands a 3-digit hex fill", () => {
    const paint = readLayerPaint(arealOf({ fillColor: "#AbC" }));

    expect(paint.color).toBe("#aabbcc");
  });
});

describe("readLayerPaint — line", () => {
  it("reads the stroke color and its own opacity, never the fill opacity", () => {
    const paint = readLayerPaint(
      pathOf({ color: "#FF0000", opacity: 0.6, fillOpacity: 0.2 }),
    );

    expect(paint.kind).toBe("line");
    expect(paint.color).toBe("#ff0000");
    expect(paint.border).toBe("#ff0000");
    expect(paint.opacity).toBe(0.6);
  });
});

describe("readLayerPaint — marker", () => {
  it("maps a preset chassis name to its preset hex", () => {
    const paint = readLayerPaint(markerOf({ markerColor: "green" }));

    expect(paint.kind).toBe("marker");
    expect(paint.color).toBe("#72b026");
    expect(paint.border).toBe("");
  });

  it("normalizes a hex chassis and reads its opacity", () => {
    const paint = readLayerPaint(
      markerOf({ markerColor: "#F00", markerColorOpacity: 40 }),
    );

    expect(paint.color).toBe("#ff0000");
    expect(paint.opacity).toBe(0.4);
  });
});

describe("readLayerPaint — mixed and multicolor", () => {
  it("reports a mixed kind for a tree with several geometry faces", () => {
    const paint = readLayerPaint(
      groupOf(
        arealOf({ fillColor: "#22a06b", fillOpacity: 0.3, color: "#111111" }),
        markerOf({ markerColor: "green" }),
      ),
    );

    expect(paint.kind).toBe("mixed");
    expect(paint.color).toBe("#22a06b");
    expect(paint.multicolor).toBe(true);
    expect(paint.colors).toEqual(["#22a06b", "#72b026"]);
  });

  it("lists every leaf color when one face paints different colors", () => {
    const paint = readLayerPaint(
      groupOf(arealOf({ fillColor: "#440154" }), arealOf({ fillColor: "#21918C" })),
    );

    expect(paint.kind).toBe("areal");
    expect(paint.color).toBe("#440154");
    expect(paint.multicolor).toBe(true);
    expect(paint.colors).toEqual(["#21918c", "#440154"]);
  });
});

describe("readLayerPaint — degenerate trees", () => {
  it("answers an empty paint for a tree with no paintable leaf", () => {
    const paint = readLayerPaint({ options: {} });

    expect(paint.color).toBe("");
    expect(paint.border).toBe("");
    expect(paint.opacity).toBe(1);
    expect(paint.multicolor).toBe(false);
    expect(paint.colors).toEqual([]);
  });
});

describe("readLeafPaints", () => {
  it("keys each leaf by identity and classifies its face", () => {
    const areal = arealOf({ fillColor: "#22a06b" });
    const line = pathOf({ color: "#ff0000" });
    const marker = markerOf({ markerColor: "blue" });

    const paints = readLeafPaints(groupOf(areal, line, marker));

    expect(paints.size).toBe(3);
    expect(paints.get(areal)?.kind).toBe("areal");
    expect(paints.get(line)?.kind).toBe("line");
    expect(paints.get(marker)?.kind).toBe("marker");
  });
});
