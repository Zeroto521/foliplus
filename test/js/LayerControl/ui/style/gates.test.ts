import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { layerCanBorder } from "#foliplus/LayerControl/ui/style/border.js";
import { layerCanFill } from "#foliplus/LayerControl/ui/style/fill.js";
import { layerCanOpacity } from "#foliplus/LayerControl/ui/style/opacity.js";
import { canShowZoomRange } from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { initFixture, installLeafletGlobals } from "../fixture.js";

/**
 * T181 §47.1: the four style-dimension gates converge on one shape —
 * "capability bit + real write carrier". This file walks the 16-cell
 * matrix (4 layer types × 4 dimensions) so a future change cannot
 * silently break symmetry between the gates.
 *
 * Layer types:
 *   - point    — Marker duck: no setStyle, no eachLayer
 *   - line     — bare Path leaf: setStyle, not Polygon/Circle
 *   - polygon  — L.Polygon leaf: setStyle + instanceof L.Polygon
 *   - lazy     — empty LayerGroup: eachLayer walks nothing
 *
 * Expected gate outcomes (capability + carrier):
 *
 *           border  fill  opacity  zoomRange
 *   point      ✗     ✗     ✓        ✓
 *   line       ✓     ✗     ✓        ✓
 *   polygon    ✓     ✓     ✓        ✓
 *   lazy       ✗     ✗     ✓        ✓
 *
 * The ✗ cells are the "honest degradation" axis: no carrier → the row
 * would persist a value with no visual effect, so it stays hidden.
 * The two vector axes read the carrier from `hasSetStyleLeaf`; the two
 * pane axes read it from the surface capability (the carrier IS the
 * capability for those).
 */

const makeLine = () => ({
  options: { color: "#3388ff", weight: 2 },
  setStyle: vi.fn(),
  on: vi.fn(),
});

const makePolygon = () => {
  const leaf = new L.Polygon() as L.Polygon & {
    options: { color?: string; weight?: number };
    setStyle: ReturnType<typeof vi.fn>;
  };
  leaf.options = { color: "#3388ff", weight: 2 };
  leaf.setStyle = vi.fn();
  return leaf;
};

/** Layer tree that walks to nothing — eachLayer present but yields no
 *  children. The empty-group shape the "no honest carrier" branch admits
 *  through the capability check and then drops at the carrier check. */
const makeEmptyGroup = () => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    // no children to dispatch
  }),
  getBounds: vi.fn(() => ({
    isValid: vi.fn(() => true),
    getSouthWest: () => ({ lat: 0, lng: 0 }),
    getNorthEast: () => ({ lat: 1, lng: 1 }),
  })),
});

/** A single vector leaf wrapped in a LayerGroup-like parent: the write
 *  walk descends `eachLayer` and finds the leaf, which owns `setStyle`. */
const makeGroupOf = (leaves: unknown[]) => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
  getBounds: vi.fn(() => ({
    isValid: vi.fn(() => true),
    getSouthWest: () => ({ lat: 0, lng: 0 }),
    getNorthEast: () => ({ lat: 1, lng: 1 }),
  })),
});

describe("T181 §47.1 four-gate 16-cell matrix", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const register = (id: string, layer: unknown) => {
    manager.registerLayer({ id, name: id, layer: layer as never });
  };

  const cell = (layerId: string) => ({
    border: layerCanBorder(ui, layerId),
    fill: layerCanFill(ui, layerId),
    opacity: layerCanOpacity(ui, layerId),
    zoomRange: canShowZoomRange(ui, layerId),
  });

  it("point layer — no setStyle leaf: only opacity and zoom range", () => {
    register("point1", {
      options: {},
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: () => ({ lat: 0, lng: 0 }),
        getNorthEast: () => ({ lat: 1, lng: 1 }),
      })),
    });
    expect(cell("point1")).toEqual({
      border: false,
      fill: false,
      opacity: true,
      zoomRange: true,
    });
  });

  it("line layer — setStyle leaf but not a polygon: border only", () => {
    register("line1", makeGroupOf([makeLine()]));
    expect(cell("line1")).toEqual({
      border: true,
      fill: false,
      opacity: true,
      zoomRange: true,
    });
  });

  it("polygon layer — setStyle leaf and a Polygon: all four gates open", () => {
    register("poly1", makeGroupOf([makePolygon()]));
    expect(cell("poly1")).toEqual({
      border: true,
      fill: true,
      opacity: true,
      zoomRange: true,
    });
  });

  it("empty group — eachLayer walks nothing: only opacity and zoom range", () => {
    register("empty1", makeEmptyGroup());
    expect(cell("empty1")).toEqual({
      border: false,
      fill: false,
      opacity: true,
      zoomRange: true,
    });
  });

  it("canvas layer — every dimension except the vector axes", () => {
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      canvas: document.createElement("canvas"),
    });
    expect(cell("canvas1")).toEqual({
      border: false,
      fill: false,
      opacity: true,
      zoomRange: true,
    });
  });

  it("baseline sanity: capabilities match the expected pane pair on all four", () => {
    register("line1", makeGroupOf([makeLine()]));
    const caps = manager.surfaceFor(manager.layerRegistry.get("line1")!).capabilities;
    expect({ opacity: caps.opacity, zoomRange: caps.zoomRange }).toEqual({
      opacity: "pane",
      zoomRange: "pane",
    });
  });
});
