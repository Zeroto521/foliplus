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
  it("centroid anchor clears the center dot so the dot cannot paint over the label", () => {
    // The centroid label and the 12×12 center dot share a latlng. The dot has
    // zIndexOffset 11000, so any pixel overlap means the dot wins. The anchor
    // must lift the chip clear of the dot: A ≥ chipHeight + dotRadius + gap.
    expect(CONST.LABEL.CENTROID_ANCHOR[0]).toBe(0);
    expect(CONST.LABEL.CENTROID_ANCHOR[1]).toBe(
      24 + CONST.CENTER_DOT.SIZE[1] / 2 + 4, // chip height + dot radius + gap
    );
    expect(CONST.LABEL.CENTROID_ANCHOR[1]).toBeGreaterThan(
      CONST.CENTER_DOT.SIZE[1] / 2,
    );
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
