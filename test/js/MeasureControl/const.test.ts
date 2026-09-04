import { describe, expect, it } from "vitest";
import { generateId } from "#core/component.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { DEL_ICON_CHAR } from "#common/delicon.js";

describe("TIMING", () => {
  it("defines timing constants", () => {
    expect(CONST.TIMING.CLICK_COOLDOWN).toBe(300);
    expect(CONST.TIMING.FINALIZE_DELAY).toBe(50);
  });
});

describe("DEL_ICON", () => {
  it("defines delete icon config", () => {
    expect(DEL_ICON_CHAR).toBe("\u2715");
  });
  it("defines the delete icon selector", () => {
    expect(CONST.SEL.DEL_ICON).toBe("[data-del-icon]");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.ACTIVE).toBe("active");
    expect(CONST.CLASSES.MEASURING).toBe("foliplus-measuring");
    expect(CONST.CLASSES.PATH_SOLID).toContain("foliplus-measure-path-solid");
    expect(CONST.CLASSES.PATH_DASHED).toContain("foliplus-measure-path-dashed");
    expect(CONST.CLASSES.PATH_PREVIEW).toContain("foliplus-measure-path-preview");
    expect(CONST.CLASSES.SHAPE_FILL).toContain("foliplus-measure-shape-fill");
  });
});

describe("MODE", () => {
  it("defines mode names", () => {
    expect(CONST.MODE.DISTANCE).toBe("distance");
    expect(CONST.MODE.POLYGON).toBe("polygon");
    expect(CONST.MODE.CIRCLE).toBe("circle");
    expect(CONST.MODE.MARKER).toBe("marker");
    expect(CONST.MODE.CLEAR).toBe("clear");
  });
});

describe("ID", () => {
  it("is the canvas identifier", () => {
    expect(CONST.ID).toBe("foliplus_measure");
  });
});

describe("PANES", () => {
  it("defines pane names", () => {
    expect(CONST.PANES.GRAPH).toBe("measure_graph");
    expect(CONST.PANES.LABEL).toBe("measure_label");
  });
});

describe("CENTER_DOT", () => {
  it("defines the center dot marker config", () => {
    expect(CONST.CENTER_DOT.SIZE).toEqual([12, 12]);
    expect(CONST.CENTER_DOT.ANCHOR).toEqual([6, 6]);
    expect(CONST.CENTER_DOT.CLASS).toBe("foliplus-measure-center-dot");
  });

  it("zIndexOffset lifts the dot above the SVG renderer but below the label", () => {
    // The centroid dot (div-icon in measure_graph) needs a zIndexOffset to
    // clear the fill's SVG renderer container (z = pane z ≈ 600–700). It must
    // stay below the centroid label (LABEL.CENTROID_Z_OFFSET = 2000) and the
    // del icon (11000) so the label still paints above the dot.
    expect(CONST.CENTER_DOT.Z_OFFSET).toBeGreaterThan(700);
    expect(CONST.CENTER_DOT.Z_OFFSET).toBeLessThan(
      CONST.LABEL.CENTROID_Z_OFFSET,
    );
  });
});

describe("LABEL anchors", () => {
  const cy = CONST.LABEL.CENTROID_ANCHOR[1];

  it("is horizontally centered on the centroid point", () => {
    expect(CONST.LABEL.CENTROID_ANCHOR[0]).toBe(0);
  });

  it("anchors the label chip above the point (negative y) so it clears the center dot", () => {
    // The centroid label (isLabel → measure_label pane) and the 12×12 center
    // dot (measure_graph pane) share a latlng. The label pane's z is
    // graph + 1, so the label always paints above the dot by pane ordering.
    // The [0, -10] anchor lifts the chip above the dot's centered position,
    // so the dot stays visible underneath as the edit-mode drag target.
    // A positive-y anchor was the wrong fix: it pushed the label *down* past
    // the dot into the fill, where a zoom-out animation reparents the
    // marker-icon to z = Y and the label washes out through backdrop-filter.
    expect(cy).toBeLessThan(0);
  });

  it("is distinct from the non-overlapping anchors so a value regression is caught", () => {
    // Radius and midpoint labels sit at different latlngs from their markers,
    // so they anchor at [0, 0]. The centroid anchor must not accidentally
    // collapse back to those values — or to a positive-y "clear the dot via
    // vertical offset" fix, which hides the real (z-index) problem.
    expect(CONST.LABEL.CENTROID_ANCHOR).not.toEqual(CONST.LABEL.RADIUS_ANCHOR);
    expect(CONST.LABEL.CENTROID_ANCHOR).not.toEqual(CONST.LABEL.MID_ANCHOR);
    expect(cy).not.toBe(CONST.LABEL.RADIUS_ANCHOR[1]);
    expect(cy).toBeLessThan(0);
  });
});

describe("FORMAT", () => {
  it("defines formatting", () => {
    expect(CONST.FORMAT.KM_THRESHOLD).toBe(1000);
    expect(CONST.FORMAT.KM_DECIMALS).toBe(1);
  });
});

describe("generateId", () => {
  it("returns the default ID when no namespace is provided", () => {
    expect(generateId(CONST.ID)).toBe("foliplus_measure");
    expect(generateId(CONST.ID, undefined)).toBe("foliplus_measure");
  });

  it("returns a namespaced ID when namespace is provided", () => {
    expect(generateId(CONST.ID, "map2")).toBe("foliplus_measure_map2");
    expect(generateId(CONST.ID, "custom")).toBe("foliplus_measure_custom");
  });

  it("uses ID constant as prefix for namespaced IDs", () => {
    expect(generateId(CONST.ID, "ns")).toBe(`${CONST.ID}_ns`);
  });
});
