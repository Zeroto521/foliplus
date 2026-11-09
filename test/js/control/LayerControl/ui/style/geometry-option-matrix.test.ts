import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import { DIM, FILL_MODE, GEOM_TYPE } from "#core/layer/index.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  bindBorderRow,
  buildBorderRow,
} from "#control/LayerControl/ui/style/border.js";

/**
 * Geometry x dimension option matrix.
 *
 * The contract (#953): the row is the REAL geometry (geometryType()'s
 * returned kind), the column is a style dimension (DIM single source), and
 * the cell is the exact set of mode options that geometry may use for that
 * dimension. The border dimension is the representative geometry-gated mode
 * dimension: by-value is only legal on a line, because a polygon/point
 * border is the outline, never the element's primary color.
 *
 * Hard rule: line = {original, single, value}; polygon/point = {original, single}.
 *
 * Assertions are EQUALITY (toEqual), never containment: an extra illegal
 * option in the product's list must fail the matrix (guard 1), and the
 * line->value assertion catches a fallback that returns original for every
 * stored value (guard 2).
 */

/** One feature leaf of a real Leaflet geometry class so geometryType()
 *  returns the actual kind (no config-string or layer-name matching). */
const makeLeaf = (kind: "line" | "polygon" | "point", count = 5): any => {
  const cls =
    kind === "line" ? "Polyline" : kind === "polygon" ? "Polygon" : "CircleMarker";
  const leaf = new (globalThis as any).L[cls]() as any;
  leaf.options = { color: "#ff0000", weight: 2, stroke: true };
  leaf.feature = {
    geometry: {
      type: kind === "line" ? "LineString" : kind === "polygon" ? "Polygon" : "Point",
    },
    properties: { count },
  };
  leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
    Object.assign(leaf.options, style);
    return leaf;
  });
  leaf.on = vi.fn();
  return leaf;
};

/** A layer group whose eachLayer walks to the feature leaves (Leaflet LayerGroup
 *  recursion is what the layer registry walks). */
const makeGroup = (...leaves: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
  leaves,
});

const registerGeometryLayer = (
  manager: LayerController,
  ui: LayerUI,
  id: string,
  kind: "line" | "polygon" | "point",
): void => {
  manager.registerLayer({ id, name: id, layer: makeGroup(makeLeaf(kind)) });
  ui.runtimeStore.setFields(id, [{ name: "count", numeric: true }]);
};

const openBorderRow = (ui: LayerUI, id: string): HTMLElement => {
  const block = buildBorderRow(ui, id) as HTMLElement;
  document.body.appendChild(block);
  bindBorderRow(ui, id, block);
  return block;
};

const modeSelectOf = (block: HTMLElement): HTMLSelectElement | null =>
  block.querySelector(".foliplus-style-border-mode-select") as HTMLSelectElement | null;

const modeValues = (block: HTMLElement): string[] => {
  const select = modeSelectOf(block);
  return select ? Array.from(select.options).map(option => option.value) : [];
};

/** The ramp a value mode needs; DEFAULT_SCHEMES[0] is the registered one. */
const valueRamp = (): any => ({
  kind: "numeric",
  field: "count",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
});

describe("geometry x dimension option matrix (border)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const expectGeometryType = (id: string, kind: "line" | "polygon" | "point") => {
    const info = ui.c.layerRegistry.get(id);
    expect(info).toBeTruthy();
    const kindOf = ui.c.surfaceFor(info!).geometryType();
    expect(kindOf).toBe(
      kind === "line"
        ? GEOM_TYPE.LINE
        : kind === "polygon"
          ? GEOM_TYPE.POLYGON
          : GEOM_TYPE.POINT,
    );
  };

  it("line: { original, single, value }", () => {
    registerGeometryLayer(manager, ui, "g_line", "line");
    expectGeometryType("g_line", "line");
    expect(modeValues(openBorderRow(ui, "g_line"))).toEqual([
      FILL_MODE.ORIGINAL,
      FILL_MODE.SOLID,
      FILL_MODE.VALUE,
    ]);
  });

  it("polygon: { original, single } — never by-value", () => {
    registerGeometryLayer(manager, ui, "g_polygon", "polygon");
    expectGeometryType("g_polygon", "polygon");
    expect(modeValues(openBorderRow(ui, "g_polygon"))).toEqual([
      FILL_MODE.ORIGINAL,
      FILL_MODE.SOLID,
    ]);
  });

  it("point: { original, single } — never by-value", () => {
    registerGeometryLayer(manager, ui, "g_point", "point");
    expectGeometryType("g_point", "point");
    expect(modeValues(openBorderRow(ui, "g_point"))).toEqual([
      FILL_MODE.ORIGINAL,
      FILL_MODE.SOLID,
    ]);
  });

  it("the column is the DIM single source (border)", () => {
    expect(DIM.BORDER).toBe("border");
    registerGeometryLayer(manager, ui, "g_dim", "line");
    const block = openBorderRow(ui, "g_dim");
    expect(block.getAttribute("data-style-dim")).toBe(DIM.BORDER);
  });

  it("stored by-value on a non-line reads back as original (display fallback)", () => {
    registerGeometryLayer(manager, ui, "g_poly_fb", "polygon");
    setIntent(ui, "g_poly_fb", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_poly_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow(ui, "g_poly_fb"));
    expect(select).not.toBeNull();
    // The illegal stored value must never surface as a selected "value".
    expect(select!.value).toBe(FILL_MODE.ORIGINAL);
  });

  it("stored by-value on a line stays value (guard against always-original fallback)", () => {
    registerGeometryLayer(manager, ui, "g_line_fb", "line");
    setIntent(ui, "g_line_fb", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_line_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow(ui, "g_line_fb"));
    expect(select).not.toBeNull();
    expect(select!.value).toBe(FILL_MODE.VALUE);
  });

  it("guard 1: the option set is asserted exactly, so an extra illegal option fails", () => {
    // The product's set for a polygon is [original, solid]. A hypothetical
    // regression that adds by-value there would make modeValues return
    // [original, solid, value] — which toEqual rejects. The assertion here is
    // the same equality the matrix tests use; it documents that containment
    // would NOT catch the extra.
    registerGeometryLayer(manager, ui, "g_guard1", "polygon");
    const actual = modeValues(openBorderRow(ui, "g_guard1"));
    const contract = [FILL_MODE.ORIGINAL, FILL_MODE.SOLID];
    expect(actual).toEqual(contract);
    // The negative property: adding the illegal option to the contract must NOT
    // equal the actual set — this is what makes the matrix red on an extra.
    const illegal = [...contract, FILL_MODE.VALUE];
    expect(actual).not.toEqual(illegal);
  });

  it("guard 2: the line by-value read-back pins the fallback to geometry, not original", () => {
    // If displayBorderMode were changed to always return original, the
    // line-with-stored-value test above would fail. This test restates that
    // dependency as a direct invariant so the guard has its own name.
    registerGeometryLayer(manager, ui, "g_guard2", "line");
    setIntent(ui, "g_guard2", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_guard2", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow(ui, "g_guard2"));
    expect(select).not.toBeNull();
    expect(select!.value).not.toBe(FILL_MODE.ORIGINAL);
  });
});
