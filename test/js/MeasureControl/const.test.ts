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

describe("LABEL anchors", () => {
  it("anchors the centroid label below the center dot (positive yAnchor)", () => {
    // The centroid label shares the same latlng as the 12×12 center dot and
    // must sit *below* it. L.divIcon.iconAnchor is an offset of the *div's
    // top-left corner* (y-down), so pushing the label below the point requires
    // a *positive* y value — a negative y would paint the chip on top of the
    // dot. Pin the invariant: clear at least half the dot's size plus half the
    // chip's height so the label body sits entirely under the dot with room to
    // spare.
    expect(CONST.LABEL.CENTROID_ANCHOR[1]).toBeGreaterThan(
      CONST.CENTER_DOT.SIZE[1] / 2,
    );
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
