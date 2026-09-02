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

describe("LABEL anchors", () => {
  const dotRadius = CONST.CENTER_DOT.SIZE[1] / 2;
  const cy = CONST.LABEL.CENTROID_ANCHOR[1];

  it("is horizontally centered on the centroid point", () => {
    expect(CONST.LABEL.CENTROID_ANCHOR[0]).toBe(0);
  });

  it("lifts the label chip above the point (positive y) so it does not sit on the dot", () => {
    expect(cy).toBeGreaterThan(0);
  });

  it("clears the center dot so the zIndexOffset 11000 dot cannot paint over the label", () => {
    // The centroid label and the 12x12 center dot share a latlng and both live
    // in labelPane. Any pixel overlap means the dot wins, so the chip's bottom
    // edge must sit above the dot's top edge. chipBottom = pointY - cy + chipH,
    // dotTop = pointY - dotRadius: clear iff cy > dotRadius + chipH (a strict
    // gap is required, not just touching).
    const chipH = 24; // rendered label chip height in px
    expect(cy).toBeGreaterThan(dotRadius + chipH);
  });

  it("is distinct from the non-overlapping anchors so a value regression is caught", () => {
    // Radius and midpoint labels sit at different latlngs from their markers,
    // so they anchor at [0, 0]. The centroid anchor must not accidentally
    // collapse back to those values.
    expect(CONST.LABEL.CENTROID_ANCHOR).not.toEqual(CONST.LABEL.RADIUS_ANCHOR);
    expect(CONST.LABEL.CENTROID_ANCHOR).not.toEqual(CONST.LABEL.MID_ANCHOR);
    expect(cy).toBeGreaterThan(CONST.LABEL.RADIUS_ANCHOR[1]);
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
