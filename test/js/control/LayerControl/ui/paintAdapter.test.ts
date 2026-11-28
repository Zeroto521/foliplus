// test/js/control/LayerControl/ui/paintAdapter — the panel's one paint read.
//
// `observeLayerPaint` must not gather a second time: the six factors come from
// `visibilityOf`, the values from `readLayerPaint`, and the provenance from the
// style snapshot. These tests pin that reuse plus the two facts the old ad-hoc
// reads disagreed on (a layer off the map, and a layer at opacity 0).
import { initFixture } from "./fixture.js";
import { beforeEach, describe, expect, it } from "vitest";
import { HIDDEN, type LayerInfo, paintProjection } from "#core/layer/index.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";
import { basePaints } from "#control/LayerControl/ui/listPanel/visibility.js";
import { observeLayerPaint, paintsNow } from "#control/LayerControl/ui/paintAdapter.js";

/** A plain vector leaf: no fill/zoom carrier, so the read stays about the
 *  visibility facts rather than a geometry body. */
const leafOf = (options: Record<string, unknown> = {}) => ({
  options,
  setStyle: () => undefined,
  getRadius: () => 5,
});

const layerOf = (
  layerOptions: Record<string, unknown> = {},
  leafOptions: Record<string, unknown> = {},
) => ({
  options: layerOptions,
  eachLayer: (cb: (leaf: unknown) => void) => cb(leafOf(leafOptions)),
});

const dataOf = (id = "p1", layerOptions: Record<string, unknown> = {}) => [
  { id, name: "P", role: "overlay" as const, layer: layerOf(layerOptions) },
];

describe("observeLayerPaint", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reuses the visibilityOf gather instead of a second one", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    const info = manager.layerRegistry.get("p1")!;
    const observation = observeLayerPaint(ui, info);
    const query = manager.visibilityOf("p1")!;
    expect(observation.factors).toEqual(query.factors);
    expect(observation.paints).toBe(paintProjection(query.factors));
  });

  it("paints a layer that is on the map, in range and opaque", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    expect(paintsNow(ui, manager.layerRegistry.get("p1")!)).toBe(true);
  });

  it("stops painting when the map does not hold the layer", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(false);
    expect(paintsNow(ui, manager.layerRegistry.get("p1")!)).toBe(false);
  });

  it("keeps painting when only the intent flag says hidden", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    setIntent(ui, "p1", "visible", false);
    const info = manager.layerRegistry.get("p1")!;
    // The paint composition deliberately excludes `declared`: a hidden
    // layer still on the map paints until the executor removes it.
    expect(observeLayerPaint(ui, info).factors?.declared).toBe(false);
    expect(paintsNow(ui, info)).toBe(true);
  });

  it("stops painting at opacity 0", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    setIntent(ui, "p1", "opacity", 0);
    expect(paintsNow(ui, manager.layerRegistry.get("p1")!)).toBe(false);
  });

  it("stops painting outside the layer own zoom range", () => {
    const { manager, ui, map } = initFixture({
      initialZoom: 5,
      data: dataOf("p1", { minZoom: 20, maxZoom: 21 }),
    });
    map.hasLayer.mockReturnValue(true);
    expect(paintsNow(ui, manager.layerRegistry.get("p1")!)).toBe(false);
  });

  it("reports the style snapshot and its provenance", () => {
    // A tile layer carries a native opacity carrier, so the OPACITY dimension
    // gate passes and the snapshot reports a provenance at all.
    const { manager, ui, map } = initFixture({
      data: [
        {
          id: "t1",
          name: "T",
          role: "overlay" as const,
          layer: new window.L.TileLayer(),
        },
      ],
    });
    map.hasLayer.mockReturnValue(true);
    setIntent(ui, "t1", "opacity", 0.4);
    ui.intentStore.seedProvenance("t1", ["opacity"] as never);
    const observation = observeLayerPaint(ui, manager.layerRegistry.get("t1")!);
    expect(observation.style?.opacity).toBeCloseTo(0.4, 5);
    expect(observation.source.opacity).toBe("user");
  });
});

describe("against the pre-observation read", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("agrees with basePaints while the layer is on the map", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    const info = manager.layerRegistry.get("p1")!;
    expect(basePaints(ui, info)).toBe(paintsNow(ui, info));
  });

  it("differs from basePaints on a HIDDEN face", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    const face = document.createElement("div");
    face.classList.add(HIDDEN);
    map.getPane.mockReturnValue(face);
    const info = manager.layerRegistry.get("p1")!;
    // basePaints hard-codes `container` true; the observation reads the face,
    // so the two agree only until the face is hidden. A follow-up folds them into one read.
    expect(basePaints(ui, info)).toBe(true);
    expect(paintsNow(ui, info)).toBe(false);
  });

  it("answers without a controller gather", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    const info = manager.layerRegistry.get("p1")!;
    const bare = ui.c as unknown as { visibilityOf?: unknown; getStyle?: unknown };
    bare.visibilityOf = undefined;
    bare.getStyle = undefined;
    const observation = observeLayerPaint(ui, info);
    expect(observation.factors).toBeNull();
    expect(observation.paints).toBe(false);
    expect(observation.style).toBeNull();
    expect(paintsNow(ui, info)).toBe(false);
  });

  it("falls back to the registry layer and a null snapshot", () => {
    const { manager, ui, map } = initFixture({ data: dataOf() });
    map.hasLayer.mockReturnValue(true);
    const real = ui.c as unknown as { getStyle?: (id: string) => unknown };
    real.getStyle = () => null;
    const observation = observeLayerPaint(ui, {
      ...manager.layerRegistry.get("p1")!,
      layer: null,
    } as LayerInfo);
    expect(observation.style).toBeNull();
    expect(observation.factors).not.toBeNull();
  });

  it("differs from basePaints on an author-declared opacity", () => {
    const { manager, ui, map } = initFixture({
      data: dataOf("p1", { foliplus: { opacity: 0 } }),
    });
    map.hasLayer.mockReturnValue(true);
    const info = manager.layerRegistry.get("p1")!;
    // basePaints reads the author declaration; the shared visibility gather
    // does not carry that hop yet, which is why the focus pane still reads
    // basePaints. When both reads converge this becomes an identity.
    expect(basePaints(ui, info)).toBe(false);
    expect(paintsNow(ui, info)).toBe(true);
  });
});
